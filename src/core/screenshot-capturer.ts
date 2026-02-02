/**
 * 스크린샷 캡처러
 */

import * as path from 'path';
import { Screenshot, ImageQuality, Chapter } from '../types/index.js';
import { ScreenshotConfig } from '../types/config.js';
import { FFmpegWrapper } from '../providers/ffmpeg.js';
import { YouTubeProvider } from '../providers/youtube.js';
import { createTempDir } from '../utils/file.js';
import { logger } from '../utils/logger.js';

export interface ScreenshotCapturerOptions {
  ffmpeg: FFmpegWrapper;
  youtube: YouTubeProvider;
  config: ScreenshotConfig;
  tempDir?: string;
  onProgress?: (current: number, total: number) => void;
  // Dev mode options
  devQuality?: 'lowest' | '360p' | '480p';
  devMaxScreenshots?: number;
}

export class ScreenshotCapturer {
  private ffmpeg: FFmpegWrapper;
  private youtube: YouTubeProvider;
  private config: ScreenshotConfig;
  private tempDir?: string;
  private onProgress?: (current: number, total: number) => void;
  private readonly devQuality?: string;
  private readonly devMaxScreenshots?: number;

  constructor(options: ScreenshotCapturerOptions) {
    this.ffmpeg = options.ffmpeg;
    this.youtube = options.youtube;
    this.config = options.config;
    this.tempDir = options.tempDir;
    this.onProgress = options.onProgress;
    this.devQuality = options.devQuality;
    this.devMaxScreenshots = options.devMaxScreenshots;
  }

  /**
   * 스크린샷 캡처 (비동기 제너레이터)
   * @param videoId - YouTube 비디오 ID
   * @param duration - 영상 길이 (초)
   * @param thumbnailUrl - 첫 프레임 대신 사용할 썸네일 URL (선택)
   */
  async *captureStream(
    videoId: string,
    duration: number,
    thumbnailUrl?: string
  ): AsyncGenerator<Screenshot> {
    const workDir = this.tempDir || (await createTempDir('yt2pdf-screenshot-'));

    try {
      // 영상 다운로드
      logger.info('영상 다운로드 중...');
      const qualityFormat = this.getDownloadFormat(this.config.quality);
      const videoPath = await this.youtube.downloadVideo(videoId, workDir, qualityFormat);

      // 타임스탬프 생성
      let timestamps = this.ffmpeg.generateTimestamps(duration, this.config.interval);

      // Apply dev mode screenshot limiting (for non-chapter videos)
      if (this.devMaxScreenshots && timestamps.length > this.devMaxScreenshots) {
        const originalCount = timestamps.length;
        // Evenly sample across the video
        const step = Math.ceil(timestamps.length / this.devMaxScreenshots);
        timestamps = timestamps.filter((_, i) => i % step === 0).slice(0, this.devMaxScreenshots);
        logger.warn(`[DEV MODE] 스크린샷 제한: ${originalCount}개 → ${timestamps.length}개로 샘플링`);
      }

      const qualitySize = this.getQualitySize(this.config.quality);

      logger.info(`스크린샷 캡처 시작: ${timestamps.length}개`);

      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const outputPath = path.join(workDir, `screenshot_${i.toString().padStart(4, '0')}.jpg`);

        // 첫 번째 프레임(0:00)은 썸네일 사용
        if (i === 0 && timestamp === 0 && thumbnailUrl) {
          try {
            await this.youtube.downloadThumbnail(thumbnailUrl, outputPath);
            logger.debug('첫 프레임에 썸네일 사용');
          } catch {
            // 썸네일 다운로드 실패 시 일반 캡처
            await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);
          }
        } else {
          await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);
        }

        // 진행률 콜백 호출
        if (this.onProgress) {
          this.onProgress(i + 1, timestamps.length);
        }

        yield {
          timestamp,
          imagePath: outputPath,
          width: qualitySize.width,
          height: qualitySize.height,
        };
      }

      logger.success(`스크린샷 캡처 완료: ${timestamps.length}개`);
    } catch (error) {
      // 작업 디렉토리 정리는 호출자가 처리
      throw error;
    }
  }

  /**
   * 일괄 스크린샷 캡처
   * @param videoId - YouTube 비디오 ID
   * @param duration - 영상 길이 (초)
   * @param thumbnailUrl - 첫 프레임 대신 사용할 썸네일 URL (선택)
   */
  async captureAll(
    videoId: string,
    duration: number,
    thumbnailUrl?: string
  ): Promise<Screenshot[]> {
    const screenshots: Screenshot[] = [];

    for await (const screenshot of this.captureStream(videoId, duration, thumbnailUrl)) {
      screenshots.push(screenshot);
    }

    return screenshots;
  }

  /**
   * 챕터 기준 스크린샷 캡처
   * @param videoId - YouTube 비디오 ID
   * @param chapters - 챕터 목록
   * @param thumbnailUrl - 첫 프레임 대신 사용할 썸네일 URL (선택)
   */
  async captureForChapters(
    videoId: string,
    chapters: Chapter[],
    thumbnailUrl?: string
  ): Promise<Screenshot[]> {
    if (chapters.length === 0) {
      return [];
    }

    const workDir = this.tempDir || (await createTempDir('yt2pdf-screenshot-'));
    const screenshots: Screenshot[] = [];

    try {
      // 영상 다운로드
      logger.info('영상 다운로드 중...');
      const qualityFormat = this.getDownloadFormat(this.config.quality);
      const videoPath = await this.youtube.downloadVideo(videoId, workDir, qualityFormat);

      const qualitySize = this.getQualitySize(this.config.quality);

      logger.info(`챕터 기준 스크린샷 캡처 시작: ${chapters.length}개`);

      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const timestamp = chapter.startTime;
        const outputPath = path.join(workDir, `screenshot_${i.toString().padStart(4, '0')}.jpg`);

        // 첫 번째 챕터(0:00)는 썸네일 사용
        if (i === 0 && timestamp === 0 && thumbnailUrl) {
          try {
            await this.youtube.downloadThumbnail(thumbnailUrl, outputPath);
            logger.debug('첫 챕터에 썸네일 사용');
          } catch {
            // 썸네일 다운로드 실패 시 일반 캡처
            await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);
          }
        } else {
          await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);
        }

        // 진행률 콜백 호출
        if (this.onProgress) {
          this.onProgress(i + 1, chapters.length);
        }

        screenshots.push({
          timestamp,
          imagePath: outputPath,
          width: qualitySize.width,
          height: qualitySize.height,
        });
      }

      logger.success(`챕터 기준 스크린샷 캡처 완료: ${chapters.length}개`);
      return screenshots;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 특정 시점 스크린샷 캡처
   */
  async captureAt(videoPath: string, timestamp: number, outputPath: string): Promise<Screenshot> {
    await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);

    const qualitySize = this.getQualitySize(this.config.quality);

    return {
      timestamp,
      imagePath: outputPath,
      width: qualitySize.width,
      height: qualitySize.height,
    };
  }

  /**
   * 품질에 따른 다운로드 포맷
   */
  private getDownloadFormat(quality: ImageQuality): string {
    // Check for dev mode override
    if (this.devQuality) {
      switch (this.devQuality) {
        case 'lowest':
          return 'worst';
        case '360p':
          return 'worst[height>=360]/best[height<=360]';
        case '480p':
          return 'worst[height>=480]/best[height<=480]';
      }
    }

    switch (quality) {
      case 'high':
        return 'best[height<=1080]';
      case 'medium':
        return 'best[height<=720]';
      case 'low':
      default:
        return 'worst[height>=480]/best[height<=480]';
    }
  }

  /**
   * 품질에 따른 크기
   */
  private getQualitySize(quality: ImageQuality): { width: number; height: number } {
    switch (quality) {
      case 'high':
        return { width: 1920, height: 1080 };
      case 'medium':
        return { width: 1280, height: 720 };
      case 'low':
      default:
        return { width: 854, height: 480 };
    }
  }
}
