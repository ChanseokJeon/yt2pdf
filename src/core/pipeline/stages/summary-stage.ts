/**
 * SummaryStage - Generates AI summary from processed segments
 */

import { PipelineStage, PipelineContext } from '../types.js';
import { DEV_MODE_SETTINGS } from '../../../types/config.js';
import { logger } from '../../../utils/logger.js';

export class SummaryStage implements PipelineStage {
  readonly name = 'summary';

  async execute(context: PipelineContext): Promise<void> {
    // Skip conditions
    if (!context.config.summary.enabled || !context.ai || !context.processedSegments?.length) {
      return;
    }

    // Dev mode: placeholder summary
    if (context.config.dev?.enabled && DEV_MODE_SETTINGS.skipGlobalSummary) {
      logger.info('[DEV MODE] 전체 요약 생략');
      context.summary = {
        summary: '[DEV MODE] 전체 요약 생략됨',
        keyPoints: ['[DEV MODE] 섹션 요약 참조'],
        language: context.config.summary.language || 'ko',
      };
      return;
    }

    context.onProgress({ currentStep: '요약 생성', progress: 36 });
    logger.info('AI 요약 생성 중...');

    try {
      const summaryLang = context.config.summary.language || context.config.translation.defaultLanguage;
      const summaryResult = await context.ai.summarize(context.processedSegments, {
        maxLength: context.config.summary.maxLength,
        style: context.config.summary.style,
        language: summaryLang,
      });
      context.summary = {
        summary: summaryResult.summary,
        keyPoints: summaryResult.keyPoints,
        language: summaryResult.language,
      };
      logger.debug(`요약 생성 완료: ${context.summary.summary.length}자`);
    } catch (e) {
      logger.warn('요약 생성 실패', e as Error);
    }
  }
}
