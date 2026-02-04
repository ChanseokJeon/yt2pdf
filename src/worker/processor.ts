import * as fs from 'fs/promises';
import * as path from 'path';
import { getCloudProvider, ICloudProvider } from '../cloud';
import { Orchestrator } from '../core/orchestrator';
import { ConfigManager } from '../utils/config';
import { Job, JobProgress, JobError } from '../api/models/job';
import { getJobStore, JobStore } from '../api/store';

export interface WorkerConfig {
  maxConcurrentJobs: number;
  visibilityTimeout: number;
  pollingInterval: number;
  tempDir: string;
  outputBucket: string;
}

const DEFAULT_CONFIG: WorkerConfig = {
  maxConcurrentJobs: 3,
  visibilityTimeout: 600, // 10 minutes
  pollingInterval: 5000,  // 5 seconds
  tempDir: '/tmp/yt2pdf',
  outputBucket: process.env.OUTPUT_BUCKET || 'yt2pdf-results',
};

export class JobProcessor {
  private cloudProvider: ICloudProvider | null = null;
  private jobStore: JobStore;
  private config: WorkerConfig;
  private isRunning = false;
  private activeJobs = 0;

  constructor(config?: Partial<WorkerConfig>) {
    this.jobStore = getJobStore();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async getProvider(): Promise<ICloudProvider> {
    if (!this.cloudProvider) {
      this.cloudProvider = await getCloudProvider();
    }
    return this.cloudProvider;
  }

  /**
   * Start the worker loop
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Worker] Starting with config:`, this.config);
    console.log(`[Worker] Polling for jobs...`);

    while (this.isRunning) {
      try {
        // Only poll if we have capacity
        if (this.activeJobs < this.config.maxConcurrentJobs) {
          const provider = await this.getProvider();
          const messages = await provider.queue.receive<{ jobId: string }>(
            'yt2pdf-jobs',
            {
              maxMessages: this.config.maxConcurrentJobs - this.activeJobs,
              visibilityTimeoutSeconds: this.config.visibilityTimeout,
              waitTimeSeconds: 20, // Long polling
            }
          );

          // Process messages concurrently
          for (const msg of messages) {
            this.activeJobs++;
            this.processMessage(msg).finally(() => {
              this.activeJobs--;
            });
          }
        }
      } catch (error) {
        console.error('[Worker] Polling error:', error);
      }

      // Short delay between polling cycles
      await this.sleep(this.config.pollingInterval);
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    console.log('[Worker] Stopping...');
    this.isRunning = false;

    // Wait for active jobs to complete
    while (this.activeJobs > 0) {
      console.log(`[Worker] Waiting for ${this.activeJobs} active jobs...`);
      await this.sleep(1000);
    }

    console.log('[Worker] Stopped');
  }

  /**
   * Process a single message from the queue
   */
  private async processMessage(message: {
    id: string;
    body: { jobId: string };
    receiptHandle?: string;
  }): Promise<void> {
    const { jobId } = message.body;
    console.log(`[Worker] Processing job: ${jobId}`);

    let job: Job | null = null;

    try {
      // 1. Load job from store
      job = await this.jobStore.findById(jobId);
      if (!job) {
        console.warn(`[Worker] Job not found: ${jobId}`);
        await this.ackMessage(message);
        return;
      }

      // 2. Check if already cancelled
      if (job.status === 'cancelled') {
        console.log(`[Worker] Job was cancelled: ${jobId}`);
        await this.ackMessage(message);
        return;
      }

      // 3. Update status to processing
      await this.jobStore.update(jobId, {
        status: 'processing',
        startedAt: new Date(),
      });

      // 4. Run the conversion
      const result = await this.runConversion(job);

      // 5. Upload result to cloud storage
      const provider = await this.getProvider();
      const outputKey = `results/${job.userId}/${job.id}/output.${job.options.format}`;
      await provider.storage.upload(
        this.config.outputBucket,
        outputKey,
        result.buffer,
        { contentType: this.getContentType(job.options.format) }
      );

      // 6. Update job as completed
      await this.jobStore.update(jobId, {
        status: 'completed',
        completedAt: new Date(),
        result: {
          outputPath: outputKey,
          fileSize: result.buffer.length,
          pages: result.pages,
          screenshotCount: result.screenshotCount,
          processingTime: Date.now() - (job.startedAt?.getTime() || Date.now()),
        },
      });

      // 7. ACK message
      await this.ackMessage(message);

      // 8. Send webhook if configured
      if (job.webhook) {
        await this.sendWebhook(job.id, 'completed');
      }

      console.log(`[Worker] Job completed: ${jobId}`);

    } catch (error) {
      console.error(`[Worker] Job failed: ${jobId}`, error);

      if (job) {
        const jobError: JobError = {
          code: (error as Error).name || 'UNKNOWN_ERROR',
          message: (error as Error).message,
          retryable: this.isRetryableError(error as Error),
        };

        const shouldRetry = jobError.retryable && job.retryCount < job.maxRetries;

        if (shouldRetry) {
          // NACK with exponential backoff
          const delaySeconds = Math.pow(2, job.retryCount) * 60;
          await this.nackMessage(message, delaySeconds);
          await this.jobStore.update(jobId, {
            status: 'queued',
            retryCount: job.retryCount + 1,
          });
          console.log(`[Worker] Job queued for retry: ${jobId} (attempt ${job.retryCount + 1})`);
        } else {
          // Move to DLQ and mark as failed
          const dlqProvider = await this.getProvider();
          await dlqProvider.queue.moveToDLQ('yt2pdf-jobs', {
            ...message,
            enqueuedAt: new Date(),
          });
          await this.jobStore.update(jobId, {
            status: 'failed',
            error: jobError,
          });
          console.log(`[Worker] Job failed permanently: ${jobId}`);

          if (job.webhook) {
            await this.sendWebhook(job.id, 'failed');
          }
        }
      }
    }
  }

  /**
   * Run the actual video conversion
   */
  private async runConversion(job: Job): Promise<{
    buffer: Buffer;
    pages: number;
    screenshotCount: number;
  }> {
    // Ensure temp directory exists
    const jobTempDir = path.join(this.config.tempDir, job.id);
    await fs.mkdir(jobTempDir, { recursive: true });

    try {
      // Load config with job options
      const configManager = ConfigManager.getInstance();
      const config = await configManager.load();

      // Override with job options
      config.output.format = job.options.format;
      config.screenshot.interval = job.options.screenshotInterval;
      config.screenshot.quality = job.options.screenshotQuality;
      config.pdf.layout = job.options.layout;
      config.translation.enabled = job.options.includeTranslation;
      config.summary.enabled = job.options.includeSummary;
      if (job.options.language) {
        config.subtitle.languages = [job.options.language];
      }

      const orchestrator = new Orchestrator({ config });

      // Progress callback
      orchestrator.onProgress(async (state) => {
        const progress: JobProgress = {
          percent: state.progress,
          currentStep: state.currentStep,
          stepsCompleted: [],
          stepsRemaining: [],
        };
        await this.jobStore.updateProgress(job.id, progress);
      });

      // Run conversion
      const result = await orchestrator.process({
        url: job.videoUrl,
        output: jobTempDir,
        format: job.options.format,
      });

      // Update video metadata
      if (result.metadata) {
        await this.jobStore.update(job.id, {
          videoMetadata: {
            title: result.metadata.title,
            channel: result.metadata.channel,
            duration: result.metadata.duration,
            thumbnail: result.metadata.thumbnail,
          },
        });
      }

      // Read the generated file
      const buffer = await fs.readFile(result.outputPath);

      return {
        buffer,
        pages: result.stats.pages,
        screenshotCount: result.stats.screenshotCount,
      };
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(jobTempDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[Worker] Failed to cleanup temp dir: ${jobTempDir}`, e);
      }
    }
  }

  private async ackMessage(message: { receiptHandle?: string }): Promise<void> {
    if (message.receiptHandle) {
      const provider = await this.getProvider();
      await provider.queue.ack('yt2pdf-jobs', message.receiptHandle);
    }
  }

  private async nackMessage(
    message: { receiptHandle?: string },
    delaySeconds: number
  ): Promise<void> {
    if (message.receiptHandle) {
      const provider = await this.getProvider();
      await provider.queue.nack('yt2pdf-jobs', message.receiptHandle, delaySeconds);
    }
  }

  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'WHISPER_API_ERROR',
      'VIDEO_DOWNLOAD_FAILED',
    ];
    return retryablePatterns.some(
      (pattern) =>
        error.message.includes(pattern) || error.name.includes(pattern)
    );
  }

  private getContentType(format: string): string {
    const types: Record<string, string> = {
      pdf: 'application/pdf',
      md: 'text/markdown',
      html: 'text/html',
      brief: 'application/pdf',
    };
    return types[format] || 'application/octet-stream';
  }

  private async sendWebhook(jobId: string, event: 'completed' | 'failed'): Promise<void> {
    // TODO: Implement webhook delivery with HMAC signature
    console.log(`[Worker] Webhook not implemented: ${event} for job ${jobId}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
