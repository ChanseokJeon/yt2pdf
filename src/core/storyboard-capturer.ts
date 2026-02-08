/**
 * YouTube Storyboard 기반 스크린샷 캡처
 * - 영상 다운로드 없이 빠르게 스크린샷 획득
 * - YouTube의 진행바 미리보기 이미지(Storyboard) 활용
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Screenshot, Chapter } from '../types/index.js';
import { createTempDir } from '../utils/file.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface StoryboardMetadata {
  formatId: string;
  frameWidth: number;
  frameHeight: number;
  rows: number;
  columns: number;
  fps: number;
  fragments: Array<{
    url: string;
    duration: number;
  }>;
  totalDuration: number;
}

export interface StoryboardCapturerOptions {
  tempDir?: string;
  preferredFormat?: 'sb0' | 'sb1' | 'sb2' | 'sb3'; // sb0 = 최고 품질
  onProgress?: (current: number, total: number) => void;
}

export class StoryboardCapturer {
  private tempDir?: string;
  private preferredFormat: string;
  private onProgress?: (current: number, total: number) => void;

  constructor(options: StoryboardCapturerOptions = {}) {
    this.tempDir = options.tempDir;
    this.preferredFormat = options.preferredFormat || 'sb0';
    this.onProgress = options.onProgress;
  }

  /**
   * Storyboard 메타데이터 추출
   */
  async getStoryboardMetadata(videoId: string): Promise<StoryboardMetadata | null> {
    try {
      const { stdout } = await execAsync(
        `yt-dlp --dump-json --skip-download "https://www.youtube.com/watch?v=${videoId}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      interface StoryboardFormat {
        format_id: string;
        width: number;
        height: number;
        rows: number;
        columns: number;
        fps: number;
        fragments: Array<{ url: string; duration: number }>;
      }
      interface VideoInfo {
        formats?: StoryboardFormat[];
        duration?: number;
      }

      const info = JSON.parse(stdout) as VideoInfo;
      const formats = info.formats || [];

      // 선호하는 포맷 찾기 (sb0 > sb1 > sb2 > sb3)
      const sbFormats = formats.filter((f) => f.format_id.startsWith('sb'));

      if (sbFormats.length === 0) {
        logger.warn('Storyboard 포맷을 찾을 수 없음');
        return null;
      }

      // 선호 포맷 또는 가장 고품질 선택
      let selectedFormat = sbFormats.find((f) => f.format_id === this.preferredFormat);
      if (!selectedFormat) {
        // sb0 > sb1 > sb2 > sb3 순서로 선택
        selectedFormat = sbFormats.sort((a, b) => a.format_id.localeCompare(b.format_id))[0];
      }

      return {
        formatId: selectedFormat.format_id,
        frameWidth: selectedFormat.width,
        frameHeight: selectedFormat.height,
        rows: selectedFormat.rows,
        columns: selectedFormat.columns,
        fps: selectedFormat.fps,
        fragments: selectedFormat.fragments,
        totalDuration: info.duration || 0,
      };
    } catch (error) {
      logger.warn('Storyboard 메타데이터 추출 실패:', error as Error);
      return null;
    }
  }

  /**
   * Storyboard 이미지 다운로드 및 프레임 분할
   */
  async captureFromStoryboard(videoId: string, chapters?: Chapter[]): Promise<Screenshot[]> {
    const metadata = await this.getStoryboardMetadata(videoId);
    if (!metadata) {
      throw new Error('Storyboard를 사용할 수 없음');
    }

    const workDir = this.tempDir || (await createTempDir('yt2pdf-storyboard-'));
    const screenshots: Screenshot[] = [];

    try {
      logger.info(
        `Storyboard 캡처 시작 (${metadata.formatId}: ${metadata.frameWidth}x${metadata.frameHeight})`
      );

      const framesPerSheet = metadata.rows * metadata.columns;
      const secondsPerFrame = 1 / metadata.fps;

      // 챕터가 있으면 챕터 시작 시점의 프레임만 추출
      // 없으면 모든 프레임 추출
      const targetTimestamps = chapters
        ? chapters.map((c) => c.startTime)
        : this.generateAllTimestamps(metadata);

      let processedCount = 0;
      const totalCount = targetTimestamps.length;

      for (let fragIndex = 0; fragIndex < metadata.fragments.length; fragIndex++) {
        const fragment = metadata.fragments[fragIndex];
        const sheetPath = path.join(workDir, `storyboard_${fragIndex}.jpg`);

        // Storyboard 시트 다운로드
        await this.downloadImage(fragment.url, sheetPath);

        // 이 시트에서 추출할 프레임들 결정
        const fragStartTime = fragIndex * framesPerSheet * secondsPerFrame;
        const fragEndTime = fragStartTime + framesPerSheet * secondsPerFrame;

        for (const targetTime of targetTimestamps) {
          // 이 시트에 포함된 타임스탬프인지 확인
          if (targetTime >= fragStartTime && targetTime < fragEndTime) {
            const frameIndexInSheet = Math.floor((targetTime - fragStartTime) / secondsPerFrame);
            const row = Math.floor(frameIndexInSheet / metadata.columns);
            const col = frameIndexInSheet % metadata.columns;

            const framePath = path.join(
              workDir,
              `frame_${targetTime.toFixed(0).padStart(5, '0')}.jpg`
            );

            // FFmpeg로 프레임 추출
            await this.extractFrame(
              sheetPath,
              framePath,
              col * metadata.frameWidth,
              row * metadata.frameHeight,
              metadata.frameWidth,
              metadata.frameHeight
            );

            screenshots.push({
              timestamp: targetTime,
              imagePath: framePath,
              width: metadata.frameWidth,
              height: metadata.frameHeight,
            });

            processedCount++;
            if (this.onProgress) {
              this.onProgress(processedCount, totalCount);
            }
          }
        }
      }

      // 타임스탬프 순으로 정렬
      screenshots.sort((a, b) => a.timestamp - b.timestamp);

      logger.success(`Storyboard 캡처 완료: ${screenshots.length}개`);
      return screenshots;
    } finally {
      // Cleanup handled by caller
    }
  }

  /**
   * 모든 타임스탬프 생성
   */
  private generateAllTimestamps(metadata: StoryboardMetadata): number[] {
    const timestamps: number[] = [];
    const secondsPerFrame = 1 / metadata.fps;
    const totalFrames = metadata.fragments.length * metadata.rows * metadata.columns;

    for (let i = 0; i < totalFrames; i++) {
      const timestamp = i * secondsPerFrame;
      if (timestamp <= metadata.totalDuration) {
        timestamps.push(timestamp);
      }
    }

    return timestamps;
  }

  /**
   * 이미지 다운로드
   */
  private async downloadImage(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`이미지 다운로드 실패: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsPromises.writeFile(outputPath, buffer);
  }

  /**
   * FFmpeg로 프레임 추출 (스프라이트 시트에서 크롭)
   */
  private async extractFrame(
    inputPath: string,
    outputPath: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    await execAsync(
      `ffmpeg -i "${inputPath}" -vf "crop=${width}:${height}:${x}:${y}" -frames:v 1 -y "${outputPath}" 2>/dev/null`
    );
    if (!fs.existsSync(outputPath)) {
      throw new Error(`프레임 추출 실패: ${inputPath}`);
    }
  }

  /**
   * Storyboard 사용 가능 여부 확인
   */
  async isStoryboardAvailable(videoId: string): Promise<boolean> {
    const metadata = await this.getStoryboardMetadata(videoId);
    return metadata !== null;
  }
}
