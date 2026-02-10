import type { Context, MiddlewareHandler } from 'hono';
import { getApiKeyStore } from '../store/api-key-store.js';
import type { ApiKeyAuthConfig, AppEnv } from '../types.js';

/**
 * Sanitize a string for safe log output.
 *
 * Prevents log injection attacks (CWE-117) by stripping non-printable
 * characters and truncating to a safe length. Also prevents PII
 * leakage by limiting the logged value size.
 *
 * @param input - The input string to sanitize
 * @param maxLength - Maximum length of the output (default: 45)
 * @returns Sanitized string safe for logging
 */
function sanitizeForLog(input: string, maxLength = 45): string {
  return input.replace(/[^\x20-\x7E]/g, '').substring(0, maxLength);
}

/**
 * Validate and return the auth mode from environment variable.
 *
 * Instead of an unsafe `as` cast on V2DOC_AUTH_MODE, this function
 * validates the value and falls back to 'warn' for invalid input.
 *
 * @returns Validated auth mode
 */
export function getAuthMode(): ApiKeyAuthConfig['mode'] {
  const raw = process.env.V2DOC_AUTH_MODE;
  if (raw === 'enforce' || raw === 'warn' || raw === 'disabled') return raw;
  if (raw) {
    console.warn(`[Auth] Invalid V2DOC_AUTH_MODE="${sanitizeForLog(raw)}", defaulting to "warn"`);
  }
  return 'warn';
}

/**
 * Default configuration for API key authentication.
 */
const DEFAULT_CONFIG: ApiKeyAuthConfig = {
  mode: 'warn', // Start in warn mode for gradual rollout
  exemptRoutes: ['/api/v1/health', '/docs', '/openapi.json', '/'],
  // X-API-Key support can be explicitly enabled if needed.
  alternateHeader: undefined,
};

/**
 * Extract API key from request.
 *
 * Checks in order:
 * 1. Authorization: Bearer <key>
 * 2. Alternate header (if configured)
 *
 * @param c - Hono context
 * @param config - Auth configuration
 * @returns API key string or null if not found
 */
function extractApiKey(c: Context, config: ApiKeyAuthConfig): string | null {
  // Check Authorization header first
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // Check alternate header (only if explicitly configured)
  if (config.alternateHeader) {
    const altKey = c.req.header(config.alternateHeader);
    if (altKey) return altKey.trim();
  }

  return null;
}

/**
 * Check if a route path is exempt from authentication.
 *
 * @param path - Request path
 * @param exemptRoutes - List of exempt route prefixes
 * @returns True if the path is exempt
 */
function isExemptRoute(path: string, exemptRoutes: string[]): boolean {
  return exemptRoutes.some((exempt) => {
    // Exact match
    if (path === exempt) return true;
    // Prefix match (e.g., /api/v1/health matches /api/v1/health/ready)
    if (path.startsWith(exempt + '/')) return true;
    return false;
  });
}

/**
 * API Key Authentication Middleware for Hono.
 *
 * Sets the following context variables (typed via AppEnv):
 * - apiKeyId: The key record ID (or undefined)
 * - userId: The validated user ID (or 'anonymous')
 * - authMode: 'authenticated' | 'anonymous' | 'warn'
 *
 * Error responses:
 * - 401: Missing or invalid API key (in enforce mode)
 * - 403: API key is deactivated or expired
 *
 * Usage:
 *   app.use('*', apiKeyAuth());
 *   app.use('*', apiKeyAuth({ mode: 'enforce' }));
 *
 * @param userConfig - Optional configuration overrides
 * @returns Hono middleware handler
 */
export function apiKeyAuth(userConfig?: Partial<ApiKeyAuthConfig>): MiddlewareHandler<AppEnv> {
  const config: ApiKeyAuthConfig = { ...DEFAULT_CONFIG, ...userConfig };

  return async (c, next) => {
    // Skip auth for exempt routes
    if (isExemptRoute(c.req.path, config.exemptRoutes)) {
      c.set('apiKeyId', undefined);
      c.set('userId', 'anonymous');
      c.set('authMode', 'anonymous');
      return next();
    }

    // Skip entirely if disabled -- ALWAYS set anonymous (P1-5)
    // v1 read X-User-Id from the request header in disabled mode, which
    // re-enabled the IDOR vulnerability the design is trying to fix.
    if (config.mode === 'disabled') {
      c.set('apiKeyId', undefined);
      c.set('userId', 'anonymous'); // NEVER trust X-User-Id from request
      c.set('authMode', 'anonymous');
      return next();
    }

    // Extract key from request
    const apiKey = extractApiKey(c, config);

    // No key provided
    if (!apiKey) {
      if (config.mode === 'warn') {
        // Warn mode: allow but warn
        c.set('apiKeyId', undefined);
        c.set('userId', 'anonymous');
        c.set('authMode', 'warn');
        c.header(
          'X-Auth-Warning',
          'API key will be required in a future version. See /docs for details.'
        );
        // Sanitize log output (P2-8)
        const clientInfo = sanitizeForLog(c.req.header('x-forwarded-for') || 'unknown');
        console.warn(
          `[Auth] Unauthenticated request to ${c.req.method} ${sanitizeForLog(c.req.path)} from ${clientInfo}`
        );
        return next();
      }

      // Enforce mode: reject
      return c.json(
        {
          error: 'Authentication required',
          message: 'Include "Authorization: Bearer <api_key>" header. See /docs for details.',
        },
        401
      );
    }

    // Validate the key
    const store = getApiKeyStore();
    const keyRecord = store.validate(apiKey);

    if (!keyRecord) {
      // Invalid key -- always reject (even in warn mode)
      // Providing an invalid key is different from providing no key
      return c.json(
        {
          error: 'Invalid API key',
          message: 'The provided API key is invalid, expired, or deactivated.',
        },
        401
      );
    }

    // Valid key -- set context
    c.set('apiKeyId', keyRecord.id);
    c.set('userId', keyRecord.userId);
    c.set('authMode', 'authenticated');

    return next();
  };
}
