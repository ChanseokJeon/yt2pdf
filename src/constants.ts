/**
 * Centralized constants for v2doc
 * Allows backward compatibility during migration period
 */

export const DEFAULT_QUEUE_NAME = 'yt2pdf-jobs'; // Keep during transition
export const DEFAULT_BUCKET_PREFIX = 'yt2pdf';
export const DEFAULT_BUCKET_SUFFIX = 'output';

export function getBucketName(projectId?: string): string {
  const bucketPrefix = process.env.BUCKET_PREFIX || DEFAULT_BUCKET_PREFIX;
  const bucketSuffix = process.env.BUCKET_SUFFIX || DEFAULT_BUCKET_SUFFIX;
  const suffix = projectId ? `-${projectId}` : '';
  return `${bucketPrefix}-${bucketSuffix}${suffix}`;
}

export function getQueueName(): string {
  return process.env.QUEUE_NAME || DEFAULT_QUEUE_NAME;
}

// API Authentication
export const API_KEY_PREFIX = 'v2d_';

// Rate Limiting
export const RATE_LIMIT_GLOBAL_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_GLOBAL_MAX = 60; // 60 requests per minute per IP
export const RATE_LIMIT_PER_KEY_WINDOW_MS = 86_400_000; // 24 hours
export const RATE_LIMIT_PER_KEY_MAX = 1000; // 1000 requests per day per key
export const RATE_LIMIT_SYNC_WINDOW_MS = 3_600_000; // 1 hour
export const RATE_LIMIT_SYNC_MAX = 10; // 10 sync conversions per hour per key
export const RATE_LIMIT_ASYNC_WINDOW_MS = 3_600_000; // 1 hour
export const RATE_LIMIT_ASYNC_MAX = 100; // 100 async jobs per hour per key
