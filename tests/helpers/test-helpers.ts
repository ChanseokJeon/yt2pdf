/**
 * Test helpers for API authentication tests.
 *
 * Provides utilities for:
 * - Setting up test API keys
 * - Managing auth context for tests
 * - Resetting auth state between tests
 */

import { resetApiKeyStore } from '../../src/api/store/api-key-store.js';
import { resetRateLimitStore } from '../../src/api/middleware/rate-limit.js';

/**
 * Test API key that matches the expected format.
 * This is a valid v2d_ prefixed key for use in tests.
 */
export const TEST_API_KEY = 'v2d_test1234567890abcdef1234567890abcdef1234567890abcdef12';

/**
 * Test user ID associated with the test API key.
 */
export const TEST_USER_ID = 'test-user';

/**
 * Second test API key for multi-user testing.
 */
export const TEST_API_KEY_2 = 'v2d_other123456789abcdef1234567890abcdef1234567890abcdef1';

/**
 * Second test user ID.
 */
export const TEST_USER_ID_2 = 'test-user-2';

/**
 * Set up test authentication environment.
 *
 * Configures:
 * - V2DOC_API_KEYS with test keys
 * - V2DOC_AUTH_MODE to 'enforce'
 * - Resets API key and rate limit stores
 *
 * Call this in beforeEach() for auth-enabled tests.
 */
export function setupTestAuth(): void {
  process.env.V2DOC_API_KEYS = `${TEST_API_KEY}:${TEST_USER_ID}:test-key,${TEST_API_KEY_2}:${TEST_USER_ID_2}:test-key-2`;
  process.env.V2DOC_AUTH_MODE = 'enforce';
  resetApiKeyStore();
  resetRateLimitStore();
}

/**
 * Set up test authentication in warn mode.
 *
 * Similar to setupTestAuth() but uses 'warn' mode instead of 'enforce'.
 * Useful for testing gradual rollout behavior.
 */
export function setupTestAuthWarnMode(): void {
  process.env.V2DOC_API_KEYS = `${TEST_API_KEY}:${TEST_USER_ID}:test-key`;
  process.env.V2DOC_AUTH_MODE = 'warn';
  resetApiKeyStore();
  resetRateLimitStore();
}

/**
 * Set up test authentication in disabled mode.
 *
 * Sets auth mode to 'disabled' for testing bypass behavior.
 */
export function setupTestAuthDisabled(): void {
  process.env.V2DOC_API_KEYS = `${TEST_API_KEY}:${TEST_USER_ID}:test-key`;
  process.env.V2DOC_AUTH_MODE = 'disabled';
  resetApiKeyStore();
  resetRateLimitStore();
}

/**
 * Clean up test authentication environment.
 *
 * Removes:
 * - V2DOC_API_KEYS
 * - V2DOC_AUTH_MODE
 * - Resets API key and rate limit stores
 *
 * Call this in afterEach() to ensure clean state.
 */
export function teardownTestAuth(): void {
  delete process.env.V2DOC_API_KEYS;
  delete process.env.V2DOC_AUTH_MODE;
  resetApiKeyStore();
  resetRateLimitStore();
}

/**
 * Create Authorization header with Bearer token.
 *
 * @param apiKey - API key to use (defaults to TEST_API_KEY)
 * @returns Object with Authorization header
 */
export function authHeader(apiKey: string = TEST_API_KEY): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
  };
}

/**
 * Create headers for authenticated request.
 *
 * @param apiKey - API key to use (defaults to TEST_API_KEY)
 * @param additionalHeaders - Additional headers to merge
 * @returns Combined headers object
 */
export function authHeaders(
  apiKey: string = TEST_API_KEY,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  return {
    ...authHeader(apiKey),
    'Content-Type': 'application/json',
    ...additionalHeaders,
  };
}
