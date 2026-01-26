/**
 * 설정 관련 타입 정의
 */

import { z } from 'zod';
import type { OutputFormat, ImageQuality, PDFLayout, WhisperProvider } from './index.js';

// ============================================================
// Zod 스키마 정의
// ============================================================

export const OutputConfigSchema = z.object({
  directory: z.string().default('./output'),
  format: z.enum(['pdf', 'md', 'html']).default('pdf'),
  filenamePattern: z.string().default('{date}_{index}_{title}'),
});

export const ScreenshotConfigSchema = z.object({
  interval: z.number().min(10).max(600).default(60),
  quality: z.enum(['low', 'medium', 'high']).default('low'),
});

export const SubtitleConfigSchema = z.object({
  priority: z.enum(['youtube', 'whisper']).default('youtube'),
  languages: z.array(z.string()).default(['ko', 'en']),
});

export const PDFConfigSchema = z.object({
  layout: z.enum(['vertical', 'horizontal']).default('vertical'),
  theme: z.string().default('default'),
  includeToc: z.boolean().default(true),
  timestampLinks: z.boolean().default(true),
  searchable: z.boolean().default(true),
});

export const WhisperConfigSchema = z.object({
  provider: z.enum(['openai', 'groq', 'local']).default('openai'),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl: z.number().min(1).max(365).default(7),
});

export const ProcessingConfigSchema = z.object({
  maxDuration: z.number().default(7200),
  parallel: z.boolean().default(true),
  retryCount: z.number().min(0).max(10).default(3),
});

export const ConfigSchema = z.object({
  output: OutputConfigSchema.default({}),
  screenshot: ScreenshotConfigSchema.default({}),
  subtitle: SubtitleConfigSchema.default({}),
  pdf: PDFConfigSchema.default({}),
  whisper: WhisperConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
  processing: ProcessingConfigSchema.default({}),
});

// ============================================================
// 타입 추출
// ============================================================

export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type ScreenshotConfig = z.infer<typeof ScreenshotConfigSchema>;
export type SubtitleConfig = z.infer<typeof SubtitleConfigSchema>;
export type PDFConfig = z.infer<typeof PDFConfigSchema>;
export type WhisperConfig = z.infer<typeof WhisperConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type ProcessingConfig = z.infer<typeof ProcessingConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// ============================================================
// CLI 옵션 타입
// ============================================================

export interface CLIOptions {
  output?: string;
  format?: OutputFormat;
  interval?: number;
  layout?: PDFLayout;
  theme?: string;
  quality?: ImageQuality;
  lang?: string;
  noCache?: boolean;
  verbose?: boolean;
}

// ============================================================
// 변환 옵션 타입
// ============================================================

export interface ConvertOptions {
  url: string;
  output?: string;
  format?: OutputFormat;
  screenshot?: Partial<ScreenshotConfig>;
  subtitle?: Partial<SubtitleConfig>;
  pdf?: Partial<PDFConfig>;
}
