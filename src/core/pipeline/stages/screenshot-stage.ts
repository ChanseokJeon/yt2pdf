/**
 * ScreenshotStage - Captures screenshots from video
 * Supports three modes: dev thumbnails, chapter-based, time-based
 */

import { PipelineStage, PipelineContext } from '../types.js';
import { DEV_MODE_SETTINGS } from '../../../types/config.js';
import { ScreenshotCapturer } from '../../screenshot-capturer.js';
import { logger } from '../../../utils/logger.js';

export class ScreenshotStage implements PipelineStage {
  readonly name = 'screenshots';

  async execute(context: PipelineContext): Promise<void> {
    context.onProgress({ currentStep: '스크린샷 캡처', progress: 40 });

    const isDevMode = context.config.dev?.enabled;
    const useThumbnails = isDevMode && DEV_MODE_SETTINGS.useThumbnails;

    const screenshotCapturer = new ScreenshotCapturer({
      ffmpeg: context.ffmpeg,
      youtube: context.youtube,
      config: context.config.screenshot,
      tempDir: context.tempDir,
      devQuality: isDevMode ? DEV_MODE_SETTINGS.videoQuality : undefined,
      devMaxScreenshots: isDevMode ? DEV_MODE_SETTINGS.maxScreenshots : undefined,
      useThumbnails,
      onProgress: (current, total) => {
        const baseProgress = 40;
        const progressRange = 30;
        const progress = baseProgress + Math.floor((current / total) * progressRange);
        context.onProgress({ currentStep: `스크린샷 캡처 (${current}/${total})`, progress });
      },
    });

    const useChapters = (context.chapters?.length ?? 0) > 0;
    let screenshots;

    if (useThumbnails) {
      logger.info('[DEV MODE] YouTube 썸네일 사용 (비디오 다운로드 생략)');
      try {
        screenshots = await screenshotCapturer.captureFromThumbnails(
          context.videoId,
          context.metadata!.duration,
          DEV_MODE_SETTINGS.maxScreenshots
        );
      } catch {
        logger.warn('[DEV MODE] 썸네일 실패, FFmpeg 방식으로 폴백');
        screenshots = useChapters
          ? await screenshotCapturer.captureForChapters(
              context.videoId,
              context.chapters!,
              context.metadata!.thumbnail
            )
          : await screenshotCapturer.captureAll(
              context.videoId,
              context.metadata!.duration,
              context.metadata!.thumbnail
            );
      }
    } else if (useChapters) {
      logger.info(`챕터 기준 스크린샷 캡처: ${context.chapters!.length}개 챕터`);
      screenshots = await screenshotCapturer.captureForChapters(
        context.videoId,
        context.chapters!,
        context.metadata!.thumbnail
      );
    } else {
      screenshots = await screenshotCapturer.captureAll(
        context.videoId,
        context.metadata!.duration,
        context.metadata!.thumbnail
      );
    }

    context.screenshots = screenshots;
    context.useChapters = useChapters;
    context.onProgress({ progress: 70 });
  }
}
