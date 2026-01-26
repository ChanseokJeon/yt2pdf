/**
 * 스크린샷 캡처러
 */

import * as path from 'path';
import { Screenshot, ImageQuality } from '../types/index.js';
import { ScreenshotConfig } from '../types/config.js';
import { FFmpegWrapper } from '../providers/ffmpeg.js';
import { YouTubeProvider } from '../providers/youtube.js';
import { createTempDir, cleanupDir } from '../utils/file.js';
import { logger } from '../utils/logger.js';

export interface ScreenshotCapturerOptions {
  ffmpeg: FFmpegWrapper;
  youtube: YouTubeProvider;
  config: ScreenshotConfig;
  tempDir?: string;
}

export class ScreenshotCapturer {
  private ffmpeg: FFmpegWrapper;
  private youtube: YouTubeProvider;
  private config: ScreenshotConfig;
  private tempDir?: string;

  constructor(options: ScreenshotCapturerOptions) {
    this.ffmpeg = options.ffmpeg;
    this.youtube = options.youtube;
    this.config = options.config;
    this.tempDir = options.tempDir;
  }

  /**
   * 스크린샷 캡처 (비동기 제너레이터)
   */
  async *captureStream(videoId: string, duration: number): AsyncGenerator<Screenshot> {
    const workDir = this.tempDir || (await createTempDir('yt2pdf-screenshot-'));

    try {
      // 영상 다운로드
      logger.info('영상 다운로드 중...');
      const qualityFormat = this.getDownloadFormat(this.config.quality);
      const videoPath = await this.youtube.downloadVideo(videoId, workDir, qualityFormat);

      // 타임스탬프 생성
      const timestamps = this.ffmpeg.generateTimestamps(duration, this.config.interval);
      const qualitySize = this.getQualitySize(this.config.quality);

      logger.info(`스크린샷 캡처 시작: ${timestamps.length}개`);

      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const outputPath = path.join(workDir, `screenshot_${i.toString().padStart(4, '0')}.jpg`);

        await this.ffmpeg.captureFrame(videoPath, timestamp, outputPath, this.config.quality);

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
   */
  async captureAll(videoId: string, duration: number): Promise<Screenshot[]> {
    const screenshots: Screenshot[] = [];

    for await (const screenshot of this.captureStream(videoId, duration)) {
      screenshots.push(screenshot);
    }

    return screenshots;
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
