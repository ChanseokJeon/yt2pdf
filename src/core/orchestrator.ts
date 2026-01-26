/**
 * 오케스트레이터 - 파이프라인 조율
 */

import * as path from 'path';
import { Config, ConvertOptions } from '../types/config.js';
import {
  ConvertResult,
  PipelineState,
  ProgressCallback,
  VideoMetadata,
  ErrorCode,
  Yt2PdfError,
} from '../types/index.js';
import { YouTubeProvider } from '../providers/youtube.js';
import { FFmpegWrapper } from '../providers/ffmpeg.js';
import { WhisperProvider } from '../providers/whisper.js';
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
  applyFilenamePattern,
  getFileSize,
  formatBytes,
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

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.cache = options.cache;

    this.youtube = new YouTubeProvider();
    this.ffmpeg = new FFmpegWrapper();

    // Whisper는 API 키가 있을 때만 초기화
    if (process.env.OPENAI_API_KEY) {
      try {
        this.whisper = new WhisperProvider();
      } catch {
        // API 키가 없으면 Whisper 사용 불가
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

      const subtitles = await subtitleExtractor.extract(videoId, audioPath);

      // 4. 스크린샷 캡처
      this.updateState({ currentStep: '스크린샷 캡처', progress: 40 });

      const screenshotCapturer = new ScreenshotCapturer({
        ffmpeg: this.ffmpeg,
        youtube: this.youtube,
        config: this.config.screenshot,
        tempDir,
      });

      const screenshots = await screenshotCapturer.captureAll(videoId, metadata.duration);
      this.updateState({ progress: 70 });

      // 5. 콘텐츠 병합
      this.updateState({ currentStep: '콘텐츠 병합', progress: 75 });

      const contentMerger = new ContentMerger({
        screenshotConfig: this.config.screenshot,
      });

      const content = contentMerger.merge(metadata, subtitles, screenshots);

      // 6. 출력 생성
      this.updateState({ status: 'generating', currentStep: 'PDF 생성', progress: 80 });

      const outputDir = options.output || this.config.output.directory;
      await ensureDir(outputDir);

      const filename = applyFilenamePattern(this.config.output.filenamePattern, {
        date: getDateString(),
        index: '001',
        title: metadata.title,
      });

      const format = options.format || this.config.output.format;
      const extension = format === 'pdf' ? 'pdf' : format === 'md' ? 'md' : 'html';
      const outputPath = path.join(outputDir, `${filename}.${extension}`);

      const pdfGenerator = new PDFGenerator(this.config.pdf);

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
