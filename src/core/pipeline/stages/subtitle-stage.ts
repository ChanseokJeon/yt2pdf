/**
 * SubtitleStage - Extracts and translates subtitles
 */

import { PipelineStage, PipelineContext } from '../types.js';
import { SubtitleSegment } from '../../../types/index.js';
import { DEV_MODE_SETTINGS } from '../../../types/config.js';
import { SubtitleExtractor } from '../../subtitle-extractor.js';
import { logger } from '../../../utils/logger.js';

export class SubtitleStage implements PipelineStage {
  readonly name = 'subtitles';

  async execute(context: PipelineContext): Promise<void> {
    context.onProgress({ status: 'processing', currentStep: '자막 추출', progress: 20 });

    const subtitleExtractor = new SubtitleExtractor({
      youtube: context.youtube,
      whisper: context.whisper,
      config: context.config.subtitle,
      cache: context.cache,
    });

    let audioPath: string | undefined;
    if (!context.metadata!.availableCaptions.length && context.whisper) {
      context.onProgress({ currentStep: '오디오 다운로드 (Whisper용)', progress: 25 });
      audioPath = await context.youtube.downloadAudio(context.videoId, context.tempDir);
    }

    const subtitles = await subtitleExtractor.extract(context.videoId, audioPath);
    let processedSegments: SubtitleSegment[] = subtitles.segments;

    // 번역 (필요한 경우, dev mode에서 생략)
    const isDevMode = context.config.dev?.enabled;
    if (
      context.config.translation.enabled &&
      context.config.translation.autoTranslate &&
      context.ai &&
      subtitles.segments.length > 0 &&
      !(isDevMode && DEV_MODE_SETTINGS.skipTranslation)
    ) {
      const defaultLang = context.config.translation.defaultLanguage;
      const subtitleLang = subtitles.language;

      if (subtitleLang && subtitleLang !== defaultLang) {
        context.onProgress({
          currentStep: `번역 중 (${subtitleLang} → ${defaultLang})`,
          progress: 32,
        });
        logger.info(`자막 번역: ${subtitleLang} → ${defaultLang}`);

        try {
          const translationResult = await context.ai.translate(subtitles.segments, {
            sourceLanguage: subtitleLang,
            targetLanguage: defaultLang,
          });
          processedSegments = translationResult.translatedSegments;
          logger.debug(`번역 완료: ${processedSegments.length}개 세그먼트`);
        } catch (e) {
          logger.warn('번역 실패, 원본 자막 사용', e as Error);
        }
      }
    } else if (isDevMode && DEV_MODE_SETTINGS.skipTranslation) {
      logger.info('[DEV MODE] 자막 번역 생략');
    }

    context.subtitles = subtitles;
    context.processedSegments = processedSegments;
  }
}
