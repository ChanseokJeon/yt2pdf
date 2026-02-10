/**
 * Unit tests for rate limiting middleware.
 *
 * Tests cover:
 * - P1-4: getClientIp() uses LAST IP from X-Forwarded-For
 * - P2-10: Rate limit constants imported from constants.ts
 * - Global rate limit (per IP)
 * - Per-key rate limit (per API key)
 * - Per-route rate limit (endpoint-specific)
 * - Token bucket algorithm (smooth refill)
 * - 429 response format with Retry-After
 * - Rate limit headers
 */

import { Hono } from 'hono';
import { globalRateLimit, perKeyRateLimit, perRouteRateLimit, resetRateLimitStore } from '../../../../src/api/middleware/rate-limit.js';
import type { AppEnv } from '../../../../src/api/types.js';
import {
  setupTestAuth,
  teardownTestAuth,
  TEST_API_KEY,
  TEST_USER_ID,
  TEST_API_KEY_2,
  TEST_USER_ID_2,
} from '../../../helpers/test-helpers.js';
import {
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_PER_KEY_MAX,
  RATE_LIMIT_PER_KEY_WINDOW_MS,
} from '../../../../src/constants.js';

describe('Rate limiting middleware', () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = new Hono<AppEnv>();
    resetRateLimitStore();
  });

  afterEach(() => {
    resetRateLimitStore();
    teardownTestAuth();
  });

  describe('getClientIp() - P1-4: Use LAST IP from X-Forwarded-For', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should use LAST IP from X-Forwarded-For (Cloud Run appends real IP)', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // First request from spoofed IP
      const res1 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' }, // 5.6.7.8 is real IP (last)
      });
      expect(res1.status).toBe(200);

      // Second request from same real IP (different spoofed)
      const res2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '9.9.9.9, 5.6.7.8' }, // Still 5.6.7.8
      });
      expect(res2.status).toBe(429); // Rate limited (same real IP)
    });

    it('should NOT be spoofable by client-provided header', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // First request
      const res1 = await app.request('/test', {
        headers: { 'X-Forwarded-For': 'spoofed-ip, 10.0.0.1' },
      });
      expect(res1.status).toBe(200);

      // Try to bypass with different spoofed IP but same real IP
      const res2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': 'different-spoofed, 10.0.0.1' },
      });
      expect(res2.status).toBe(429); // Still rate limited
    });

    it('should handle single IP in X-Forwarded-For', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      });
      expect(res2.status).toBe(429);
    });

    it('should handle whitespace in X-Forwarded-For', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '  1.1.1.1  ,  2.2.2.2  ' },
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '3.3.3.3, 2.2.2.2' }, // Same last IP
      });
      expect(res2.status).toBe(429);
    });

    it('should fall back to 127.0.0.1 when X-Forwarded-For is empty', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test');
      expect(res1.status).toBe(200);

      const res2 = await app.request('/test');
      expect(res2.status).toBe(429); // Both use 127.0.0.1
    });

    it('should use X-Real-IP as fallback when X-Forwarded-For missing', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test', {
        headers: { 'X-Real-IP': '8.8.8.8' },
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/test', {
        headers: { 'X-Real-IP': '8.8.8.8' },
      });
      expect(res2.status).toBe(429);
    });
  });

  describe('Global rate limit (per IP)', () => {
    it('should enforce rate limit per IP', async () => {
      app.use('*', globalRateLimit({ maxRequests: 3, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '192.168.1.100';

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/test', {
          headers: { 'X-Forwarded-For': ip },
        });
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(429);
    });

    it('should use defaults from constants.ts (P2-10)', async () => {
      app.use('*', globalRateLimit()); // No config = use defaults
      app.get('/test', (c) => c.json({ ok: true }));

      // Default is 60 requests per minute (from constants.ts)
      const ip = '10.0.0.1';

      // Should allow up to RATE_LIMIT_GLOBAL_MAX requests
      for (let i = 0; i < RATE_LIMIT_GLOBAL_MAX; i++) {
        const res = await app.request('/test', {
          headers: { 'X-Forwarded-For': ip },
        });
        expect(res.status).toBe(200);
      }

      // Next request should fail
      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': ip },
      });
      expect(res.status).toBe(429);
    });

    it('should track different IPs independently', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });
      const res2 = await app.request('/test', {
        headers: { 'X-Forwarded-For': '2.2.2.2' },
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200); // Different IP, not rate limited
    });

    it('should return 429 with proper error message', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });
      const res = await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });

      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toBe('Too many requests');
      expect(data.message).toContain('Rate limit exceeded');
      expect(data.retryAfter).toBeDefined();
    });

    it('should set Retry-After header', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });
      const res = await app.request('/test', { headers: { 'X-Forwarded-For': '1.1.1.1' } });

      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('Retry-After');
      expect(retryAfter).toBeDefined();
      expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);
    });

    it('should set rate limit headers', async () => {
      app.use('*', globalRateLimit({ maxRequests: 5, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('should update remaining count with each request', async () => {
      app.use('*', globalRateLimit({ maxRequests: 3, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '1.1.1.1';

      const res1 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

      const res2 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');

      const res3 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0');
    });
  });

  describe('Per-key rate limit', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should enforce rate limit per API key', async () => {
      // Mock auth context
      app.use('*', (c, next) => {
        c.set('userId', TEST_USER_ID);
        c.set('apiKeyId', 'key_12345678');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perKeyRateLimit({ maxRequests: 2, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // First 2 requests should succeed
      const res1 = await app.request('/test');
      const res2 = await app.request('/test');
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // 3rd request should be rate limited
      const res3 = await app.request('/test');
      expect(res3.status).toBe(429);
      const data = await res3.json();
      expect(data.error).toBe('API key rate limit exceeded');
    });

    it('should skip rate limiting for anonymous users', async () => {
      app.use('*', (c, next) => {
        c.set('userId', 'anonymous');
        c.set('apiKeyId', undefined);
        c.set('authMode', 'anonymous');
        return next();
      });
      app.use('*', perKeyRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // Should allow multiple requests (not rate limited by per-key)
      const res1 = await app.request('/test');
      const res2 = await app.request('/test');
      const res3 = await app.request('/test');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200); // Not rate limited
    });

    it('should track different users independently', async () => {
      app.use('*', (c, next) => {
        const authHeader = c.req.header('Authorization');
        if (authHeader?.includes(TEST_API_KEY)) {
          c.set('userId', TEST_USER_ID);
        } else {
          c.set('userId', TEST_USER_ID_2);
        }
        c.set('apiKeyId', 'some-key');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perKeyRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
      const res2 = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY_2}` },
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200); // Different user, not rate limited
    });

    it('should use defaults from constants.ts (P2-10)', async () => {
      app.use('*', (c, next) => {
        c.set('userId', TEST_USER_ID);
        c.set('apiKeyId', 'key_12345678');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perKeyRateLimit()); // No config = use defaults
      app.get('/test', (c) => c.json({ ok: true }));

      // Default is 1000 requests per day (from constants.ts)
      // We'll just verify it doesn't immediately rate limit
      const res = await app.request('/test');
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe(String(RATE_LIMIT_PER_KEY_MAX));
    });
  });

  describe('Per-route rate limit', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should enforce route-specific limits', async () => {
      app.use('*', (c, next) => {
        c.set('userId', TEST_USER_ID);
        c.set('apiKeyId', 'key_12345678');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perRouteRateLimit({
        routeOverrides: {
          '/api/v1/jobs/sync': { maxRequests: 1, windowMs: 60000 },
        },
      }));
      app.post('/api/v1/jobs/sync', (c) => c.json({ ok: true }));
      app.post('/api/v1/jobs', (c) => c.json({ ok: true }));

      // First sync request succeeds
      const res1 = await app.request('/api/v1/jobs/sync', { method: 'POST' });
      expect(res1.status).toBe(200);

      // Second sync request is rate limited
      const res2 = await app.request('/api/v1/jobs/sync', { method: 'POST' });
      expect(res2.status).toBe(429);
      const data = await res2.json();
      expect(data.error).toBe('Route rate limit exceeded');

      // But non-sync route is not affected
      const res3 = await app.request('/api/v1/jobs', { method: 'POST' });
      expect(res3.status).toBe(200);
    });

    it('should match routes with prefix', async () => {
      app.use('*', (c, next) => {
        c.set('userId', TEST_USER_ID);
        c.set('apiKeyId', 'key_12345678');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perRouteRateLimit({
        routeOverrides: {
          '/api/v1/jobs': { maxRequests: 2, windowMs: 60000 },
        },
      }));
      app.post('/api/v1/jobs', (c) => c.json({ ok: true }));
      app.post('/api/v1/jobs/sync', (c) => c.json({ ok: true }));

      // The rate limiter uses "route:${path}:${userId}" as key
      // So /api/v1/jobs and /api/v1/jobs/sync have DIFFERENT keys
      // Both match the /api/v1/jobs prefix, but they're tracked separately

      // First request to /api/v1/jobs - uses limit of 2
      const res1 = await app.request('/api/v1/jobs', { method: 'POST' });
      expect(res1.status).toBe(200);

      // Second request to /api/v1/jobs - still within limit
      const res2 = await app.request('/api/v1/jobs', { method: 'POST' });
      expect(res2.status).toBe(200);

      // Third request to /api/v1/jobs - exceeds limit
      const res3 = await app.request('/api/v1/jobs', { method: 'POST' });
      expect(res3.status).toBe(429);
    });

    it('should skip non-matching routes', async () => {
      app.use('*', (c, next) => {
        c.set('userId', TEST_USER_ID);
        c.set('apiKeyId', 'key_12345678');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perRouteRateLimit({
        routeOverrides: {
          '/api/v1/jobs/sync': { maxRequests: 1, windowMs: 60000 },
        },
      }));
      app.get('/api/v1/health', (c) => c.json({ ok: true }));

      // Should not apply rate limit to non-matching route
      const res1 = await app.request('/api/v1/health');
      const res2 = await app.request('/api/v1/health');
      const res3 = await app.request('/api/v1/health');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);
    });

    it('should track limits per user per route', async () => {
      app.use('*', (c, next) => {
        const authHeader = c.req.header('Authorization');
        if (authHeader?.includes(TEST_API_KEY)) {
          c.set('userId', TEST_USER_ID);
        } else {
          c.set('userId', TEST_USER_ID_2);
        }
        c.set('apiKeyId', 'some-key');
        c.set('authMode', 'authenticated');
        return next();
      });
      app.use('*', perRouteRateLimit({
        routeOverrides: {
          '/api/v1/jobs/sync': { maxRequests: 1, windowMs: 60000 },
        },
      }));
      app.post('/api/v1/jobs/sync', (c) => c.json({ ok: true }));

      // User 1 exhausts limit
      const res1 = await app.request('/api/v1/jobs/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/api/v1/jobs/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
      expect(res2.status).toBe(429);

      // User 2 still has quota
      const res3 = await app.request('/api/v1/jobs/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY_2}` },
      });
      expect(res3.status).toBe(200);
    });

    it('should work for anonymous users', async () => {
      app.use('*', (c, next) => {
        c.set('userId', 'anonymous');
        c.set('apiKeyId', undefined);
        c.set('authMode', 'anonymous');
        return next();
      });
      app.use('*', perRouteRateLimit({
        routeOverrides: {
          '/api/v1/jobs/sync': { maxRequests: 1, windowMs: 60000 },
        },
      }));
      app.post('/api/v1/jobs/sync', (c) => c.json({ ok: true }));

      const res1 = await app.request('/api/v1/jobs/sync', { method: 'POST' });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/api/v1/jobs/sync', { method: 'POST' });
      expect(res2.status).toBe(429);
    });
  });

  describe('Token bucket algorithm', () => {
    it('should refill tokens over time', async () => {
      app.use('*', globalRateLimit({ maxRequests: 2, windowMs: 100 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '1.1.1.1';

      // Exhaust tokens
      await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      await app.request('/test', { headers: { 'X-Forwarded-For': ip } });

      const res1 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res1.status).toBe(429);

      // Wait for refill (100ms window = ~50ms for 1 token)
      await new Promise(resolve => setTimeout(resolve, 60));

      const res2 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res2.status).toBe(200); // Token refilled
    });

    it('should cap tokens at maxTokens', async () => {
      app.use('*', globalRateLimit({ maxRequests: 2, windowMs: 100 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '1.1.1.1';

      // Wait longer than window (should not accumulate beyond maxTokens)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should only allow maxRequests, not more
      const res1 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      const res2 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      const res3 = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(429); // Can't go over max
    });
  });

  describe('Rate limit headers', () => {
    it('should set X-RateLimit-Limit', async () => {
      app.use('*', globalRateLimit({ maxRequests: 10, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    });

    it('should set X-RateLimit-Remaining', async () => {
      app.use('*', globalRateLimit({ maxRequests: 5, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '1.1.1.1';
      const res = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
    });

    it('should set X-RateLimit-Reset as Unix timestamp', async () => {
      app.use('*', globalRateLimit({ maxRequests: 5, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const beforeRequest = Math.floor(Date.now() / 1000);
      const res = await app.request('/test');
      const afterRequest = Math.floor(Date.now() / 1000);
      const reset = parseInt(res.headers.get('X-RateLimit-Reset')!, 10);

      expect(reset).toBeGreaterThan(beforeRequest);
      expect(reset).toBeLessThanOrEqual(afterRequest + 61);
    });

    it('should set Remaining to 0 when rate limited', async () => {
      app.use('*', globalRateLimit({ maxRequests: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const ip = '1.1.1.1';
      await app.request('/test', { headers: { 'X-Forwarded-For': ip } });

      const res = await app.request('/test', { headers: { 'X-Forwarded-For': ip } });
      expect(res.status).toBe(429);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    });
  });
});
