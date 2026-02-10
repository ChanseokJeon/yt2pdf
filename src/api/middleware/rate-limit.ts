/**
 * Rate limiting middleware for v2doc API.
 *
 * Implements token bucket algorithm with three layers:
 * 1. Global rate limit (per IP)
 * 2. Per-API-key rate limit
 * 3. Per-route overrides for expensive endpoints
 *
 * Changes from v1:
 * - P1-4: getClientIp() uses LAST IP from X-Forwarded-For (Cloud Run appends real IP)
 * - P2-10: Import rate limit constants from constants.ts (single source of truth)
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, RateLimitConfig } from '../types.js';
import {
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_PER_KEY_WINDOW_MS,
  RATE_LIMIT_PER_KEY_MAX,
  RATE_LIMIT_SYNC_WINDOW_MS,
  RATE_LIMIT_SYNC_MAX,
  RATE_LIMIT_ASYNC_WINDOW_MS,
  RATE_LIMIT_ASYNC_MAX,
} from '../../constants.js';

/**
 * Token bucket for a single rate limit key.
 */
interface TokenBucket {
  /** Current number of available tokens (fractional for smooth refill) */
  tokens: number;
  /** Maximum capacity of the bucket */
  maxTokens: number;
  /** Last time tokens were refilled (milliseconds since epoch) */
  lastRefill: number;
}

/**
 * Result of a rate limit check.
 */
interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Unix timestamp (seconds) when the rate limit resets */
  resetAt: number;
}

/**
 * In-memory rate limit store using token bucket algorithm.
 *
 * Token bucket allows for smooth traffic patterns (permits bursts
 * while maintaining average rate) instead of strict sliding windows.
 *
 * Cleanup: Buckets unused for >10 minutes are removed every 5 minutes.
 */
class RateLimitStore {
  private buckets = new Map<string, TokenBucket>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup stale buckets every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check rate limit and consume a token if allowed.
   *
   * @param key - Unique identifier (e.g., "global:192.168.1.1", "key:abc123")
   * @param maxTokens - Maximum requests in the window
   * @param windowMs - Time window in milliseconds
   * @returns Rate limit result
   */
  consume(key: string, maxTokens: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      // First request for this key
      bucket = {
        tokens: maxTokens - 1, // Consume one token immediately
        maxTokens,
        lastRefill: now,
      };
      this.buckets.set(key, bucket);

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: maxTokens,
        resetAt: Math.ceil((now + windowMs) / 1000),
      };
    }

    // Calculate token refill rate (tokens per millisecond)
    const refillRate = maxTokens / windowMs;

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = elapsed * refillRate;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      // Rate limited
      const timeToNextToken = (1 - bucket.tokens) / refillRate;
      return {
        allowed: false,
        remaining: 0,
        limit: maxTokens,
        resetAt: Math.ceil((now + timeToNextToken) / 1000),
      };
    }

    // Consume a token
    bucket.tokens -= 1;

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      limit: maxTokens,
      resetAt: Math.ceil((now + windowMs) / 1000),
    };
  }

  /**
   * Remove buckets that haven't been accessed in over 10 minutes.
   */
  private cleanup(): void {
    const staleThreshold = Date.now() - 10 * 60 * 1000;
    let removed = 0;

    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < staleThreshold) {
        this.buckets.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(
        `[RateLimit] Cleaned up ${removed} stale bucket(s). Active: ${this.buckets.size}`
      );
    }
  }

  /** Get current bucket count (for monitoring/tests). */
  get size(): number {
    return this.buckets.size;
  }

  /** Clear all buckets (for testing). */
  clear(): void {
    this.buckets.clear();
  }

  /** Stop cleanup interval (for testing/shutdown). */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton
let rateLimitStore: RateLimitStore | null = null;

function getRateLimitStore(): RateLimitStore {
  if (!rateLimitStore) {
    rateLimitStore = new RateLimitStore();
  }
  return rateLimitStore;
}

export function resetRateLimitStore(): void {
  rateLimitStore?.destroy();
  rateLimitStore = null;
}

/**
 * [REVISED from v1] Get the client IP from the request.
 *
 * Cloud Run APPENDS the real client IP as the LAST entry in
 * X-Forwarded-For. It does NOT strip or replace existing headers.
 * So if a client sends "X-Forwarded-For: spoofed", Cloud Run produces
 * "X-Forwarded-For: spoofed, <real-ip>".
 *
 * v1 took ips[0] (client-controlled, spoofable).
 * v2 takes ips[ips.length - 1] (Cloud Run-appended, trusted).
 */
function getClientIp(c: Context): string {
  // Cloud Run sets X-Forwarded-For
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map((ip) => ip.trim());
    // [REVISED from v1: take LAST IP, not first (P1-4)]
    return ips[ips.length - 1] || '127.0.0.1';
  }

  // Fallback (local development)
  return c.req.header('x-real-ip') || '127.0.0.1';
}

/**
 * Set standard rate limit response headers.
 */
function setRateLimitHeaders(c: Context, limit: number, remaining: number, resetAt: number): void {
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  c.header('X-RateLimit-Reset', String(resetAt));
}

/**
 * [REVISED from v1] Default rate limit configuration.
 *
 * All values imported from constants.ts (single source of truth).
 * v1 duplicated these values between rate-limit.ts and constants.ts.
 */
const DEFAULT_RATE_CONFIG: RateLimitConfig = {
  global: {
    windowMs: RATE_LIMIT_GLOBAL_WINDOW_MS,
    maxRequests: RATE_LIMIT_GLOBAL_MAX,
  },
  perKey: {
    windowMs: RATE_LIMIT_PER_KEY_WINDOW_MS,
    maxRequests: RATE_LIMIT_PER_KEY_MAX,
  },
  routeOverrides: {
    '/api/v1/jobs/sync': {
      windowMs: RATE_LIMIT_SYNC_WINDOW_MS,
      maxRequests: RATE_LIMIT_SYNC_MAX,
    },
    '/api/v1/jobs': {
      windowMs: RATE_LIMIT_ASYNC_WINDOW_MS,
      maxRequests: RATE_LIMIT_ASYNC_MAX,
    },
  },
};

/**
 * Global rate limiter (per IP).
 *
 * Applied to all requests regardless of authentication.
 * Prevents a single IP from overwhelming the server.
 *
 * Usage:
 *   app.use('*', globalRateLimit());
 */
export function globalRateLimit(config?: Partial<RateLimitConfig['global']>): MiddlewareHandler {
  const cfg = { ...DEFAULT_RATE_CONFIG.global, ...config };

  return async (c, next) => {
    const store = getRateLimitStore();
    const ip = getClientIp(c);
    const key = `global:${ip}`;

    const result = store.consume(key, cfg.maxRequests, cfg.windowMs);
    setRateLimitHeaders(c, result.limit, result.remaining, result.resetAt);

    if (!result.allowed) {
      c.header('Retry-After', String(result.resetAt - Math.floor(Date.now() / 1000)));
      return c.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${new Date(result.resetAt * 1000).toISOString()}.`,
          retryAfter: result.resetAt - Math.floor(Date.now() / 1000),
        },
        429
      );
    }

    return next();
  };
}

/**
 * Per-API-key rate limiter.
 *
 * Applied after authentication. Uses the API key ID as the identifier.
 * Enforces daily quota per API key.
 *
 * Only applies to authenticated requests (skipped for anonymous).
 *
 * Usage:
 *   app.use('*', perKeyRateLimit());
 */
export function perKeyRateLimit(
  config?: Partial<RateLimitConfig['perKey']>
): MiddlewareHandler<AppEnv> {
  const perKeyCfg = { ...DEFAULT_RATE_CONFIG.perKey, ...config };

  return async (c, next) => {
    const store = getRateLimitStore();
    const userId = c.get('userId');

    // Skip rate limiting for anonymous users (handled by global limit)
    if (!userId || userId === 'anonymous') {
      return next();
    }

    const key = `key:${userId}`;

    // Check per-key daily limit
    const dailyResult = store.consume(key, perKeyCfg.maxRequests, perKeyCfg.windowMs);
    setRateLimitHeaders(c, dailyResult.limit, dailyResult.remaining, dailyResult.resetAt);

    if (!dailyResult.allowed) {
      c.header('Retry-After', String(dailyResult.resetAt - Math.floor(Date.now() / 1000)));
      return c.json(
        {
          error: 'API key rate limit exceeded',
          message: `Daily quota exceeded. Resets at ${new Date(dailyResult.resetAt * 1000).toISOString()}.`,
          retryAfter: dailyResult.resetAt - Math.floor(Date.now() / 1000),
        },
        429
      );
    }

    return next();
  };
}

/**
 * Per-route rate limiter.
 *
 * Applied to specific routes that need tighter limits.
 * Checks route-specific overrides defined in the config.
 *
 * Usage:
 *   app.post('/api/v1/jobs/sync', perRouteRateLimit());
 */
export function perRouteRateLimit(
  config?: Partial<Pick<RateLimitConfig, 'routeOverrides'>>
): MiddlewareHandler<AppEnv> {
  const routeOverrides = { ...DEFAULT_RATE_CONFIG.routeOverrides, ...config?.routeOverrides };

  return async (c, next) => {
    const store = getRateLimitStore();
    const userId = c.get('userId') || 'anonymous';
    const path = c.req.path;

    // Find matching route override
    let routeCfg: { windowMs: number; maxRequests: number } | undefined;
    for (const [routePath, cfg] of Object.entries(routeOverrides)) {
      if (path === routePath || path.startsWith(routePath + '/')) {
        routeCfg = cfg;
        break;
      }
    }

    // No override for this route
    if (!routeCfg) {
      return next();
    }

    const key = `route:${path}:${userId}`;
    const result = store.consume(key, routeCfg.maxRequests, routeCfg.windowMs);
    setRateLimitHeaders(c, result.limit, result.remaining, result.resetAt);

    if (!result.allowed) {
      c.header('Retry-After', String(result.resetAt - Math.floor(Date.now() / 1000)));
      return c.json(
        {
          error: 'Route rate limit exceeded',
          message: `Too many requests to ${path}. Try again after ${new Date(result.resetAt * 1000).toISOString()}.`,
          retryAfter: result.resetAt - Math.floor(Date.now() / 1000),
        },
        429
      );
    }

    return next();
  };
}
