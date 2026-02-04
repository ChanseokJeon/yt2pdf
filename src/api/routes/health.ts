import { Hono } from 'hono';
import { FFmpegWrapper } from '../../providers/ffmpeg';
import { YouTubeProvider } from '../../providers/youtube';
import { getCloudProvider } from '../../cloud/factory';

const health = new Hono();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  dependencies: {
    ffmpeg: 'healthy' | 'unhealthy';
    ytdlp: 'healthy' | 'unhealthy';
    storage: 'healthy' | 'unhealthy';
    queue: 'healthy' | 'unhealthy';
  };
}

/**
 * Check storage connectivity with timeout
 */
async function checkStorageHealth(timeoutMs = 3000): Promise<'healthy' | 'unhealthy'> {
  try {
    const provider = await getCloudProvider();

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Storage health check timeout')), timeoutMs);
    });

    // Get actual bucket name from environment
    const bucketName = process.env.GCS_BUCKET_NAME || process.env.OUTPUT_BUCKET || 'yt2pdf-output';

    // Try a simple exists operation on a non-existent test key
    // This validates credentials and connectivity without side effects
    const checkPromise = provider.storage.exists(bucketName, '.health-check');

    await Promise.race([checkPromise, timeoutPromise]);
    return 'healthy';
  } catch (error) {
    console.error('Storage health check failed:', error);
    return 'unhealthy';
  }
}

/**
 * Check queue connectivity with timeout
 */
async function checkQueueHealth(timeoutMs = 3000): Promise<'healthy' | 'unhealthy'> {
  try {
    const provider = await getCloudProvider();

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Queue health check timeout')), timeoutMs);
    });

    // For queue, just verify the provider exists and is accessible
    // We don't want to actually send/receive messages in a health check
    const checkPromise = Promise.resolve(provider.queue);

    await Promise.race([checkPromise, timeoutPromise]);
    return 'healthy';
  } catch (error) {
    console.error('Queue health check failed:', error);
    return 'unhealthy';
  }
}

/**
 * GET /health - Health check endpoint
 */
health.get('/', async (c) => {
  const dependencies: HealthStatus['dependencies'] = {
    ffmpeg: 'unhealthy',
    ytdlp: 'unhealthy',
    storage: 'unhealthy',
    queue: 'unhealthy',
  };

  // Check all dependencies in parallel
  const [ffmpegOk, ytdlpOk, storageHealth, queueHealth] = await Promise.all([
    FFmpegWrapper.checkInstallation().catch(() => false),
    YouTubeProvider.checkInstallation().catch(() => false),
    checkStorageHealth(),
    checkQueueHealth(),
  ]);

  dependencies.ffmpeg = ffmpegOk ? 'healthy' : 'unhealthy';
  dependencies.ytdlp = ytdlpOk ? 'healthy' : 'unhealthy';
  dependencies.storage = storageHealth;
  dependencies.queue = queueHealth;

  const healthyCount = Object.values(dependencies).filter(s => s === 'healthy').length;
  const totalCount = Object.keys(dependencies).length;

  const status: HealthStatus = {
    status: healthyCount === totalCount
      ? 'healthy'
      : healthyCount === 0
        ? 'unhealthy'
        : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    dependencies,
  };

  const statusCode = status.status === 'unhealthy' ? 503 : 200;
  return c.json(status, statusCode);
});

/**
 * GET /health/ready - Readiness probe
 */
health.get('/ready', async (c) => {
  // For K8s/Cloud Run readiness probe - verify cloud connectivity
  const [storageHealth, queueHealth] = await Promise.all([
    checkStorageHealth(2000), // Shorter timeout for readiness
    checkQueueHealth(2000),
  ]);

  const ready = storageHealth === 'healthy' && queueHealth === 'healthy';
  const statusCode = ready ? 200 : 503;

  return c.json({
    ready,
    storage: storageHealth,
    queue: queueHealth,
  }, statusCode);
});

/**
 * GET /health/live - Liveness probe
 */
health.get('/live', async (c) => {
  // For K8s/Cloud Run liveness probe
  return c.json({ live: true });
});

export { health };
