/**
 * ContentProcessingStage - Merges content and applies AI processing
 *
 * Extracted from Orchestrator: mergeContentWithAI(), processUnifiedAI(), processSectionSummaries()
 */

import { PipelineStage, PipelineContext } from '../types.js';
import { DEV_MODE_SETTINGS } from '../../../types/config.js';
import { ContentMerger } from '../../content-merger.js';
import { logger } from '../../../utils/logger.js';

export class ContentProcessingStage implements PipelineStage {
  readonly name = 'content-processing';

  async execute(context: PipelineContext): Promise<void> {
    // 1. Content merging
    context.onProgress({ currentStep: '콘텐츠 병합', progress: 75 });

    const contentMerger = new ContentMerger({ screenshotConfig: context.config.screenshot });
    const subtitleData = {
      ...context.subtitles!,
      segments: context.processedSegments!,
    };

    let content;
    if (context.useChapters) {
      content = contentMerger.mergeWithChapters(
        context.metadata!,
        subtitleData,
        context.screenshots!,
        context.chapters!
      );
      logger.info(`챕터 기준 콘텐츠 병합: ${content.sections.length}개 섹션`);
    } else {
      content = contentMerger.merge(context.metadata!, subtitleData, context.screenshots!);
    }

    if (context.summary) {
      content.summary = context.summary;
    }

    // 2. 통합 AI 처리
    await this.processUnifiedAI(context, content);

    // 3. 폴백: 섹션별 요약 생성
    await this.processSectionSummaries(context, content);

    context.content = content;
  }

  /**
   * 통합 AI 처리 (번역 + 섹션 요약)
   */
  private async processUnifiedAI(context: PipelineContext, content: any): Promise<void> {
    if (
      !context.unifiedProcessor ||
      !context.config.summary.enabled ||
      !context.config.summary.perSection ||
      content.sections.length === 0
    ) {
      return;
    }

    // Dev mode: AI sampling - only process first N sections
    const isDevMode = context.config.dev?.enabled;
    const shouldSample = isDevMode && content.sections.length > DEV_MODE_SETTINGS.aiSampleSections;

    try {
      const sectionType = context.useChapters ? '챕터별' : '섹션별';

      // Determine which sections to process with AI
      const sectionsToProcess = shouldSample
        ? content.sections.slice(0, DEV_MODE_SETTINGS.aiSampleSections)
        : content.sections;
      const sectionsToSkip = shouldSample
        ? content.sections.slice(DEV_MODE_SETTINGS.aiSampleSections)
        : [];

      if (shouldSample) {
        logger.info(
          `[DEV MODE] AI: ${content.sections.length}개 → ${DEV_MODE_SETTINGS.aiSampleSections}개만 처리`
        );
      }

      context.onProgress({
        currentStep: `통합 AI 처리 (번역 + ${sectionType} 요약)`,
        progress: 77,
      });
      logger.info('통합 AI 처리 시작...');

      const summaryLang =
        context.config.summary.language || context.config.translation.defaultLanguage;
      const unifiedResult = await context.unifiedProcessor.processAllSections(
        sectionsToProcess.map((s: any) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        {
          videoId: context.videoId,
          sourceLanguage: context.subtitles?.language || 'en',
          targetLanguage: summaryLang,
          maxKeyPoints: context.config.summary.sectionKeyPoints || 4,
          includeQuotes: true,
          enableCache: context.config.cache.enabled,
        }
      );

      // 결과 적용 - AI 처리된 섹션
      for (const section of sectionsToProcess) {
        const enhanced = unifiedResult.sections.get(section.timestamp);
        if (enhanced) {
          section.sectionSummary = {
            summary: enhanced.oneLiner,
            keyPoints: enhanced.keyPoints,
            mainInformation: enhanced.mainInformation,
            notableQuotes: enhanced.notableQuotes?.map((q: any) => q.text) || [],
          };
        }
      }

      // Dev mode: 스킵된 섹션에 플레이스홀더 적용
      for (const section of sectionsToSkip) {
        // Preserve YouTube chapter title
        if (section.sectionSummary?.summary && !section.chapterTitle) {
          section.chapterTitle = section.sectionSummary.summary;
        }
        section.sectionSummary = {
          summary: '[DEV MODE: AI 샘플링 - 요약 생략됨]',
          keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
        };
      }

      // 전체 요약 설정
      if (!content.summary && unifiedResult.globalSummary) {
        content.summary = {
          summary: unifiedResult.globalSummary.summary,
          keyPoints: unifiedResult.globalSummary.keyPoints,
          language: summaryLang,
        };
      }

      const skippedMsg = shouldSample ? ` (${sectionsToSkip.length}개 섹션 생략)` : '';
      logger.success(`통합 AI 처리 완료: ${unifiedResult.totalTokensUsed} 토큰 사용${skippedMsg}`);
    } catch (e) {
      logger.warn('통합 AI 처리 실패, 기존 방식으로 폴백', e as Error);
    }
  }

  /**
   * 섹션별 요약 생성 (통합 처리 폴백)
   */
  private async processSectionSummaries(context: PipelineContext, content: any): Promise<void> {
    if (
      !context.config.summary.enabled ||
      !context.config.summary.perSection ||
      !context.ai ||
      content.sections.length === 0 ||
      context.unifiedProcessor
    ) {
      return;
    }

    const sectionType = context.useChapters ? '챕터별' : '섹션별';
    context.onProgress({ currentStep: `${sectionType} 요약 생성`, progress: 77 });
    logger.info(`${sectionType} 요약 생성 중... (${content.sections.length}개)`);

    try {
      const summaryLang =
        context.config.summary.language || context.config.translation.defaultLanguage;
      const sectionSummaries = await context.ai.summarizeSections(
        content.sections.map((s: any) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        {
          language: summaryLang,
          maxSummaryLength: context.config.summary.sectionMaxLength,
          maxKeyPoints: context.config.summary.sectionKeyPoints,
        }
      );

      for (let i = 0; i < content.sections.length; i++) {
        const sectionSummary = sectionSummaries.find(
          (s: any) => s.timestamp === content.sections[i].timestamp
        );
        if (sectionSummary && sectionSummary.summary) {
          const existingTitle = content.sections[i].sectionSummary?.summary;
          content.sections[i].sectionSummary = {
            summary: sectionSummary.summary,
            keyPoints: sectionSummary.keyPoints,
          };
          if (context.useChapters && existingTitle) {
            content.sections[i].chapterTitle = existingTitle;
          }
        }
      }

      logger.debug(
        `${sectionType} 요약 완료: ${sectionSummaries.filter((s: any) => s.summary).length}개`
      );
    } catch (e) {
      logger.warn(`${sectionType} 요약 생성 실패`, e as Error);
    }
  }
}
