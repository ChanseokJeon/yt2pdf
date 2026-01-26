/**
 * yt2pdf - YouTube to PDF 변환 라이브러리
 *
 * @example
 * ```typescript
 * import { convert, convertPlaylist } from 'yt2pdf';
 *
 * // 단일 영상 변환
 * const result = await convert({
 *   url: 'https://youtube.com/watch?v=xxxxx',
 *   output: './output',
 *   format: 'pdf',
 * });
 *
 * // 플레이리스트 변환
 * const results = await convertPlaylist({
 *   url: 'https://youtube.com/playlist?list=xxxxx',
 * });
 * ```
 */

// Types
export * from './types/index.js';
export * from './types/config.js';

// Core
export { Orchestrator } from './core/orchestrator.js';
export { SubtitleExtractor } from './core/subtitle-extractor.js';
export { ScreenshotCapturer } from './core/screenshot-capturer.js';
export { ContentMerger } from './core/content-merger.js';
export { PDFGenerator } from './core/pdf-generator.js';
export { CostEstimator } from './core/cost-estimator.js';

// Providers
export { YouTubeProvider } from './providers/youtube.js';
export { FFmpegWrapper } from './providers/ffmpeg.js';
export { WhisperProvider } from './providers/whisper.js';

// Utils
export { configManager, ConfigManager } from './utils/config.js';
export { cacheManager, CacheManager } from './utils/cache.js';
export { logger, Logger, log } from './utils/logger.js';

// Convenience functions
import { Orchestrator } from './core/orchestrator.js';
import { configManager } from './utils/config.js';
import { cacheManager } from './utils/cache.js';
import type { ConvertOptions, Config } from './types/config.js';
import type { ConvertResult } from './types/index.js';

/**
 * 단일 YouTube 영상을 PDF로 변환
 */
export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const config = await configManager.load();
  await cacheManager.init();

  const orchestrator = new Orchestrator({
    config,
    cache: config.cache.enabled ? cacheManager : undefined,
  });

  return orchestrator.process(options);
}

/**
 * YouTube 플레이리스트를 PDF로 변환
 */
export async function convertPlaylist(options: ConvertOptions): Promise<ConvertResult[]> {
  const config = await configManager.load();
  await cacheManager.init();

  const orchestrator = new Orchestrator({
    config,
    cache: config.cache.enabled ? cacheManager : undefined,
  });

  return orchestrator.processPlaylist(options);
}
