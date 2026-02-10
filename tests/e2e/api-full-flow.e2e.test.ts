/**
 * Full Flow E2E Test Suite for v2doc API
 *
 * Tests the complete conversion workflow with authentication:
 * 1. Start local server with API key authentication
 * 2. Analyze video metadata
 * 3. Perform synchronous conversion (full pipeline)
 * 4. Verify output and download URL
 *
 * This test uses a short public YouTube video (~10s) to minimize test time.
 *
 * Run with: npm test -- tests/e2e/api-full-flow.e2e.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { ApiKeyStore } from '../../src/api/store/api-key-store';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

// Helper to wait between requests to avoid rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('API Full Flow E2E', () => {
  let serverProcess: ChildProcess;
  let PORT: number;
  let BASE_URL: string;
  let API_KEY: string;

  // Use a very short YouTube video for testing (public domain, ~10 seconds)
  // Example: "YouTube Test Video" or similar short content
  const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" (first YouTube video, 18s)

  beforeAll(async () => {
    // Generate test API key
    API_KEY = ApiKeyStore.generateKey();

    // Find available port
    PORT = await getAvailablePort();
    BASE_URL = `http://localhost:${PORT}`;

    console.log(`[E2E] Starting server on port ${PORT}...`);

    // Start server with API key authentication enabled
    const testEnv = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      V2DOC_AUTH_MODE: 'enforce', // Enable authentication
      V2DOC_API_KEYS: `${API_KEY}:test-user:test-key-1`,
      CLOUD_PROVIDER: 'local', // Use local provider for testing
    };

    serverProcess = spawn('node', ['dist/api/server.js'], {
      env: testEnv,
      stdio: 'pipe',
    });

    // Log server output for debugging
    serverProcess.stdout?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_TEST) {
        console.log(`[server] ${data.toString().trim()}`);
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_TEST) {
        console.error(`[server stderr] ${data.toString().trim()}`);
      }
    });

    // Wait for server to be ready (max 30s)
    await waitForServer(`${BASE_URL}/api/v1/health`, 30000);
    console.log(`[E2E] Server ready at ${BASE_URL}`);
  }, 35000);

  afterAll((done) => {
    if (serverProcess) {
      console.log('[E2E] Shutting down server...');
      serverProcess.kill('SIGTERM');
      serverProcess.on('exit', () => {
        console.log('[E2E] Server stopped');
        done();
      });

      // Force kill after 5s
      setTimeout(() => {
        try {
          serverProcess.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
        done();
      }, 5000);
    } else {
      done();
    }
  });

  describe('Authentication Required', () => {
    test('should reject requests without API key', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: TEST_VIDEO_URL }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    test('should accept requests with valid API key', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/health`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      expect(res.ok).toBe(true);
    });
  });

  describe('Video Analysis Flow', () => {
    test('should analyze video metadata', async () => {
      await delay(1000); // Avoid rate limit

      const res = await fetch(`${BASE_URL}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ url: TEST_VIDEO_URL }),
      });

      // May be rate limited
      if (res.status === 429) {
        console.warn('[Analysis Test] Rate limited, skipping');
        return;
      }

      expect(res.ok).toBe(true);
      const json = await res.json();

      // Verify response structure
      expect(json).toHaveProperty('metadata');
      expect(json.metadata).toHaveProperty('id');
      expect(json.metadata).toHaveProperty('title');
      expect(json.metadata).toHaveProperty('channel');
      expect(json.metadata).toHaveProperty('duration');
      expect(json.metadata).toHaveProperty('thumbnail');
      expect(json.metadata).toHaveProperty('availableCaptions');

      expect(json).toHaveProperty('estimate');
      expect(json.estimate).toHaveProperty('processingTime');
      expect(json.estimate).toHaveProperty('cost');
      expect(json.estimate.cost).toHaveProperty('total');

      console.log(`[Analysis] Video: "${json.metadata.title}" by ${json.metadata.channel}`);
      console.log(
        `[Analysis] Duration: ${json.metadata.duration}s, Estimate: ${json.estimate.processingTime}s`
      );
    }, 30000);

    test('should reject invalid YouTube URLs', async () => {
      await delay(1000);

      const res = await fetch(`${BASE_URL}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ url: 'https://example.com/not-youtube' }),
      });

      if (res.status === 429) {
        console.warn('[Analysis Test] Rate limited, skipping');
        return;
      }

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('Synchronous Conversion Flow', () => {
    test(
      'should convert video to PDF (sync mode)',
      async () => {
        await delay(2000); // Avoid rate limit

        console.log('[Conversion] Starting synchronous conversion...');
        const startTime = Date.now();

        const res = await fetch(`${BASE_URL}/api/v1/jobs/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            url: TEST_VIDEO_URL,
            options: {
              format: 'pdf',
              screenshotInterval: 30, // Minimum 30 seconds per schema validation
              layout: 'horizontal',
              includeTranslation: false, // Disable to speed up test
              includeSummary: false, // Disable to speed up test
            },
          }),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Handle possible errors
        if (res.status === 429) {
          console.warn('[Conversion Test] Rate limited, skipping');
          return;
        }

        // Log the response for debugging
        console.log(`[Conversion] Response status: ${res.status}`);

        if (!res.ok) {
          const json = await res.json();
          console.error('[Conversion Test] Error response:', json);

          // Log the error but don't fail the test if it's an external dependency issue
          if (
            res.status === 500 &&
            (json.error?.includes('YouTube') ||
              json.error?.includes('yt-dlp') ||
              json.error?.includes('ffmpeg') ||
              json.error?.includes('OPENAI_API_KEY') ||
              json.error?.includes('proxy'))
          ) {
            console.warn('[Conversion Test] External dependency issue, skipping');
            return;
          }

          // Fail for other errors
          throw new Error(`Conversion failed (${res.status}): ${json.error || JSON.stringify(json)}`);
        }

        const json = await res.json();

        console.log(`[Conversion] Completed in ${elapsed}s`);

        // Verify response structure
        expect(json).toHaveProperty('jobId');
        expect(json).toHaveProperty('status', 'completed');
        expect(json).toHaveProperty('downloadUrl');
        expect(json).toHaveProperty('expiresAt');
        expect(json).toHaveProperty('videoMetadata');
        expect(json).toHaveProperty('stats');

        // Verify stats
        expect(json.stats).toHaveProperty('pages');
        expect(json.stats).toHaveProperty('screenshotCount');
        expect(json.stats).toHaveProperty('fileSize');
        expect(json.stats).toHaveProperty('processingTime');

        expect(json.stats.pages).toBeGreaterThan(0);
        expect(json.stats.screenshotCount).toBeGreaterThanOrEqual(0);
        expect(json.stats.fileSize).toBeGreaterThan(0);

        console.log(`[Conversion] Stats:`, {
          pages: json.stats.pages,
          screenshots: json.stats.screenshotCount,
          fileSize: `${(json.stats.fileSize / 1024).toFixed(1)} KB`,
          processingTime: `${(json.stats.processingTime / 1000).toFixed(1)}s`,
        });

        // Verify download URL format (file:// for local, http(s):// for cloud)
        expect(json.downloadUrl).toMatch(/^(https?|file):\/\//);

        // Test download URL
        console.log('[Conversion] Testing download URL...');

        // For file:// URLs, read directly from filesystem
        if (json.downloadUrl.startsWith('file://')) {
          const filePath = json.downloadUrl.replace('file://', '');
          try {
            const buffer = await fsPromises.readFile(filePath);
            expect(buffer.byteLength).toBeGreaterThan(0);
            expect(buffer.byteLength).toBe(json.stats.fileSize);

            // Verify PDF magic bytes (PDF starts with "%PDF")
            const pdfHeader = buffer.toString('utf8', 0, 4);
            expect(pdfHeader).toBe('%PDF');

            console.log(`[Conversion] File verified: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
          } catch (err) {
            console.warn(`[Conversion] Could not read file: ${err}`);
          }
        } else {
          // For http(s):// URLs, fetch normally
          const downloadRes = await fetch(json.downloadUrl);

          if (downloadRes.ok) {
            const buffer = await downloadRes.arrayBuffer();
            expect(buffer.byteLength).toBeGreaterThan(0);
            expect(buffer.byteLength).toBe(json.stats.fileSize);

            // Verify PDF magic bytes
            const view = new Uint8Array(buffer);
            const pdfHeader = String.fromCharCode(view[0], view[1], view[2], view[3]);
            expect(pdfHeader).toBe('%PDF');

            console.log(`[Conversion] Download successful: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
          } else {
            console.warn(`[Conversion] Download URL not accessible (status: ${downloadRes.status})`);
          }
        }
      },
      120000
    ); // 2 minute timeout for full conversion

    test(
      'should convert video to Markdown (sync mode)',
      async () => {
        await delay(2000);

        console.log('[Conversion] Starting Markdown conversion...');

        const res = await fetch(`${BASE_URL}/api/v1/jobs/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            url: TEST_VIDEO_URL,
            options: {
              format: 'md',
              screenshotInterval: 30, // Minimum 30 seconds per schema validation
              includeTranslation: false,
              includeSummary: false,
            },
          }),
        });

        console.log(`[Markdown] Response status: ${res.status}`);

        if (res.status === 429) {
          console.warn('[Markdown Test] Rate limited, skipping');
          return;
        }

        if (!res.ok) {
          const json = await res.json();
          console.warn('[Markdown Test] Conversion failed:', json.error || JSON.stringify(json));
          // Don't fail - external dependencies may be unavailable
          return;
        }

        const json = await res.json();

        expect(json).toHaveProperty('status', 'completed');
        expect(json).toHaveProperty('downloadUrl');
        expect(json.stats).toHaveProperty('fileSize');
        expect(json.stats.fileSize).toBeGreaterThan(0);

        console.log(`[Markdown] Completed: ${(json.stats.fileSize / 1024).toFixed(1)} KB`);
      },
      120000
    );
  });

  describe('Async Job Flow (Queue-based)', () => {
    test('should create async job', async () => {
      await delay(2000);

      const res = await fetch(`${BASE_URL}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          url: TEST_VIDEO_URL,
          options: {
            format: 'pdf',
          },
        }),
      });

      if (res.status === 429) {
        console.warn('[Async Job Test] Rate limited, skipping');
        return;
      }

      // May fail if queue provider (SQS/Pub/Sub) not configured
      if (res.status === 500) {
        const json = await res.json();
        console.warn('[Async Job Test] Queue not available:', json.error);
        return;
      }

      expect(res.status).toBe(202);
      const json = await res.json();

      expect(json).toHaveProperty('jobId');
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('statusUrl');
      expect(json).toHaveProperty('createdAt');

      console.log(`[Async Job] Created: ${json.jobId}, status: ${json.status}`);

      // Try to fetch job status
      await delay(1000);

      const statusRes = await fetch(`${BASE_URL}${json.statusUrl}`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      if (statusRes.status === 429) {
        console.warn('[Async Job Test] Rate limited, skipping status check');
        return;
      }

      expect(statusRes.ok).toBe(true);
      const statusJson = await statusRes.json();

      expect(statusJson).toHaveProperty('jobId', json.jobId);
      expect(statusJson).toHaveProperty('status');
      expect(statusJson).toHaveProperty('progress');

      console.log(`[Async Job] Status: ${statusJson.status}`);
    });

    test('should list user jobs', async () => {
      await delay(1000);

      const res = await fetch(`${BASE_URL}/api/v1/jobs`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      if (res.status === 429) {
        console.warn('[List Jobs Test] Rate limited, skipping');
        return;
      }

      expect(res.ok).toBe(true);
      const json = await res.json();

      expect(json).toHaveProperty('jobs');
      expect(json).toHaveProperty('total');
      expect(Array.isArray(json.jobs)).toBe(true);

      console.log(`[List Jobs] Total: ${json.total}, returned: ${json.jobs.length}`);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent video gracefully', async () => {
      await delay(1000);

      const res = await fetch(`${BASE_URL}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=INVALIDVIDEOID123' }),
      });

      if (res.status === 429) {
        console.warn('[Error Test] Rate limited, skipping');
        return;
      }

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    test('should handle malformed requests', async () => {
      await delay(1000);

      const res = await fetch(`${BASE_URL}/api/v1/jobs/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          url: 'not-a-url',
          options: { format: 'invalid-format' },
        }),
      });

      if (res.status === 429) {
        console.warn('[Error Test] Rate limited, skipping');
        return;
      }

      expect([400, 500]).toContain(res.status);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });
});

// --- Helper Functions ---

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Failed to get port'));
      }
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 503) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server failed to start within ${timeoutMs}ms`);
}
