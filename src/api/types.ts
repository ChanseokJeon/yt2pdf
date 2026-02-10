/**
 * Auth context types for v2doc API middleware.
 *
 * These types define the context variables set by the auth middleware
 * and consumed by route handlers via c.get().
 */

import type { Env } from 'hono';

/**
 * API key record stored in the key store.
 */
export interface ApiKeyRecord {
  /** Unique identifier for this API key (for logging, rate limiting) */
  id: string;
  /** User-friendly label (e.g., "production-cli", "test-key") */
  name: string;
  /** SHA-256 hash of the actual API key */
  hashedKey: string;
  /** The user identity associated with this key */
  userId: string;
  /** Whether this key is currently active */
  isActive: boolean;
  /** Optional expiration date (ISO 8601 string, or null if no expiry) */
  expiresAt: string | null;
  /** Rate limit overrides for this specific key */
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };
  /** ISO timestamp when key was created */
  createdAt: string;
  /** ISO timestamp when key was last used (updated async) */
  lastUsedAt: string | null;
}

/**
 * Hono context variables set by auth middleware.
 * Access via c.get('apiKeyId'), c.get('userId'), etc.
 */
export interface AuthVariables {
  /** API key record ID (undefined if unauthenticated) */
  apiKeyId: string | undefined;
  /** Validated user ID from API key (falls back to 'anonymous') */
  userId: string;
  /** Authentication mode */
  authMode: 'authenticated' | 'anonymous' | 'warn';
}

/**
 * Application-wide Hono environment type.
 *
 * Used as a generic parameter on all OpenAPIHono instances to provide
 * type-safe access to auth context variables without unsafe casts.
 *
 * Usage:
 *   const app = new OpenAPIHono<AppEnv>();
 *   // In route handlers:
 *   const userId = c.get('userId'); // TypeScript knows this is `string`
 */
export interface AppEnv extends Env {
  Variables: AuthVariables;
}

/**
 * Configuration for the API key auth middleware.
 */
export interface ApiKeyAuthConfig {
  /**
   * Enforcement mode:
   * - 'enforce': Reject unauthenticated requests with 401
   * - 'warn': Allow unauthenticated but add warning header
   * - 'disabled': Skip authentication entirely
   */
  mode: 'enforce' | 'warn' | 'disabled';

  /**
   * Routes that are exempt from authentication.
   * Matched as path prefixes.
   */
  exemptRoutes: string[];

  /**
   * Custom header name for API key (alternative to Authorization).
   * Default: undefined (only Authorization: Bearer is accepted)
   */
  alternateHeader?: string;
}

/**
 * Configuration for rate limiting.
 */
export interface RateLimitConfig {
  /** Global rate limit (per IP) */
  global: {
    windowMs: number;
    maxRequests: number;
  };
  /** Per-API-key rate limit */
  perKey: {
    windowMs: number;
    maxRequests: number;
  };
  /** Per-route overrides (path prefix -> config) */
  routeOverrides: Record<
    string,
    {
      windowMs: number;
      maxRequests: number;
    }
  >;
}

/**
 * Typed OpenAPI security scheme extension.
 *
 * Used instead of `as any` on the OpenAPI doc config to provide
 * type-safe security scheme declarations while preserving type
 * checking on all other OpenAPI fields.
 */
export interface OpenAPISecurityExtension {
  security?: Array<Record<string, string[]>>;
  components?: {
    securitySchemes?: Record<
      string,
      {
        type: string;
        scheme?: string;
        bearerFormat?: string;
        description?: string;
      }
    >;
  };
}
