/**
 * 오케스트레이터 - 파이프라인 조율
 */

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
          this.config.ai.model || 'gpt-4o-mini'
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

    this.updateState({ status: 'fetching', currentStep: '플레이리스트 정보 가져오기', progress: 0 });

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
   * 개별 영상 처리
   */
  private async processVideo(videoId: string, options: ConvertOptions): Promise<ConvertResult> {
    const tempDir = await createTempDir('yt2pdf-');

    try {
      // 1. 메타데이터 가져오기
      this.updateState({ status: 'fetching', currentStep: '영상 정보 가져오기', progress: 5 });
      const metadata = await this.youtube.getMetadata(buildVideoUrl(videoId));

      // 2. 길이 제한 확인
      if (metadata.duration > this.config.processing.maxDuration) {
        logger.warn(`영상 길이(${metadata.duration}초)가 제한(${this.config.processing.maxDuration}초)을 초과합니다.`);
      }

      // 2.5. 챕터 정보 확인 (YouTube 챕터가 있는지)
      let chapters: Chapter[] = [];
      if (this.config.chapter.useYouTubeChapters && metadata.chapters && metadata.chapters.length > 0) {
        chapters = metadata.chapters;
        logger.info(`YouTube 챕터 발견: ${chapters.length}개`);
      }

      // 3. 자막 추출
      this.updateState({ status: 'processing', currentStep: '자막 추출', progress: 20 });

      const subtitleExtractor = new SubtitleExtractor({
        youtube: this.youtube,
        whisper: this.whisper,
        config: this.config.subtitle,
        cache: this.cache,
      });

      // 오디오 다운로드 (Whisper 폴백용)
      let audioPath: string | undefined;
      if (!metadata.availableCaptions.length && this.whisper) {
        this.updateState({ currentStep: '오디오 다운로드 (Whisper용)', progress: 25 });
        audioPath = await this.youtube.downloadAudio(videoId, tempDir);
      }

      let subtitles = await subtitleExtractor.extract(videoId, audioPath);
      let processedSegments: SubtitleSegment[] = subtitles.segments;

      // 3.5. 번역 (필요한 경우)
      if (
        this.config.translation.enabled &&
        this.config.translation.autoTranslate &&
        this.ai &&
        subtitles.segments.length > 0
      ) {
        const defaultLang = this.config.translation.defaultLanguage;
        const subtitleLang = subtitles.language;

        // 언어가 다르면 번역
        if (subtitleLang && subtitleLang !== defaultLang) {
          this.updateState({ currentStep: `번역 중 (${subtitleLang} → ${defaultLang})`, progress: 32 });
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

      // 3.6. 영상 유형 분류 (AI 사용 가능한 경우)
      if (this.ai && processedSegments.length > 0) {
        this.updateState({ currentStep: '영상 유형 분류', progress: 34 });

        try {
          const subtitleSample = processedSegments.slice(0, 10).map(s => s.text).join(' ');
          const typeResult = await this.ai.classifyVideoType(
            { title: metadata.title, description: metadata.description, channel: metadata.channel },
            subtitleSample
          );
          metadata.videoType = typeResult.type;
          metadata.videoTypeConfidence = typeResult.confidence;
          logger.info(`영상 유형: ${typeResult.type} (신뢰도: ${(typeResult.confidence * 100).toFixed(0)}%)`);
        } catch (e) {
          logger.warn('영상 유형 분류 실패', e as Error);
        }
      }

      // 3.7. 챕터 자동 생성 (YouTube 챕터 없고 autoGenerate 활성화된 경우)
      if (chapters.length === 0 && this.config.chapter.autoGenerate && this.ai && processedSegments.length > 0) {
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
      }

      // 메타데이터에 챕터 추가 (자동 생성된 경우)
      if (chapters.length > 0 && !metadata.chapters) {
        metadata.chapters = chapters;
      }

      // 3.8. 요약 생성 (활성화된 경우)
      let summary: ContentSummary | undefined;
      if (this.config.summary.enabled && this.ai && processedSegments.length > 0) {
        this.updateState({ currentStep: '요약 생성', progress: 36 });
        logger.info('AI 요약 생성 중...');

        try {
          const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
          const summaryResult = await this.ai.summarize(processedSegments, {
            maxLength: this.config.summary.maxLength,
            style: this.config.summary.style,
            language: summaryLang,
          });
          summary = {
            summary: summaryResult.summary,
            keyPoints: summaryResult.keyPoints,
            language: summaryResult.language,
          };
          logger.debug(`요약 생성 완료: ${summary.summary.length}자`);
        } catch (e) {
          logger.warn('요약 생성 실패', e as Error);
        }
      }

      // 번역된 세그먼트로 subtitles 업데이트
      subtitles = {
        ...subtitles,
        segments: processedSegments,
      };

      // 4. 스크린샷 캡처
      this.updateState({ currentStep: '스크린샷 캡처', progress: 40 });

      const screenshotCapturer = new ScreenshotCapturer({
        ffmpeg: this.ffmpeg,
        youtube: this.youtube,
        config: this.config.screenshot,
        tempDir,
        onProgress: (current, total) => {
          const baseProgress = 40;
          const progressRange = 30; // 40 ~ 70
          const progress = baseProgress + Math.floor((current / total) * progressRange);
          this.updateState({ currentStep: `스크린샷 캡처 (${current}/${total})`, progress });
        },
      });

      // 챕터가 있으면 챕터 기준, 없으면 interval 기준
      const useChapters = chapters.length > 0;
      let screenshots;

      if (useChapters) {
        logger.info(`챕터 기준 스크린샷 캡처: ${chapters.length}개 챕터`);
        screenshots = await screenshotCapturer.captureForChapters(videoId, chapters, metadata.thumbnail);
      } else {
        // 첫 번째 스크린샷은 썸네일 사용 (0:00은 보통 검은 화면)
        screenshots = await screenshotCapturer.captureAll(videoId, metadata.duration, metadata.thumbnail);
      }
      this.updateState({ progress: 70 });

      // 5. 콘텐츠 병합
      this.updateState({ currentStep: '콘텐츠 병합', progress: 75 });

      const contentMerger = new ContentMerger({
        screenshotConfig: this.config.screenshot,
      });

      // 챕터 기준 또는 interval 기준 병합
      let content;
      if (useChapters) {
        content = contentMerger.mergeWithChapters(metadata, subtitles, screenshots, chapters);
        logger.info(`챕터 기준 콘텐츠 병합: ${content.sections.length}개 섹션`);
      } else {
        content = contentMerger.merge(metadata, subtitles, screenshots);
      }

      // 요약 추가
      if (summary) {
        content.summary = summary;
      }

      // 5.5. 통합 AI 처리 (번역 + 섹션 요약을 한 번에 처리)
      if (this.unifiedProcessor && this.config.summary.enabled && this.config.summary.perSection && content.sections.length > 0) {
        try {
          const sectionType = useChapters ? '챕터별' : '섹션별';
          this.updateState({ currentStep: `통합 AI 처리 (번역 + ${sectionType} 요약)`, progress: 77 });
          logger.info('통합 AI 처리 시작...');

          const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
          const unifiedResult = await this.unifiedProcessor.processAllSections(
            content.sections.map(s => ({
              timestamp: s.timestamp,
              subtitles: s.subtitles,
            })),
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
              // 번역된 자막 업데이트 (번역이 필요했던 경우)
              if (enhanced.translatedText && subtitles.language !== summaryLang) {
                section.subtitles = [{
                  start: section.timestamp,
                  end: section.timestamp + 60,
                  text: enhanced.translatedText,
                }];
              }

              // 섹션 요약 업데이트
              section.sectionSummary = {
                summary: enhanced.oneLiner,
                keyPoints: enhanced.keyPoints,
                mainInformation: enhanced.mainInformation,
                notableQuotes: enhanced.notableQuotes?.map(q => q.text) || [],
              };

              // 챕터 제목 유지
              if (useChapters && section.chapterTitle) {
                // 챕터 제목은 유지
              }
            }
          }

          // 전체 요약 설정 (이미 있으면 덮어쓰지 않음)
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
          // 폴백: 기존 방식으로 계속 진행
        }
      }

      // 5.6. 챕터별/섹션별 요약 생성 (통합 처리 실패 시 또는 통합 프로세서 없을 때)
      if (this.config.summary.enabled && this.config.summary.perSection && this.ai && content.sections.length > 0 && !this.unifiedProcessor) {
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

          // 섹션에 요약 추가
          for (let i = 0; i < content.sections.length; i++) {
            const sectionSummary = sectionSummaries.find((s) => s.timestamp === content.sections[i].timestamp);
            if (sectionSummary && sectionSummary.summary) {
              // 챕터 제목이 있으면 유지하고 요약만 업데이트
              const existingTitle = content.sections[i].sectionSummary?.summary;
              content.sections[i].sectionSummary = {
                summary: sectionSummary.summary,
                keyPoints: sectionSummary.keyPoints,
              };
              // 챕터 제목을 별도로 저장 (나중에 PDF에서 사용)
              if (useChapters && existingTitle) {
                content.sections[i].chapterTitle = existingTitle;
              }
            }
          }

          logger.debug(`${sectionType} 요약 완료: ${sectionSummaries.filter((s) => s.summary).length}개`);
        } catch (e) {
          logger.warn(`${sectionType} 요약 생성 실패`, e as Error);
        }
      }

      // 6. 출력 생성
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
        this.updateState({ currentStep: 'Executive Brief 생성', progress: 82 });

        // Executive Brief 생성
        let brief: ExecutiveBrief;
        if (this.ai && chapters.length > 0) {
          const summaryLang = this.config.summary.language || this.config.translation.defaultLanguage;
          brief = await this.ai.generateExecutiveBrief(metadata, chapters, processedSegments, { language: summaryLang });
        } else {
          // AI 없거나 챕터 없으면 기본 brief 생성
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
            chapterSummaries: chapters.map(c => ({
              title: c.title,
              startTime: c.startTime,
              summary: '',
            })),
          };
        }

        // 출력 확장자 결정 (pdf, md, html 중 하나로 brief 출력)
        // 기본은 pdf, 설정에 따라 md 또는 html
        const briefExtension = 'pdf'; // 기본값
        const outputPath = path.join(outputDir, `${filename}_brief.${briefExtension}`);

        await pdfGenerator.generateBriefPDF(brief, outputPath);

        // 결과 생성 (brief 형식)
        this.updateState({ status: 'complete', currentStep: '완료', progress: 100 });

        const fileSize = await getFileSize(outputPath);

        return {
          success: true,
          outputPath,
          metadata,
          stats: {
            pages: 1, // Brief는 1페이지
            fileSize,
            duration: metadata.duration,
            screenshotCount: 0, // Brief에는 스크린샷 없음
          },
        };
      }

      // 기존 형식 처리 (pdf, md, html)
      const extension = format === 'pdf' ? 'pdf' : format === 'md' ? 'md' : 'html';
      const outputPath = path.join(outputDir, `${filename}.${extension}`);

      if (format === 'pdf') {
        await pdfGenerator.generatePDF(content, outputPath);
      } else if (format === 'md') {
        // 이미지 복사
        const imagesDir = path.join(outputDir, 'images');
        await ensureDir(imagesDir);
        for (const section of content.sections) {
          const imgName = path.basename(section.screenshot.imagePath);
          const destPath = path.join(imagesDir, imgName);
          await require('fs').promises.copyFile(section.screenshot.imagePath, destPath);
        }
        await pdfGenerator.generateMarkdown(content, outputPath);
      } else {
        // HTML
        const imagesDir = path.join(outputDir, 'images');
        await ensureDir(imagesDir);
        for (const section of content.sections) {
          const imgName = path.basename(section.screenshot.imagePath);
          const destPath = path.join(imagesDir, imgName);
          await require('fs').promises.copyFile(section.screenshot.imagePath, destPath);
        }
        await pdfGenerator.generateHTML(content, outputPath);
      }

      // 7. 결과 생성
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
    } finally {
      // 임시 파일 정리 (캐시 비활성화 시)
      if (!this.config.cache.enabled) {
        await cleanupDir(tempDir);
      }
    }
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
