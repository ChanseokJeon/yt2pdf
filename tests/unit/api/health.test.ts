import { app } from '../../../src/api/app';
import { getCloudProvider } from '../../../src/cloud/factory';
import { FFmpegWrapper } from '../../../src/providers/ffmpeg';
import { YouTubeProvider } from '../../../src/providers/youtube';
import { resetCloudProvider } from '../../../src/cloud';

// Mock the dependencies
jest.mock('../../../src/cloud/factory');
jest.mock('../../../src/providers/ffmpeg');
jest.mock('../../../src/providers/youtube');

const mockedGetCloudProvider = jest.mocked(getCloudProvider);
const mockedFFmpegWrapper = jest.mocked(FFmpegWrapper);
const mockedYouTubeProvider = jest.mocked(YouTubeProvider);

describe('Health Check Routes', () => {
  // Mock providers
  const mockStorageProvider = {
    exists: jest.fn(),
  };

  const mockQueueProvider = {
    sendMessage: jest.fn(),
    receiveMessages: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetCloudProvider();

    // Setup default mocks
    mockedGetCloudProvider.mockResolvedValue({
      storage: mockStorageProvider as any,
      queue: mockQueueProvider as any,
    });
  });

  describe('GET /api/v1/health', () => {
    it('should return healthy status when all dependencies are healthy', async () => {
      // Mock all dependencies as healthy
      mockedFFmpegWrapper.checkInstallation.mockResolvedValue(true);
      mockedYouTubeProvider.checkInstallation.mockResolvedValue(true);
      mockStorageProvider.exists.mockResolvedValue(false); // doesn't matter, just needs to not throw

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toMatchObject({
        status: 'healthy',
        dependencies: {
          ffmpeg: 'healthy',
          ytdlp: 'healthy',
          storage: 'healthy',
          queue: 'healthy',
        },
      });
      expect(data.version).toBeDefined();
      expect(data.timestamp).toBeDefined();
      expect(new Date(data.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should return degraded status when some dependencies are unhealthy', async () => {
      // Mock some dependencies as unhealthy
      mockedFFmpegWrapper.checkInstallation.mockResolvedValue(true);
      mockedYouTubeProvider.checkInstallation.mockResolvedValue(false); // Unhealthy
      mockStorageProvider.exists.mockResolvedValue(false);

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.status).toBe('degraded');
      expect(data.dependencies.ytdlp).toBe('unhealthy');
      expect(data.dependencies.ffmpeg).toBe('healthy');
      expect(data.dependencies.storage).toBe('healthy');
      expect(data.dependencies.queue).toBe('healthy');
    });

    it('should return unhealthy status (503) when all dependencies fail', async () => {
      // Mock all dependencies as unhealthy
      mockedFFmpegWrapper.checkInstallation.mockRejectedValue(new Error('FFmpeg not found'));
      mockedYouTubeProvider.checkInstallation.mockRejectedValue(new Error('yt-dlp not found'));
      mockStorageProvider.exists.mockRejectedValue(new Error('Storage unavailable'));
      mockedGetCloudProvider.mockRejectedValue(new Error('Cloud provider error'));

      const res = await app.request('/api/v1/health');

      // When all dependencies are unhealthy, status should be 'unhealthy' with 503 status code
      expect(res.status).toBe(503);
      const data = await res.json();

      expect(data.status).toBe('unhealthy');
      expect(data.dependencies.ffmpeg).toBe('unhealthy');
      expect(data.dependencies.ytdlp).toBe('unhealthy');
      expect(data.dependencies.storage).toBe('unhealthy');
      expect(data.dependencies.queue).toBe('unhealthy');
    });

    it('should check storage connectivity', async () => {
      mockedFFmpegWrapper.checkInstallation.mockResolvedValue(true);
      mockedYouTubeProvider.checkInstallation.mockResolvedValue(true);
      mockStorageProvider.exists.mockResolvedValue(true);

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      expect(mockedGetCloudProvider).toHaveBeenCalled();
      // Storage health check uses actual bucket name from env (defaults to 'yt2pdf-output')
      expect(mockStorageProvider.exists).toHaveBeenCalledWith(
        expect.any(String), // bucket name from env
        '.health-check'
      );

      const data = await res.json();
      expect(data.dependencies.storage).toBe('healthy');
    });

    it('should check queue connectivity', async () => {
      mockedFFmpegWrapper.checkInstallation.mockResolvedValue(true);
      mockedYouTubeProvider.checkInstallation.mockResolvedValue(true);
      mockStorageProvider.exists.mockResolvedValue(false);

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      expect(mockedGetCloudProvider).toHaveBeenCalled();

      const data = await res.json();
      expect(data.dependencies.queue).toBe('healthy');
    });

    it('should run all checks in parallel', async () => {
      const startTime = Date.now();

      // Make each check take 100ms
      mockedFFmpegWrapper.checkInstallation.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(true), 100))
      );
      mockedYouTubeProvider.checkInstallation.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(true), 100))
      );
      mockStorageProvider.exists.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(false), 100))
      );

      await app.request('/api/v1/health');

      const elapsed = Date.now() - startTime;

      // If parallel, should complete in ~100ms, not 400ms
      // Add some buffer for test execution
      expect(elapsed).toBeLessThan(300);
    });

    it('should handle storage timeout', async () => {
      mockedFFmpegWrapper.checkInstallation.mockResolvedValue(true);
      mockedYouTubeProvider.checkInstallation.mockResolvedValue(true);

      // Mock storage to take longer than timeout (3000ms)
      mockStorageProvider.exists.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(false), 4000))
      );

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200); // degraded, not unhealthy
      const data = await res.json();
      expect(data.dependencies.storage).toBe('unhealthy');
    }, 10000); // Increase timeout for this test
  });

  describe('GET /api/v1/health/ready', () => {
    it('should return 200 when storage and queue are healthy', async () => {
      mockStorageProvider.exists.mockResolvedValue(false);

      const res = await app.request('/api/v1/health/ready');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toEqual({
        ready: true,
        storage: 'healthy',
        queue: 'healthy',
      });
    });

    it('should return 503 when storage is unhealthy', async () => {
      mockStorageProvider.exists.mockRejectedValue(new Error('Storage error'));

      const res = await app.request('/api/v1/health/ready');

      expect(res.status).toBe(503);
      const data = await res.json();

      expect(data.ready).toBe(false);
      expect(data.storage).toBe('unhealthy');
    });

    it('should return 503 when queue is unhealthy', async () => {
      mockStorageProvider.exists.mockResolvedValue(false);
      mockedGetCloudProvider.mockRejectedValue(new Error('Queue error'));

      const res = await app.request('/api/v1/health/ready');

      expect(res.status).toBe(503);
      const data = await res.json();

      expect(data.ready).toBe(false);
      expect(data.queue).toBe('unhealthy');
    });

    it('should return 503 when both storage and queue are unhealthy', async () => {
      mockStorageProvider.exists.mockRejectedValue(new Error('Storage error'));
      mockedGetCloudProvider.mockRejectedValue(new Error('Queue error'));

      const res = await app.request('/api/v1/health/ready');

      expect(res.status).toBe(503);
      const data = await res.json();

      expect(data.ready).toBe(false);
      expect(data.storage).toBe('unhealthy');
      expect(data.queue).toBe('unhealthy');
    });

    it('should use shorter timeout (2000ms) for readiness check', async () => {
      const startTime = Date.now();

      // Mock storage to timeout
      mockStorageProvider.exists.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(false), 3000))
      );

      await app.request('/api/v1/health/ready');

      const elapsed = Date.now() - startTime;

      // Should timeout at ~2000ms, not wait full 3000ms
      expect(elapsed).toBeGreaterThan(1900);
      expect(elapsed).toBeLessThan(2500);
    }, 10000); // Increase timeout for this test

    it('should check both storage and queue in parallel', async () => {
      const startTime = Date.now();

      // Make each check take 100ms
      mockStorageProvider.exists.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(false), 100))
      );

      await app.request('/api/v1/health/ready');

      const elapsed = Date.now() - startTime;

      // If parallel, should complete in ~100ms, not 200ms
      expect(elapsed).toBeLessThan(250);
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('should always return 200 with { live: true }', async () => {
      const res = await app.request('/api/v1/health/live');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toEqual({ live: true });
    });

    it('should return live status even when dependencies fail', async () => {
      // Mock all dependencies as failing
      mockedFFmpegWrapper.checkInstallation.mockRejectedValue(new Error('Failed'));
      mockedYouTubeProvider.checkInstallation.mockRejectedValue(new Error('Failed'));
      mockedGetCloudProvider.mockRejectedValue(new Error('Failed'));

      const res = await app.request('/api/v1/health/live');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toEqual({ live: true });
    });

    it('should respond quickly without dependency checks', async () => {
      const startTime = Date.now();

      await app.request('/api/v1/health/live');

      const elapsed = Date.now() - startTime;

      // Should be nearly instant (< 50ms)
      expect(elapsed).toBeLessThan(50);
    });

    it('should not call any dependency check functions', async () => {
      await app.request('/api/v1/health/live');

      expect(mockedFFmpegWrapper.checkInstallation).not.toHaveBeenCalled();
      expect(mockedYouTubeProvider.checkInstallation).not.toHaveBeenCalled();
      expect(mockedGetCloudProvider).not.toHaveBeenCalled();
    });
  });
});
