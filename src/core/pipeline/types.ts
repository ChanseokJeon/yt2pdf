/**
 * Pipeline type definitions for orchestrator refactoring.
 * Uses accumulator pattern: stages mutate a shared PipelineContext.
 */

import { Config, ConvertOptions } from '../../types/config.js';
import {
  PipelineState,
  Chapter,
  ConvertResult,
  ContentSummary,
  SubtitleSegment,
  Screenshot,
  VideoMetadata,
  SubtitleResult,
  PDFContent,
} from '../../types/index.js';
import { YouTubeProvider } from '../../providers/youtube.js';
import { FFmpegWrapper } from '../../providers/ffmpeg.js';
import { AIProvider } from '../../providers/ai.js';
import { UnifiedContentProcessor } from '../../providers/unified-ai.js';
import { WhisperProvider } from '../../providers/whisper.js';
import { CacheManager } from '../../utils/cache.js';

/**
 * A pipeline stage that operates on shared PipelineContext.
 * Stages mutate the context (accumulator pattern) rather than
 * returning transformed input (functional pattern).
 */
export interface PipelineStage {
  /** Human-readable stage name for logging/tracing */
  readonly name: string;

  /**
   * Execute this stage, mutating the context with results.
   * @param context - Shared pipeline context (accumulated state)
   */
  execute(context: PipelineContext): Promise<void>;
}

/**
 * Shared context passed through all pipeline stages.
 * Contains providers, configuration, and accumulated results.
 */
export interface PipelineContext {
  // --- Identification ---
  videoId: string;
  options: ConvertOptions;
  config: Config;
  tempDir: string;

  // --- Providers (injected, read-only for stages) ---
  readonly youtube: YouTubeProvider;
  readonly ffmpeg: FFmpegWrapper;
  readonly whisper: WhisperProvider | undefined;
  readonly ai: AIProvider | undefined;
  readonly unifiedProcessor: UnifiedContentProcessor | undefined;
  readonly cache: CacheManager | undefined;

  // --- Accumulated state (stages mutate these) ---
  metadata?: VideoMetadata;
  chapters?: Chapter[];
  subtitles?: SubtitleResult;
  processedSegments?: SubtitleSegment[];
  summary?: ContentSummary | undefined;
  screenshots?: Screenshot[];
  content?: PDFContent;
  useChapters?: boolean;
  result?: ConvertResult;

  // --- Progress reporting ---
  onProgress: (progress: Partial<PipelineState>) => void;

  // --- Trace (optional) ---
  traceEnabled: boolean;
  traceSteps: Array<{ name: string; ms: number; detail?: Record<string, unknown> }>;
}

/**
 * Result of running the full pipeline.
 * Wraps ConvertResult with optional trace data.
 */
export interface PipelineResult {
  result: ConvertResult;
  traceSteps?: Array<{ name: string; ms: number; detail?: Record<string, unknown> }>;
}
