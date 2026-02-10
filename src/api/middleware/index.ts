/**
 * Middleware barrel export for v2doc API.
 *
 * Provides centralized access to all middleware components:
 * - API key authentication
 * - Rate limiting (global, per-key, per-route)
 * - Store management (for testing)
 */

export { getApiKeyStore, resetApiKeyStore } from '../store/api-key-store.js';
export { apiKeyAuth, getAuthMode } from './api-key-auth.js';
export {
  globalRateLimit,
  perKeyRateLimit,
  perRouteRateLimit,
  resetRateLimitStore,
} from './rate-limit.js';
