/**
 * 오케스트레이터 - 파이프라인 조율
 */

import * as fs from 'fs';
import * as path from 'path';
import { Config, ConvertOptions } from '../types/config.js';
import {
  ConvertResult,
  PipelineState,
  ProgressCallback,
  ErrorCode,
  Yt2PdfError,
  ContentSummary,
  SubtitleSegment,
  Chapter,
  ExecutiveBrief,
} from '../types/index.js';
import { YouTubeProvider } from '../providers/youtube.js';
import { FFmpegWrapper } from '../providers/ffmpeg.js';
import { WhisperProvider } from '../providers/whisper.js';
import { AIProvider } from '../providers/ai.js';
import { UnifiedContentProcessor } from '../providers/unified-ai.js';
import { SubtitleExtractor } from './subtitle-extractor.js';
import { ScreenshotCapturer } from './screenshot-capturer.js';
import { ContentMerger } from './content-merger.js';
import { PDFGenerator } from './pdf-generator.js';
import { CostEstimator } from './cost-estimator.js';
import { CacheManager } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import {
  createTempDir,
  cleanupDir,
  ensureDir,
  getDateString,
  getTimestampString,
  applyFilenamePattern,
  getFileSize,
} from '../utils/file.js';
import { parseYouTubeUrl, buildVideoUrl } from '../utils/url.js';

export interface OrchestratorOptions {
  config: Config;
  cache?: CacheManager;
}

export class Orchestrator {
  private config: Config;
  private cache?: CacheManager;
  private progressCallbacks: ProgressCallback[] = [];
  private state: PipelineState = {
    status: 'idle',
    progress: 0,
    currentStep: '',
  };

  // Providers
  private youtube: YouTubeProvider;
  private ffmpeg: FFmpegWrapper;
  private whisper?: WhisperProvider;
  private ai?: AIProvider;
  private unifiedProcessor?: UnifiedContentProcessor;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.cache = options.cache;

    this.youtube = new YouTubeProvider();
    this.ffmpeg = new FFmpegWrapper();

    // OpenAI API 키가 있을 때만 초기화
    if (process.env.OPENAI_API_KEY) {
      try {
        this.whisper = new WhisperProvider();
      } catch {
        // API 키가 없으면 Whisper 사용 불가
      }

      try {
        this.ai = new AIProvider(undefined, this.config.ai.model);
      } catch {
        // AI 사용 불가
      }

      try {
        this.unifiedProcessor = new UnifiedContentProcessor(
          process.env.OPENAI_API_KEY,
          this.config.ai.model || 'gpt-5.2'
        );
      } catch {
        // 통합 프로세서 사용 불가
      }
    }
  }

  /**
   * 진행 상황 콜백 등록
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * 단일 영상 처리
   */
  async process(options: ConvertOptions): Promise<ConvertResult> {
    const { url } = options;
    const parsed = parseYouTubeUrl(url);

    if (parsed.type === 'playlist') {
      throw new Yt2PdfError(
        ErrorCode.INVALID_URL,
        '플레이리스트는 processPlaylist()를 사용하세요.'
      );
    }

    return this.processVideo(parsed.id, options);
  }

  /**
   * 플레이리스트 처리
   */
  async processPlaylist(options: ConvertOptions): Promise<ConvertResult[]> {
    const { url } = options;
    const parsed = parseYouTubeUrl(url);

    if (parsed.type !== 'playlist') {
      // 단일 영상이면 배열로 반환
      const result = await this.processVideo(parsed.id, options);
      return [result];
    }

    this.updateState({
      status: 'fetching',
      currentStep: '플레이리스트 정보 가져오기',
      progress: 0,
    });

    const videos = await this.youtube.getPlaylistVideos(url);
    const results: ConvertResult[] = [];

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      logger.info(`[${i + 1}/${videos.length}] ${video.title}`);

      try {
        const result = await this.processVideo(video.id, {
          ...options,
          url: buildVideoUrl(video.id),
        });
        results.push(result);
      } catch (e) {
        logger.error(`영상 처리 실패: ${video.id}`, e as Error);
      }
    }

    return results;
  }

  /**
   * 개별 영상 처리 (오케스트레이터 메인 메서드)
   */
  private async processVideo(videoId: string, options: ConvertOptions): Promise<ConvertResult> {
    const tempDir = await createTempDir('yt2pdf-');

    // Dev mode logging and warning
    if (this.config.dev?.enabled) {
      logger.warn('='.repeat(50));
      logger.warn('[DEV MODE] 개발 모드 활성화 - 축소된 출력');
      logger.warn(`  최대 챕터: ${this.config.dev.maxChapters || 3}`);
      logger.warn(`  최대 스크린샷: ${this.config.dev.maxScreenshots || 3}`);
      logger.warn(`  비디오 품질: ${this.config.dev.videoQuality || '360p'}`);
      logger.warn(`  AI 처리: ${this.config.dev.skipAI ? '생략' : '활성화'}`);
      logger.warn('='.repeat(50));

      // Production warning
      const outputPath = options.output || this.config.output.directory;
      if (outputPath && !outputPath.includes('temp') && !outputPath.includes('dev') && !outputPath.includes('tmp')) {
        logger.warn('');
        logger.warn('!!! 경고: --dev 모드로 프로덕션 경로에 출력 중 !!!');
        logger.warn(`    출력 경로: ${outputPath}`);
        logger.warn('    개발/테스트 외 용도로는 --dev 없이 실행하세요.');
        logger.warn('');
      }
    }

    try {
      // 1. 메타데이터 및 챕터 가져오기
      const { metadata, chapters: fetchedChapters } = await this.fetchMetadataAndChapters(videoId);

      // Apply dev mode chapter limiting (BEFORE AI processing)
      let initialChapters = fetchedChapters;
      if (this.config.dev?.enabled && fetchedChapters.length > 0) {
        const maxChapters = this.config.dev.maxChapters || 3;
        if (fetchedChapters.length > maxChapters) {
          initialChapters = fetchedChapters.slice(0, maxChapters);
          logger.warn(`[DEV MODE] 챕터 제한: ${fetchedChapters.length}개 중 ${maxChapters}개만 처리`);
        }
      }

      // 2. 자막 추출 및 번역
      const { subtitles, processedSegments } = await this.extractAndTranslateSubtitles(
        videoId,
        metadata,
        tempDir
      );

      // 3. 영상 분류 및 챕터 생성
      const chapters = await this.classifyAndGenerateChapters(
        metadata,
        processedSegments,
        initialChapters
      );

      // 4. 요약 생성
      const summary = await this.generateSummary(processedSegments);

      // 5. 스크린샷 캡처
      const { screenshots, useChapters } = await this.captureScreenshots(
        videoId,
        metadata,
        chapters,
        tempDir
      );

      // 6. 콘텐츠 병합 및 AI 처리
      const content = await this.mergeContentWithAI(
        metadata,
        { ...subtitles, segments: processedSegments },
        screenshots,
        chapters,
        videoId,
        summary,
        useChapters
      );

      // 7. 출력 생성
      return await this.generateOutput(
        options,
        videoId,
        metadata,
        content,
        chapters,
        processedSegments,
        summary,
        screenshots
      );
    } finally {
      if (!this.config.cache.enabled) {
        await cleanupDir(tempDir);
      }
    }
  }

  /**
   * 메타데이터 및 YouTube 챕터 가져오기
   */
  private async fetchMetadataAndChapters(videoId: string): Promise<{
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>;
    chapters: Chapter[];
  }> {
    this.updateState({ status: 'fetching', currentStep: '영상 정보 가져오기', progress: 5 });
    const metadata = await this.youtube.getMetadata(buildVideoUrl(videoId));

    if (metadata.duration > this.config.processing.maxDuration) {
      logger.warn(
        `영상 길이(${metadata.duration}초)가 제한(${this.config.processing.maxDuration}초)을 초과합니다.`
      );
    }

    let chapters: Chapter[] = [];
    if (
      this.config.chapter.useYouTubeChapters &&
      metadata.chapters &&
      metadata.chapters.length > 0
    ) {
      chapters = metadata.chapters;
      logger.info(`YouTube 챕터 발견: ${chapters.length}개`);
    }

    return { metadata, chapters };
  }

  /**
   * 자막 추출 및 번역
   */
  private async extractAndTranslateSubtitles(
    videoId: string,
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    tempDir: string
  ): Promise<{
    subtitles: Awaited<ReturnType<SubtitleExtractor['extract']>>;
    processedSegments: SubtitleSegment[];
  }> {
    this.updateState({ status: 'processing', currentStep: '자막 추출', progress: 20 });

    const subtitleExtractor = new SubtitleExtractor({
      youtube: this.youtube,
      whisper: this.whisper,
      config: this.config.subtitle,
      cache: this.cache,
    });

    let audioPath: string | undefined;
    if (!metadata.availableCaptions.length && this.whisper) {
      // In dev mode with skipAI, skip Whisper entirely
      if (this.config.dev?.enabled && this.config.dev?.skipAI) {
        logger.warn('[DEV MODE] YouTube 자막 없음 + skipAI=true: 자막 없이 진행');
        // Continue without audio - will result in empty subtitles
      } else {
        this.updateState({ currentStep: '오디오 다운로드 (Whisper용)', progress: 25 });
        audioPath = await this.youtube.downloadAudio(videoId, tempDir);
      }
    }

    const subtitles = await subtitleExtractor.extract(videoId, audioPath);
    let processedSegments: SubtitleSegment[] = subtitles.segments;

    // 번역 (필요한 경우)
    if (
      this.config.translation.enabled &&
      this.config.translation.autoTranslate &&
      this.ai &&
      subtitles.segments.length > 0 &&
      !(this.config.dev?.enabled && this.config.dev?.skipAI)
    ) {
      const defaultLang = this.config.translation.defaultLanguage;
      const subtitleLang = subtitles.language;

      if (subtitleLang && subtitleLang !== defaultLang) {
        this.updateState({
          currentStep: `번역 중 (${subtitleLang} → ${defaultLang})`,
          progress: 32,
        });
        logger.info(`자막 번역: ${subtitleLang} → ${defaultLang}`);

        try {
          const translationResult = await this.ai.translate(subtitles.segments, {
            sourceLanguage: subtitleLang,
            targetLanguage: defaultLang,
          });
          processedSegments = translationResult.translatedSegments;
          logger.debug(`번역 완료: ${processedSegments.length}개 세그먼트`);
        } catch (e) {
          logger.warn('번역 실패, 원본 자막 사용', e as Error);
        }
      }
    }

    return { subtitles, processedSegments };
  }

  /**
   * 영상 유형 분류 및 챕터 자동 생성
   */
  private async classifyAndGenerateChapters(
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    processedSegments: SubtitleSegment[],
    initialChapters: Chapter[]
  ): Promise<Chapter[]> {
    let chapters = [...initialChapters];

    // 영상 유형 분류
    if (this.ai && processedSegments.length > 0 && !(this.config.dev?.enabled && this.config.dev?.skipAI)) {
      this.updateState({ currentStep: '영상 유형 분류', progress: 34 });

      try {
        const subtitleSample = processedSegments
          .slice(0, 10)
          .map((s) => s.text)
          .join(' ');
        const typeResult = await this.ai.classifyVideoType(
          { title: metadata.title, description: metadata.description, channel: metadata.channel },
          subtitleSample
        );
        metadata.videoType = typeResult.type;
        metadata.videoTypeConfidence = typeResult.confidence;
        logger.info(
          `영상 유형: ${typeResult.type} (신뢰도: ${(typeResult.confidence * 100).toFixed(0)}%)`
        );
      } catch (e) {
        logger.warn('영상 유형 분류 실패', e as Error);
      }
    } else if (this.config.dev?.enabled && this.config.dev?.skipAI) {
      logger.info('[DEV MODE] 영상 유형 분류 생략');
    }

    // 챕터 자동 생성
    if (
      chapters.length === 0 &&
      this.config.chapter.autoGenerate &&
      this.ai &&
      processedSegments.length > 0 &&
      !(this.config.dev?.enabled && this.config.dev?.skipAI)
    ) {
      this.updateState({ currentStep: '챕터 자동 생성', progress: 35 });
      logger.info('AI 기반 챕터 자동 생성 중...');

      try {
        const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
        chapters = await this.ai.detectTopicShifts(processedSegments, {
          minChapterLength: this.config.chapter.minChapterLength,
          maxChapters: this.config.chapter.maxChapters,
          language: summaryLang,
        });
        logger.info(`AI 생성 챕터: ${chapters.length}개`);
      } catch (e) {
        logger.warn('챕터 자동 생성 실패', e as Error);
      }
    } else if (this.config.dev?.enabled && this.config.dev?.skipAI && chapters.length === 0) {
      logger.info('[DEV MODE] AI 챕터 생성 생략');
    }

    // 메타데이터에 챕터 추가
    if (chapters.length > 0 && !metadata.chapters) {
      metadata.chapters = chapters;
    }

    return chapters;
  }

  /**
   * 요약 생성
   */
  private async generateSummary(
    processedSegments: SubtitleSegment[]
  ): Promise<ContentSummary | undefined> {
    // Skip in dev mode with skipAI - return placeholder
    if (this.config.dev?.enabled && this.config.dev?.skipAI) {
      logger.info('[DEV MODE] AI 요약 생성 생략');
      return {
        summary: '[DEV MODE: AI 요약 생략됨]',
        keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
        language: this.config.summary.language || 'ko',
      };
    }

    if (!this.config.summary.enabled || !this.ai || processedSegments.length === 0) {
      return undefined;
    }

    this.updateState({ currentStep: '요약 생성', progress: 36 });
    logger.info('AI 요약 생성 중...');

    try {
      const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
      const summaryResult = await this.ai.summarize(processedSegments, {
        maxLength: this.config.summary.maxLength,
        style: this.config.summary.style,
        language: summaryLang,
      });
      const summary: ContentSummary = {
        summary: summaryResult.summary,
        keyPoints: summaryResult.keyPoints,
        language: summaryResult.language,
      };
      logger.debug(`요약 생성 완료: ${summary.summary.length}자`);
      return summary;
    } catch (e) {
      logger.warn('요약 생성 실패', e as Error);
      return undefined;
    }
  }

  /**
   * 스크린샷 캡처
   */
  private async captureScreenshots(
    videoId: string,
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    chapters: Chapter[],
    tempDir: string
  ): Promise<{
    screenshots: Awaited<ReturnType<ScreenshotCapturer['captureAll']>>;
    useChapters: boolean;
  }> {
    this.updateState({ currentStep: '스크린샷 캡처', progress: 40 });

    const screenshotCapturer = new ScreenshotCapturer({
      ffmpeg: this.ffmpeg,
      youtube: this.youtube,
      config: this.config.screenshot,
      tempDir,
      // Pass dev mode options
      devQuality: this.config.dev?.enabled ? this.config.dev.videoQuality : undefined,
      devMaxScreenshots: this.config.dev?.enabled ? this.config.dev.maxScreenshots : undefined,
      onProgress: (current, total) => {
        const baseProgress = 40;
        const progressRange = 30;
        const progress = baseProgress + Math.floor((current / total) * progressRange);
        this.updateState({ currentStep: `스크린샷 캡처 (${current}/${total})`, progress });
      },
    });

    const useChapters = chapters.length > 0;
    let screenshots;

    if (useChapters) {
      logger.info(`챕터 기준 스크린샷 캡처: ${chapters.length}개 챕터`);
      screenshots = await screenshotCapturer.captureForChapters(
        videoId,
        chapters,
        metadata.thumbnail
      );
    } else {
      screenshots = await screenshotCapturer.captureAll(
        videoId,
        metadata.duration,
        metadata.thumbnail
      );
    }

    this.updateState({ progress: 70 });
    return { screenshots, useChapters };
  }

  /**
   * 콘텐츠 병합 및 AI 처리
   */
  private async mergeContentWithAI(
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    subtitles: Awaited<ReturnType<SubtitleExtractor['extract']>>,
    screenshots: Awaited<ReturnType<ScreenshotCapturer['captureAll']>>,
    chapters: Chapter[],
    videoId: string,
    summary: ContentSummary | undefined,
    useChapters: boolean
  ): Promise<ReturnType<ContentMerger['merge']>> {
    this.updateState({ currentStep: '콘텐츠 병합', progress: 75 });

    const contentMerger = new ContentMerger({ screenshotConfig: this.config.screenshot });

    let content;
    if (useChapters) {
      content = contentMerger.mergeWithChapters(metadata, subtitles, screenshots, chapters);
      logger.info(`챕터 기준 콘텐츠 병합: ${content.sections.length}개 섹션`);
    } else {
      content = contentMerger.merge(metadata, subtitles, screenshots);
    }

    if (summary) {
      content.summary = summary;
    }

    // 통합 AI 처리
    await this.processUnifiedAI(content, subtitles, videoId, useChapters);

    // 폴백: 섹션별 요약 생성
    await this.processSectionSummaries(content, useChapters);

    return content;
  }

  /**
   * 통합 AI 처리 (번역 + 섹션 요약)
   */
  private async processUnifiedAI(
    content: ReturnType<ContentMerger['merge']>,
    subtitles: Awaited<ReturnType<SubtitleExtractor['extract']>>,
    videoId: string,
    useChapters: boolean
  ): Promise<void> {
    // Dev mode: Add placeholder section summaries while preserving chapter titles
    if (this.config.dev?.enabled && this.config.dev?.skipAI) {
      logger.info('[DEV MODE] 통합 AI 처리 생략 - 섹션별 플레이스홀더 적용');
      for (const section of content.sections) {
        // Preserve YouTube chapter title if it was stored in sectionSummary.summary
        if (section.sectionSummary?.summary && !section.chapterTitle) {
          section.chapterTitle = section.sectionSummary.summary;
        }
        section.sectionSummary = {
          summary: '[DEV MODE: 섹션 요약 생략됨]',
          keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
        };
      }
      return;
    }

    if (
      !this.unifiedProcessor ||
      !this.config.summary.enabled ||
      !this.config.summary.perSection ||
      content.sections.length === 0
    ) {
      return;
    }

    try {
      const sectionType = useChapters ? '챕터별' : '섹션별';
      this.updateState({ currentStep: `통합 AI 처리 (번역 + ${sectionType} 요약)`, progress: 77 });
      logger.info('통합 AI 처리 시작...');

      const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
      const unifiedResult = await this.unifiedProcessor.processAllSections(
        content.sections.map((s) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        {
          videoId,
          sourceLanguage: subtitles.language || 'en',
          targetLanguage: summaryLang,
          maxKeyPoints: this.config.summary.sectionKeyPoints || 4,
          includeQuotes: true,
          enableCache: this.config.cache.enabled,
        }
      );

      // 결과 적용
      for (const section of content.sections) {
        const enhanced = unifiedResult.sections.get(section.timestamp);
        if (enhanced) {
          if (enhanced.translatedText && subtitles.language !== summaryLang) {
            section.subtitles = [
              {
                start: section.timestamp,
                end: section.timestamp + 60,
                text: enhanced.translatedText,
              },
            ];
          }

          section.sectionSummary = {
            summary: enhanced.oneLiner,
            keyPoints: enhanced.keyPoints,
            mainInformation: enhanced.mainInformation,
            notableQuotes: enhanced.notableQuotes?.map((q) => q.text) || [],
          };
        }
      }

      // 전체 요약 설정
      if (!content.summary && unifiedResult.globalSummary) {
        content.summary = {
          summary: unifiedResult.globalSummary.summary,
          keyPoints: unifiedResult.globalSummary.keyPoints,
          language: summaryLang,
        };
      }

      logger.success(`통합 AI 처리 완료: ${unifiedResult.totalTokensUsed} 토큰 사용`);
    } catch (e) {
      logger.warn('통합 AI 처리 실패, 기존 방식으로 폴백', e as Error);
    }
  }

  /**
   * 섹션별 요약 생성 (통합 처리 폴백)
   */
  private async processSectionSummaries(
    content: ReturnType<ContentMerger['merge']>,
    useChapters: boolean
  ): Promise<void> {
    if (
      !this.config.summary.enabled ||
      !this.config.summary.perSection ||
      !this.ai ||
      content.sections.length === 0 ||
      this.unifiedProcessor
    ) {
      return;
    }

    const sectionType = useChapters ? '챕터별' : '섹션별';
    this.updateState({ currentStep: `${sectionType} 요약 생성`, progress: 77 });
    logger.info(`${sectionType} 요약 생성 중... (${content.sections.length}개)`);

    try {
      const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
      const sectionSummaries = await this.ai.summarizeSections(
        content.sections.map((s) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        {
          language: summaryLang,
          maxSummaryLength: this.config.summary.sectionMaxLength,
          maxKeyPoints: this.config.summary.sectionKeyPoints,
        }
      );

      for (let i = 0; i < content.sections.length; i++) {
        const sectionSummary = sectionSummaries.find(
          (s) => s.timestamp === content.sections[i].timestamp
        );
        if (sectionSummary && sectionSummary.summary) {
          const existingTitle = content.sections[i].sectionSummary?.summary;
          content.sections[i].sectionSummary = {
            summary: sectionSummary.summary,
            keyPoints: sectionSummary.keyPoints,
          };
          if (useChapters && existingTitle) {
            content.sections[i].chapterTitle = existingTitle;
          }
        }
      }

      logger.debug(
        `${sectionType} 요약 완료: ${sectionSummaries.filter((s) => s.summary).length}개`
      );
    } catch (e) {
      logger.warn(`${sectionType} 요약 생성 실패`, e as Error);
    }
  }

  /**
   * 출력 파일 생성
   */
  private async generateOutput(
    options: ConvertOptions,
    videoId: string,
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    content: ReturnType<ContentMerger['merge']>,
    chapters: Chapter[],
    processedSegments: SubtitleSegment[],
    summary: ContentSummary | undefined,
    screenshots: Awaited<ReturnType<ScreenshotCapturer['captureAll']>>
  ): Promise<ConvertResult> {
    this.updateState({ status: 'generating', currentStep: 'PDF 생성', progress: 80 });

    const outputDir = options.output || this.config.output.directory;
    await ensureDir(outputDir);

    const filename = applyFilenamePattern(this.config.output.filenamePattern, {
      date: getDateString(),
      timestamp: getTimestampString(),
      videoId: videoId,
      channel: metadata.channel,
      index: '001',
      title: metadata.title,
    });

    const format = options.format || this.config.output.format;
    const pdfGenerator = new PDFGenerator(this.config.pdf);

    // brief 형식 처리
    if (format === 'brief') {
      return await this.generateBriefOutput(
        outputDir,
        filename,
        metadata,
        chapters,
        processedSegments,
        summary,
        pdfGenerator
      );
    }

    // 기존 형식 처리 (pdf, md, html)
    return await this.generateStandardOutput(
      outputDir,
      filename,
      format,
      metadata,
      content,
      screenshots,
      pdfGenerator
    );
  }

  /**
   * Executive Brief 출력 생성
   */
  private async generateBriefOutput(
    outputDir: string,
    filename: string,
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    chapters: Chapter[],
    processedSegments: SubtitleSegment[],
    summary: ContentSummary | undefined,
    pdfGenerator: PDFGenerator
  ): Promise<ConvertResult> {
    this.updateState({ currentStep: 'Executive Brief 생성', progress: 82 });

    let brief: ExecutiveBrief;
    if (this.ai && chapters.length > 0) {
      const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
      brief = await this.ai.generateExecutiveBrief(metadata, chapters, processedSegments, {
        language: summaryLang,
      });
    } else {
      brief = {
        title: metadata.title,
        metadata: {
          channel: metadata.channel,
          duration: metadata.duration,
          videoType: metadata.videoType || 'unknown',
          uploadDate: metadata.uploadDate,
          videoId: metadata.id,
        },
        summary: summary?.summary || '요약을 생성할 수 없습니다.',
        keyTakeaways: summary?.keyPoints || [],
        chapterSummaries: chapters.map((c) => ({
          title: c.title,
          startTime: c.startTime,
          summary: '',
        })),
      };
    }

    const outputPath = path.join(outputDir, `${filename}_brief.pdf`);
    await pdfGenerator.generateBriefPDF(brief, outputPath);

    this.updateState({ status: 'complete', currentStep: '완료', progress: 100 });

    const fileSize = await getFileSize(outputPath);
    return {
      success: true,
      outputPath,
      metadata,
      stats: {
        pages: 1,
        fileSize,
        duration: metadata.duration,
        screenshotCount: 0,
      },
    };
  }

  /**
   * 표준 형식 출력 생성 (pdf, md, html)
   */
  private async generateStandardOutput(
    outputDir: string,
    filename: string,
    format: string,
    metadata: Awaited<ReturnType<YouTubeProvider['getMetadata']>>,
    content: ReturnType<ContentMerger['merge']>,
    screenshots: Awaited<ReturnType<ScreenshotCapturer['captureAll']>>,
    pdfGenerator: PDFGenerator
  ): Promise<ConvertResult> {
    const extension = format === 'pdf' ? 'pdf' : format === 'md' ? 'md' : 'html';
    const outputPath = path.join(outputDir, `${filename}.${extension}`);

    if (format === 'pdf') {
      await pdfGenerator.generatePDF(content, outputPath);
    } else {
      // md, html 공통: 이미지 복사
      const imagesDir = path.join(outputDir, 'images');
      await ensureDir(imagesDir);
      for (const section of content.sections) {
        const imgName = path.basename(section.screenshot.imagePath);
        const destPath = path.join(imagesDir, imgName);
        await fs.promises.copyFile(section.screenshot.imagePath, destPath);
      }

      if (format === 'md') {
        await pdfGenerator.generateMarkdown(content, outputPath);
      } else {
        await pdfGenerator.generateHTML(content, outputPath);
      }
    }

    this.updateState({ status: 'complete', currentStep: '완료', progress: 100 });

    const fileSize = await getFileSize(outputPath);
    return {
      success: true,
      outputPath,
      metadata,
      stats: {
        pages: content.sections.length,
        fileSize,
        duration: metadata.duration,
        screenshotCount: screenshots.length,
      },
    };
  }

  /**
   * 상태 업데이트
   */
  private updateState(partial: Partial<PipelineState>): void {
    this.state = { ...this.state, ...partial };
    this.progressCallbacks.forEach((cb) => cb(this.state));
  }

  /**
   * 비용 추정
   */
  static estimateCost(durationSeconds: number, hasYouTubeCaptions: boolean): string {
    if (hasYouTubeCaptions) {
      return '무료 (YouTube 자막 사용)';
    }
    const estimate = CostEstimator.estimate(durationSeconds);
    return CostEstimator.getSummary(estimate);
  }
}
