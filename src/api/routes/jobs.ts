import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { zValidator } from '@hono/zod-validator';
import {
  CreateJobRequestSchema,
  Job,
  JobResponse,
  CreateJobResponse,
  JobOptionsSchema,
  JobStatus,
  SyncJobResponseSchema,
  SyncJobErrorResponseSchema,
  ErrorResponseSchema,
} from '../models/job';
import { getJobStore } from '../store/job-store';
import { getCloudProvider } from '../../cloud';
import { parseYouTubeUrl } from '../../utils/url';
import { Orchestrator } from '../../core/orchestrator';
import { ConfigManager } from '../../utils/config';
import { getQueueName, getBucketName } from '../../constants';
import type { AppEnv } from '../types.js';
import { getValidatedProxyUrl } from '../../utils/proxy.js';

const jobs = new OpenAPIHono<AppEnv>();

// --- OpenAPI Route Definitions ---

const syncConversionRoute = createRoute({
  method: 'post',
  path: '/sync',
  tags: ['Conversion'],
  summary: 'Convert YouTube video (synchronous)',
  description:
    'Synchronously convert a YouTube video to PDF/MD/HTML. Waits for completion and returns a signed download URL. Designed for Cloud Run with a 14-minute timeout.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateJobRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Conversion successful',
      content: {
        'application/json': {
          schema: SyncJobResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request (bad URL)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Conversion failed',
      content: {
        'application/json': {
          schema: SyncJobErrorResponseSchema,
        },
      },
    },
  },
});

// --- OpenAPI Route Handler ---

/**
 * POST /jobs/sync - Synchronous conversion (for Cloud Run)
 * Waits for completion and returns download URL directly.
 * Use this when queue-based processing is not available.
 */
jobs.openapi(syncConversionRoute, async (c) => {
  const body = c.req.valid('json');
  const cloudProvider = await getCloudProvider();
  const jobId = randomUUID();
  const startTime = Date.now();

  // P2-14 fix: Track userId for audit purposes
  const userId = c.get('userId');
  console.log(`[Jobs] Sync conversion started by user: ${userId}, jobId: ${jobId}`);

  // Parse YouTube URL
  const urlInfo = parseYouTubeUrl(body.url);
  if (!urlInfo) {
    return c.json({ error: 'Invalid YouTube URL' }, 400);
  }

  const options = body.options || JobOptionsSchema.parse({});
  const tempDir = path.join('/tmp/v2doc', jobId);
  const outputBucket = getBucketName();

  try {
    // Setup temp directory
    await fs.mkdir(tempDir, { recursive: true });

    // Load and configure (deep clone to avoid singleton mutation)
    const configManager = ConfigManager.getInstance();
    const baseConfig = await configManager.load();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const config = JSON.parse(JSON.stringify(baseConfig)) as typeof baseConfig;

    config.output.format = options.format;
    config.screenshot.interval = options.screenshotInterval;
    config.pdf.layout = options.layout;
    config.translation.enabled = options.includeTranslation;
    config.summary.enabled = options.includeSummary;
    if (options.language) {
      config.subtitle.languages = [options.language];
    }

    const orchestrator = new Orchestrator({
      config,
      forceProxy: options.forceProxy,
      trace: options.trace,
    });

    // Run conversion with timeout (14 minutes, leaving 1 min buffer for Cloud Run's 15min limit)
    const TIMEOUT_MS = 14 * 60 * 1000;
    const result = await Promise.race([
      orchestrator.process({
        url: body.url,
        output: tempDir,
        format: options.format,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Processing timeout exceeded')), TIMEOUT_MS)
      ),
    ]);

    // Read the generated file
    const buffer = await fs.readFile(result.outputPath);

    // Upload to GCS
    const outputKey = `results/${jobId}/output.${options.format}`;
    await cloudProvider.storage.upload(outputBucket, outputKey, buffer, {
      contentType:
        options.format === 'pdf'
          ? 'application/pdf'
          : options.format === 'md'
            ? 'text/markdown'
            : options.format === 'html'
              ? 'text/html'
              : 'application/octet-stream',
    });

    // Generate signed URL (24 hours)
    const signedUrl = await cloudProvider.storage.getSignedUrl(outputBucket, outputKey, {
      expiresInSeconds: 86400,
      action: 'read',
    });

    const processingTime = Date.now() - startTime;

    return c.json(
      {
        jobId,
        status: 'completed' as const,
        downloadUrl: signedUrl,
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
        videoMetadata: result.metadata
          ? {
              title: result.metadata.title,
              channel: result.metadata.channel,
              duration: result.metadata.duration,
              thumbnail: result.metadata.thumbnail,
            }
          : undefined,
        stats: {
          pages: result.stats.pages,
          screenshotCount: result.stats.screenshotCount,
          fileSize: buffer.length,
          processingTime,
        },
        proxy: result.proxy,
        trace: result.trace,
      },
      200
    );
  } catch (error) {
    console.error(`[Sync] Conversion failed for ${jobId}:`, error);

    // Sanitize error message (don't expose internal paths or stack traces)
    const rawMessage = (error as Error).message || 'Unknown error';
    const safeMessage =
      rawMessage.includes('/') || rawMessage.includes('\\')
        ? 'Processing failed. Check server logs for details.'
        : rawMessage;

    return c.json(
      {
        jobId,
        status: 'failed' as const,
        error: safeMessage,
        proxy: {
          configured: !!process.env.YT_DLP_PROXY,
          validated: !!getValidatedProxyUrl(process.env.YT_DLP_PROXY),
          forced: options.forceProxy ?? false,
          used: false,
          fallbackTriggered: false,
        },
      },
      500
    );
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_e) {
      console.warn(`[Sync] Failed to cleanup temp dir: ${tempDir}`);
    }
  }
});

// --- Standard Routes (not documented in OpenAPI) ---

/**
 * POST /jobs - Create a new conversion job (async/queue-based)
 */
jobs.post('/', zValidator('json', CreateJobRequestSchema), async (c) => {
  const body = c.req.valid('json');
  const store = getJobStore();
  const cloudProvider = await getCloudProvider();

  // Parse YouTube URL
  const urlInfo = parseYouTubeUrl(body.url);
  if (!urlInfo) {
    return c.json({ error: 'Invalid YouTube URL' }, 400);
  }

  // Get userId from auth context (set by apiKeyAuth middleware)
  const userId = c.get('userId');

  // Create job
  const jobId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const job: Job = {
    id: jobId,
    userId,
    status: 'created',
    videoUrl: body.url,
    videoId: urlInfo.id,
    options: body.options || JobOptionsSchema.parse({}),
    progress: {
      percent: 0,
      currentStep: 'Queued',
      stepsCompleted: [],
      stepsRemaining: ['Metadata', 'Subtitles', 'Screenshots', 'PDF Generation'],
    },
    retryCount: 0,
    maxRetries: 3,
    webhook: body.webhook,
    createdAt: now,
    expiresAt,
  };

  store.create(job);

  // Enqueue job
  try {
    await cloudProvider.queue.enqueue(getQueueName(), { jobId });
    store.updateStatus(jobId, 'queued');
    job.status = 'queued';
  } catch (error) {
    console.error('Failed to enqueue job:', error);
    store.updateStatus(jobId, 'failed');
    return c.json({ error: 'Failed to queue job' }, 500);
  }

  const response: CreateJobResponse = {
    jobId: job.id,
    status: job.status,
    statusUrl: `/api/v1/jobs/${job.id}`,
    createdAt: job.createdAt.toISOString(),
  };

  return c.json(response, 202);
});

/**
 * GET /jobs/:jobId - Get job status
 */
jobs.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const store = getJobStore();
  const cloudProvider = await getCloudProvider();

  const job = store.findById(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // P0-2 fix: Enforce ownership without anonymous bypass
  const userId = c.get('userId');
  if (job.userId !== userId) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const response: JobResponse = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    videoMetadata: job.videoMetadata,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };

  // Add result with fresh signed URL if completed
  if (job.status === 'completed' && job.result) {
    const signedUrl = await cloudProvider.storage.getSignedUrl(
      getBucketName(),
      job.result.outputPath,
      { expiresInSeconds: 3600, action: 'read' }
    );

    response.result = {
      downloadUrl: signedUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      fileSize: job.result.fileSize,
      pages: job.result.pages,
    };
  }

  // Add error if failed
  if (job.status === 'failed' && job.error) {
    response.error = job.error;
  }

  return c.json(response);
});

/**
 * DELETE /jobs/:jobId - Cancel a job
 */
jobs.delete('/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const store = getJobStore();

  const job = store.findById(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // P0-2 fix: Enforce ownership without anonymous bypass
  const userId = c.get('userId');
  if (job.userId !== userId) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Can only cancel pending/queued jobs
  if (!['created', 'queued'].includes(job.status)) {
    return c.json({ error: `Cannot cancel job with status: ${job.status}` }, 400);
  }

  store.updateStatus(jobId, 'cancelled');

  return c.json({ jobId, status: 'cancelled' });
});

/**
 * GET /jobs - List user's jobs
 */
jobs.get('/', (c) => {
  const store = getJobStore();
  // Get userId from auth context (set by apiKeyAuth middleware)
  const userId = c.get('userId');

  const statusQuery = c.req.query('status');
  const status = statusQuery ? (statusQuery as JobStatus) : undefined;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const userJobs = store.findByUserId(userId, {
    status,
    limit: Math.min(limit, 100),
    offset,
  });

  const total = store.countByUserId(userId);

  return c.json({
    jobs: userJobs.map((job) => ({
      jobId: job.id,
      status: job.status,
      videoMetadata: job.videoMetadata,
      createdAt: job.createdAt.toISOString(),
    })),
    total,
    limit,
    offset,
  });
});

export { jobs };
