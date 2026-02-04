import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { zValidator } from '@hono/zod-validator';
import {
  CreateJobRequestSchema,
  CreateJobRequest,
  Job,
  JobResponse,
  CreateJobResponse,
  JobOptionsSchema,
} from '../models/job';
import { getJobStore } from '../store/job-store';
import { getCloudProvider } from '../../cloud';
import { parseYouTubeUrl } from '../../utils/url';
import { Orchestrator } from '../../core/orchestrator';
import { ConfigManager } from '../../utils/config';

const jobs = new Hono();

/**
 * POST /jobs/sync - Synchronous conversion (for Cloud Run)
 * Waits for completion and returns download URL directly.
 * Use this when queue-based processing is not available.
 */
jobs.post(
  '/sync',
  zValidator('json', CreateJobRequestSchema),
  async (c) => {
    const body = c.req.valid('json') as CreateJobRequest;
    const cloudProvider = await getCloudProvider();
    const jobId = randomUUID();
    const startTime = Date.now();

    // Parse YouTube URL
    const urlInfo = parseYouTubeUrl(body.url);
    if (!urlInfo) {
      return c.json({ error: 'Invalid YouTube URL' }, 400);
    }

    const options = body.options || JobOptionsSchema.parse({});
    const tempDir = path.join('/tmp/yt2pdf', jobId);
    const outputBucket = process.env.GCS_BUCKET_NAME || process.env.OUTPUT_BUCKET || 'yt2pdf-output';

    try {
      // Setup temp directory
      await fs.mkdir(tempDir, { recursive: true });

      // Load and configure (deep clone to avoid singleton mutation)
      const configManager = ConfigManager.getInstance();
      const baseConfig = await configManager.load();
      const config = JSON.parse(JSON.stringify(baseConfig));

      config.output.format = options.format;
      config.screenshot.interval = options.screenshotInterval;
      config.screenshot.quality = options.quality;
      config.pdf.layout = options.layout;
      config.translation.enabled = options.includeTranslation;
      config.summary.enabled = options.includeSummary;
      if (options.language) {
        config.subtitle.languages = [options.language];
      }

      const orchestrator = new Orchestrator({ config });

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
        contentType: options.format === 'pdf' ? 'application/pdf' :
                     options.format === 'md' ? 'text/markdown' :
                     options.format === 'html' ? 'text/html' : 'application/octet-stream',
      });

      // Generate signed URL (24 hours)
      const signedUrl = await cloudProvider.storage.getSignedUrl(
        outputBucket,
        outputKey,
        { expiresInSeconds: 86400, action: 'read' }
      );

      const processingTime = Date.now() - startTime;

      return c.json({
        jobId,
        status: 'completed',
        downloadUrl: signedUrl,
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
        videoMetadata: result.metadata ? {
          title: result.metadata.title,
          channel: result.metadata.channel,
          duration: result.metadata.duration,
          thumbnail: result.metadata.thumbnail,
        } : undefined,
        stats: {
          pages: result.stats.pages,
          screenshotCount: result.stats.screenshotCount,
          fileSize: buffer.length,
          processingTime,
        },
      });
    } catch (error) {
      console.error(`[Sync] Conversion failed for ${jobId}:`, error);

      // Sanitize error message (don't expose internal paths or stack traces)
      const rawMessage = (error as Error).message || 'Unknown error';
      const safeMessage = rawMessage.includes('/') || rawMessage.includes('\\')
        ? 'Processing failed. Check server logs for details.'
        : rawMessage;

      return c.json({
        jobId,
        status: 'failed',
        error: safeMessage,
      }, 500);
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[Sync] Failed to cleanup temp dir: ${tempDir}`);
      }
    }
  }
);

/**
 * POST /jobs - Create a new conversion job (async/queue-based)
 */
jobs.post(
  '/',
  zValidator('json', CreateJobRequestSchema),
  async (c) => {
    const body = c.req.valid('json') as CreateJobRequest;
    const store = getJobStore();
    const cloudProvider = await getCloudProvider();

    // Parse YouTube URL
    const urlInfo = parseYouTubeUrl(body.url);
    if (!urlInfo) {
      return c.json({ error: 'Invalid YouTube URL' }, 400);
    }

    // Get userId from header or generate anonymous
    const userId = c.req.header('X-User-Id') || 'anonymous';

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

    await store.create(job);

    // Enqueue job
    try {
      await cloudProvider.queue.enqueue('yt2pdf-jobs', { jobId });
      await store.updateStatus(jobId, 'queued');
      job.status = 'queued';
    } catch (error) {
      console.error('Failed to enqueue job:', error);
      await store.updateStatus(jobId, 'failed');
      return c.json({ error: 'Failed to queue job' }, 500);
    }

    const response: CreateJobResponse = {
      jobId: job.id,
      status: job.status,
      statusUrl: `/api/v1/jobs/${job.id}`,
      createdAt: job.createdAt.toISOString(),
    };

    return c.json(response, 202);
  }
);

/**
 * GET /jobs/:jobId - Get job status
 */
jobs.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const store = getJobStore();
  const cloudProvider = await getCloudProvider();

  const job = await store.findById(jobId);
  if (!job) {
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
      process.env.OUTPUT_BUCKET || 'yt2pdf-results',
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
jobs.delete('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const store = getJobStore();

  const job = await store.findById(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Can only cancel pending/queued jobs
  if (!['created', 'queued'].includes(job.status)) {
    return c.json(
      { error: `Cannot cancel job with status: ${job.status}` },
      400
    );
  }

  await store.updateStatus(jobId, 'cancelled');

  return c.json({ jobId, status: 'cancelled' });
});

/**
 * GET /jobs - List user's jobs
 */
jobs.get('/', async (c) => {
  const store = getJobStore();
  const userId = c.req.header('X-User-Id') || 'anonymous';

  const status = c.req.query('status') as any;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const jobs = await store.findByUserId(userId, {
    status,
    limit: Math.min(limit, 100),
    offset,
  });

  const total = await store.countByUserId(userId);

  return c.json({
    jobs: jobs.map(job => ({
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
