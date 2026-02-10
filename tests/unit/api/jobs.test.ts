import { app } from '../../../src/api/app';
import { resetJobStore, getJobStore } from '../../../src/api/store';
import { resetCloudProvider } from '../../../src/cloud';
import {
  setupTestAuth,
  setupTestAuthWarnMode,
  teardownTestAuth,
  TEST_API_KEY,
  TEST_USER_ID,
  TEST_API_KEY_2,
  TEST_USER_ID_2,
  authHeaders,
} from '../../helpers/test-helpers';

describe('Jobs API', () => {
  beforeEach(() => {
    resetJobStore();
    resetCloudProvider();
  });

  afterEach(() => {
    teardownTestAuth();
  });

  describe('POST /api/v1/jobs', () => {
    beforeEach(() => {
      setupTestAuthWarnMode(); // Use warn mode to allow tests without breaking existing behavior
    });

    it('should create a job with valid YouTube URL', async () => {
      const res = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('queued');
      expect(data.statusUrl).toContain('/api/v1/jobs/');
    });

    it('should reject invalid URL', async () => {
      const res = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://example.com/not-youtube',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should accept custom options', async () => {
      const res = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://youtu.be/dQw4w9WgXcQ',
          options: {
            format: 'pdf',
            layout: 'minimal-neon',
            quality: 'medium',
          },
        }),
      });

      expect(res.status).toBe(202);
    });

    it('should allow unauthenticated requests in warn mode', async () => {
      const res = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });

      expect(res.status).toBe(202);
      expect(res.headers.get('X-Auth-Warning')).toBeDefined();
    });
  });

  describe('GET /api/v1/jobs/:jobId', () => {
    beforeEach(() => {
      setupTestAuth(); // Use enforce mode for ownership tests
    });

    it('should return job status for own job', async () => {
      // Create a job first
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // Get status with same user
      const res = await app.request(`/api/v1/jobs/${jobId}`, {
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.jobId).toBe(jobId);
      expect(data.status).toBe('queued');
    });

    it('should return 404 for non-existent job', async () => {
      const res = await app.request('/api/v1/jobs/non-existent-id', {
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(404);
    });

    it('should return 404 when accessing other user\'s job (P0-2)', async () => {
      // User 1 creates a job
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // User 2 tries to access it
      const res = await app.request(`/api/v1/jobs/${jobId}`, {
        headers: authHeaders(TEST_API_KEY_2),
      });

      expect(res.status).toBe(404); // Not 403, to avoid leaking job existence
    });

    it('should allow anonymous users to access their own jobs', async () => {
      setupTestAuthWarnMode(); // Switch to warn mode

      // Anonymous user creates a job
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // Same anonymous user can access it
      const res = await app.request(`/api/v1/jobs/${jobId}`);
      expect(res.status).toBe(200);
    });

    it('should NOT allow anonymous users to access authenticated users\' jobs (P0-2)', async () => {
      // Authenticated user creates a job
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // Switch to warn mode and try anonymous access
      setupTestAuthWarnMode();
      const res = await app.request(`/api/v1/jobs/${jobId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/jobs/:jobId', () => {
    beforeEach(() => {
      setupTestAuth(); // Use enforce mode for ownership tests
    });

    it('should cancel own queued job', async () => {
      // Create a job
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // Cancel with same user
      const res = await app.request(`/api/v1/jobs/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('cancelled');
    });

    it('should return 404 for non-existent job', async () => {
      const res = await app.request('/api/v1/jobs/non-existent', {
        method: 'DELETE',
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(404);
    });

    it('should return 404 when deleting other user\'s job (P0-2)', async () => {
      // User 1 creates a job
      const createRes = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      });
      const { jobId } = await createRes.json();

      // User 2 tries to delete it
      const res = await app.request(`/api/v1/jobs/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders(TEST_API_KEY_2),
      });

      expect(res.status).toBe(404); // Not 403
    });
  });

  describe('GET /api/v1/jobs', () => {
    beforeEach(() => {
      setupTestAuth(); // Use enforce mode for ownership tests
    });

    it('should list only current user\'s jobs (P0-2)', async () => {
      // User 1 creates jobs
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      });
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }),
      });

      // User 2 creates a job
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY_2),
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' }),
      });

      // User 1 lists jobs
      const res = await app.request('/api/v1/jobs', {
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.jobs.length).toBe(2); // Only user 1's jobs
      expect(data.total).toBe(2);
    });

    it('should support pagination', async () => {
      const res = await app.request('/api/v1/jobs?limit=5&offset=0', {
        headers: authHeaders(TEST_API_KEY),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.limit).toBe(5);
      expect(data.offset).toBe(0);
    });

    it('should return empty list for user with no jobs', async () => {
      // User 1 creates jobs
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: authHeaders(TEST_API_KEY),
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      });

      // User 2 lists jobs (has none)
      const res = await app.request('/api/v1/jobs', {
        headers: authHeaders(TEST_API_KEY_2),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.jobs.length).toBe(0);
      expect(data.total).toBe(0);
    });

    it('should allow anonymous users to list their own jobs', async () => {
      setupTestAuthWarnMode(); // Switch to warn mode

      // Anonymous user creates jobs
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      });
      await app.request('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }),
      });

      // List
      const res = await app.request('/api/v1/jobs');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.jobs.length).toBe(2);
    });
  });
});
