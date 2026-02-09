import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { FFmpegWrapper } from '../../providers/ffmpeg';
import { YouTubeProvider } from '../../providers/youtube';
import { getCloudProvider } from '../../cloud/factory';
import { HealthStatusSchema } from '../models/job';

const health = new OpenAPIHono();

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

// --- OpenAPI Route Definitions ---

const healthCheckRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: 'Health check',
  description:
    'Check the health status of the API and its dependencies (ffmpeg, yt-dlp, storage, queue).',
  responses: {
    200: {
      description: 'Service is healthy or degraded',
      content: {
        'application/json': {
          schema: HealthStatusSchema,
        },
      },
    },
    503: {
      description: 'Service is unhealthy',
      content: {
        'application/json': {
          schema: HealthStatusSchema,
        },
      },
    },
  },
});

const readinessRoute = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['Health'],
  summary: 'Readiness probe',
  description: 'Kubernetes/Cloud Run readiness probe. Verifies cloud connectivity.',
  responses: {
    200: {
      description: 'Service is ready',
      content: {
        'application/json': {
          schema: z.object({
            ready: z.boolean(),
            storage: z.enum(['healthy', 'unhealthy']),
            queue: z.enum(['healthy', 'unhealthy']),
          }),
        },
      },
    },
    503: {
      description: 'Service is not ready',
      content: {
        'application/json': {
          schema: z.object({
            ready: z.boolean(),
            storage: z.enum(['healthy', 'unhealthy']),
            queue: z.enum(['healthy', 'unhealthy']),
          }),
        },
      },
    },
  },
});

const livenessRoute = createRoute({
  method: 'get',
  path: '/live',
  tags: ['Health'],
  summary: 'Liveness probe',
  description: 'Kubernetes/Cloud Run liveness probe. Always returns true if the process is alive.',
  responses: {
    200: {
      description: 'Service is alive',
      content: {
        'application/json': {
          schema: z.object({
            live: z.boolean(),
          }),
        },
      },
    },
  },
});

// --- Route Handlers ---

health.openapi(healthCheckRoute, async (c) => {
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

  const healthyCount = Object.values(dependencies).filter((s) => s === 'healthy').length;
  const totalCount = Object.keys(dependencies).length;

  const status: HealthStatus = {
    status: healthyCount === totalCount ? 'healthy' : healthyCount === 0 ? 'unhealthy' : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    dependencies,
  };

  const statusCode = status.status === 'unhealthy' ? 503 : 200;
  return c.json(status, statusCode);
});

health.openapi(readinessRoute, async (c) => {
  // For K8s/Cloud Run readiness probe - verify cloud connectivity
  const [storageHealth, queueHealth] = await Promise.all([
    checkStorageHealth(2000), // Shorter timeout for readiness
    checkQueueHealth(2000),
  ]);

  const ready = storageHealth === 'healthy' && queueHealth === 'healthy';
  const statusCode = ready ? 200 : 503;

  return c.json(
    {
      ready,
      storage: storageHealth,
      queue: queueHealth,
    },
    statusCode
  );
});

health.openapi(livenessRoute, (c) => {
  // For K8s/Cloud Run liveness probe
  return c.json({ live: true }, 200);
});

export { health };
