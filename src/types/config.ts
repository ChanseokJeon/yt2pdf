/**
 * 설정 관련 타입 정의
 */

import { z } from 'zod';
import type { OutputFormat, ImageQuality, PDFLayout } from './index.js';

// Re-export for convenience
export type { OutputFormat, ImageQuality, PDFLayout } from './index.js';

// ============================================================
// Zod 스키마 정의
// ============================================================

export const OutputConfigSchema = z.object({
  directory: z.string().default('./output'),
  format: z.enum(['pdf', 'md', 'html', 'brief']).default('pdf'),
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

export const SummaryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxLength: z.number().min(100).max(2000).default(500),
  style: z.enum(['brief', 'detailed']).default('brief'),
  language: z.string().optional(), // undefined면 defaultLanguage 사용
  perSection: z.boolean().default(true), // 섹션별 요약 활성화
  sectionMaxLength: z.number().min(50).max(500).default(150), // 섹션 요약 최대 길이
  sectionKeyPoints: z.number().min(1).max(5).default(3), // 섹션별 핵심 포인트 수
});

export const TranslationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultLanguage: z.string().default('ko'), // 기본 언어
  autoTranslate: z.boolean().default(true), // 기본 언어가 아니면 자동 번역
});

export const AIConfigSchema = z.object({
  provider: z.enum(['openai']).default('openai'),
  model: z.string().default('gpt-5.2'),
});

export const ChapterConfigSchema = z.object({
  useYouTubeChapters: z.boolean().default(true),    // YouTube 챕터 우선 사용
  autoGenerate: z.boolean().default(true),          // 없으면 자동 생성
  minChapterLength: z.number().min(30).default(60), // 최소 챕터 길이 (초)
  maxChapters: z.number().min(1).max(50).default(20), // 최대 챕터 수
});

export const ConfigSchema = z.object({
  output: OutputConfigSchema.default({}),
  screenshot: ScreenshotConfigSchema.default({}),
  subtitle: SubtitleConfigSchema.default({}),
  pdf: PDFConfigSchema.default({}),
  whisper: WhisperConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
  processing: ProcessingConfigSchema.default({}),
  summary: SummaryConfigSchema.default({}),
  translation: TranslationConfigSchema.default({}),
  ai: AIConfigSchema.default({}),
  chapter: ChapterConfigSchema.default({}),
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
export type SummaryConfig = z.infer<typeof SummaryConfigSchema>;
export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;
export type AIConfig = z.infer<typeof AIConfigSchema>;
export type ChapterConfig = z.infer<typeof ChapterConfigSchema>;
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
