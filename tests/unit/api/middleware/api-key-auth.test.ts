/**
 * Unit tests for apiKeyAuth middleware.
 *
 * Tests cover:
 * - P1-5: Disabled mode NEVER trusts X-User-Id header
 * - P2-7: Invalid V2DOC_AUTH_MODE defaults to 'warn'
 * - P2-8: Sanitized log output (no injection)
 * - Enforce mode: rejects missing/invalid keys
 * - Warn mode: allows missing keys with warning
 * - Valid keys: sets userId, apiKeyId, authMode
 * - Exempt routes: no auth required
 * - Type safety: c.get('userId') returns string
 */

import { Hono } from 'hono';
import { apiKeyAuth, getAuthMode } from '../../../../src/api/middleware/api-key-auth.js';
import type { AppEnv } from '../../../../src/api/types.js';
import {
  setupTestAuth,
  setupTestAuthWarnMode,
  setupTestAuthDisabled,
  teardownTestAuth,
  TEST_API_KEY,
  TEST_USER_ID,
} from '../../../helpers/test-helpers.js';

describe('apiKeyAuth middleware', () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = new Hono<AppEnv>();
  });

  afterEach(() => {
    teardownTestAuth();
  });

  describe('Enforce mode', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should reject requests without API key with 401', async () => {
      app.use('*', apiKeyAuth({ mode: 'enforce' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test');

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Authentication required');
      expect(data.message).toContain('Authorization: Bearer');
    });

    it('should reject requests with invalid API key with 401', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'Authorization': 'Bearer invalid-key' },
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid API key');
    });

    it('should accept valid API key', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({
        userId: c.get('userId'),
        apiKeyId: c.get('apiKeyId'),
        authMode: c.get('authMode'),
      }));

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID);
      expect(data.apiKeyId).toBeDefined();
      expect(data.authMode).toBe('authenticated');
    });

    it('should handle Bearer token with extra whitespace', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer   ${TEST_API_KEY}   ` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID);
    });

    it('should reject malformed Authorization header', async () => {
      app.use('*', apiKeyAuth({ mode: 'enforce' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'Authorization': TEST_API_KEY }, // Missing "Bearer"
      });

      expect(res.status).toBe(401);
    });

    it('should extract key from alternate header if configured', async () => {
      app.use('*', apiKeyAuth({ alternateHeader: 'X-API-Key' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID);
    });

    it('should prioritize Authorization header over alternate', async () => {
      const otherKey = 'v2d_other123456789abcdef1234567890abcdef1234567890abcdef1';

      app.use('*', apiKeyAuth({ alternateHeader: 'X-API-Key' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
          'X-API-Key': otherKey,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID); // From TEST_API_KEY, not otherKey
    });
  });

  describe('Warn mode', () => {
    beforeEach(() => {
      setupTestAuthWarnMode();
    });

    it('should allow requests without API key', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({
        userId: c.get('userId'),
        authMode: c.get('authMode'),
      }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
      expect(data.authMode).toBe('warn');
    });

    it('should set X-Auth-Warning header for unauthenticated requests', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Auth-Warning')).toContain('API key will be required');
    });

    it('should still reject invalid API keys with 401', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { 'Authorization': 'Bearer invalid-key' },
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid API key');
    });

    it('should accept valid API keys normally', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({
        userId: c.get('userId'),
        authMode: c.get('authMode'),
      }));

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID);
      expect(data.authMode).toBe('authenticated');
      expect(res.headers.get('X-Auth-Warning')).toBeNull();
    });

    it('should log warning for unauthenticated requests (P2-8)', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      app.use('*', apiKeyAuth());
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnMessage = consoleWarnSpy.mock.calls[0][0];
      expect(warnMessage).toContain('[Auth] Unauthenticated request');
      expect(warnMessage).toContain('GET');
      expect(warnMessage).toContain('/test');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Disabled mode - P1-5: NEVER trust X-User-Id', () => {
    beforeEach(() => {
      setupTestAuthDisabled();
    });

    it('should ALWAYS return anonymous userId', async () => {
      app.use('*', apiKeyAuth({ mode: 'disabled' }));
      app.get('/test', (c) => c.json({
        userId: c.get('userId'),
        authMode: c.get('authMode'),
      }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
      expect(data.authMode).toBe('anonymous');
    });

    it('should ignore X-User-Id header', async () => {
      app.use('*', apiKeyAuth({ mode: 'disabled' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'X-User-Id': 'malicious-user' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous'); // NOT 'malicious-user'
    });

    it('should ignore Authorization header', async () => {
      app.use('*', apiKeyAuth({ mode: 'disabled' }));
      app.get('/test', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous'); // Key is ignored
    });

    it('should NOT validate any keys', async () => {
      app.use('*', apiKeyAuth({ mode: 'disabled' }));
      app.get('/test', (c) => c.json({
        userId: c.get('userId'),
        apiKeyId: c.get('apiKeyId'),
      }));

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
      expect(data.apiKeyId).toBeUndefined();
    });
  });

  describe('Exempt routes', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should skip auth for /api/v1/health', async () => {
      app.use('*', apiKeyAuth());
      app.get('/api/v1/health', (c) => c.json({
        userId: c.get('userId'),
        authMode: c.get('authMode'),
      }));

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
      expect(data.authMode).toBe('anonymous');
    });

    it('should skip auth for /docs', async () => {
      app.use('*', apiKeyAuth());
      app.get('/docs', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/docs');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
    });

    it('should skip auth for /openapi.json', async () => {
      app.use('*', apiKeyAuth());
      app.get('/openapi.json', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/openapi.json');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
    });

    it('should skip auth for root path /', async () => {
      app.use('*', apiKeyAuth());
      app.get('/', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
    });

    it('should match exempt routes with trailing paths', async () => {
      app.use('*', apiKeyAuth());
      app.get('/api/v1/health/ready', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/api/v1/health/ready');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
    });

    it('should require auth for non-exempt routes', async () => {
      app.use('*', apiKeyAuth({ mode: 'enforce' }));
      app.get('/api/v1/jobs', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/api/v1/jobs');

      expect(res.status).toBe(401); // Not exempt
    });

    it('should allow custom exempt routes', async () => {
      app.use('*', apiKeyAuth({ exemptRoutes: ['/public'] }));
      app.get('/public', (c) => c.json({ userId: c.get('userId') }));

      const res = await app.request('/public');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe('anonymous');
    });
  });

  describe('Type safety', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should allow c.get("userId") without type assertion', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => {
        // This should compile without 'as string'
        const userId: string = c.get('userId');
        return c.json({ userId });
      });

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(TEST_USER_ID);
    });

    it('should provide typed access to apiKeyId', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => {
        const apiKeyId: string | undefined = c.get('apiKeyId');
        return c.json({ hasKey: apiKeyId !== undefined });
      });

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasKey).toBe(true);
    });

    it('should provide typed access to authMode', async () => {
      app.use('*', apiKeyAuth());
      app.get('/test', (c) => {
        const authMode: 'authenticated' | 'anonymous' | 'warn' = c.get('authMode');
        return c.json({ authMode });
      });

      const res = await app.request('/test', {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authMode).toBe('authenticated');
    });
  });

  describe('getAuthMode() - P2-7: Invalid mode defaults to warn', () => {
    afterEach(() => {
      delete process.env.V2DOC_AUTH_MODE;
    });

    it('should return enforce for valid value', () => {
      process.env.V2DOC_AUTH_MODE = 'enforce';
      expect(getAuthMode()).toBe('enforce');
    });

    it('should return warn for valid value', () => {
      process.env.V2DOC_AUTH_MODE = 'warn';
      expect(getAuthMode()).toBe('warn');
    });

    it('should return disabled for valid value', () => {
      process.env.V2DOC_AUTH_MODE = 'disabled';
      expect(getAuthMode()).toBe('disabled');
    });

    it('should default to warn for invalid value', () => {
      process.env.V2DOC_AUTH_MODE = 'invalid-mode';
      expect(getAuthMode()).toBe('warn');
    });

    it('should default to warn when not set', () => {
      delete process.env.V2DOC_AUTH_MODE;
      expect(getAuthMode()).toBe('warn');
    });

    it('should log warning for invalid value', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      process.env.V2DOC_AUTH_MODE = 'invalid-mode';

      getAuthMode();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Auth] Invalid V2DOC_AUTH_MODE')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('defaulting to "warn"')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should sanitize invalid value in log (P2-8)', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      process.env.V2DOC_AUTH_MODE = 'malicious\n\rvalue';

      getAuthMode();

      const warnMessage = consoleWarnSpy.mock.calls[0][0];
      expect(warnMessage).not.toContain('\n');
      expect(warnMessage).not.toContain('\r');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Configuration', () => {
    beforeEach(() => {
      setupTestAuth();
    });

    it('should use mode from constructor config', async () => {
      process.env.V2DOC_AUTH_MODE = 'enforce';

      app.use('*', apiKeyAuth({ mode: 'warn' }));
      app.get('/test', (c) => c.json({ authMode: c.get('authMode') }));

      const res = await app.request('/test');

      expect(res.status).toBe(200); // Warn mode allows
      const data = await res.json();
      expect(data.authMode).toBe('warn');
    });

    it('should merge custom config with defaults', async () => {
      app.use('*', apiKeyAuth({
        mode: 'enforce',
        exemptRoutes: ['/custom', '/docs'], // Must include both
      }));
      app.get('/custom', (c) => c.json({ ok: true }));
      app.get('/docs', (c) => c.json({ ok: true }));

      const customRes = await app.request('/custom');
      const docsRes = await app.request('/docs');

      expect(customRes.status).toBe(200); // Custom exempt
      expect(docsRes.status).toBe(200); // Explicitly exempted
    });
  });
});
