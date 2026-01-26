/**
 * YouTube Provider - yt-dlp 래퍼
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { VideoMetadata, CaptionTrack, SubtitleSegment, ErrorCode, Yt2PdfError } from '../types/index.js';
import { parseYouTubeUrl, isValidYouTubeUrl, buildVideoUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class YouTubeProvider {
  private ytdlpPath: string;

  constructor(ytdlpPath?: string) {
    this.ytdlpPath = ytdlpPath || process.env.YT_DLP_PATH || 'yt-dlp';
  }

  /**
   * yt-dlp 설치 확인
   */
  static async checkInstallation(): Promise<boolean> {
    try {
      await execAsync('yt-dlp --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 영상 메타데이터 가져오기
   */
  async getMetadata(url: string): Promise<VideoMetadata> {
    if (!isValidYouTubeUrl(url)) {
      throw new Yt2PdfError(ErrorCode.INVALID_URL, '유효하지 않은 YouTube URL입니다.');
    }

    try {
      logger.debug(`메타데이터 가져오기: ${url}`);
      const { stdout } = await execAsync(`${this.ytdlpPath} --dump-json --no-playlist "${url}"`);
      const data = JSON.parse(stdout);

      return {
        id: data.id,
        title: data.title || 'Untitled',
        description: data.description || '',
        duration: data.duration || 0,
        thumbnail: data.thumbnail || '',
        channel: data.uploader || data.channel || 'Unknown',
        uploadDate: data.upload_date || '',
        viewCount: data.view_count || 0,
        availableCaptions: this.parseCaptions(data.subtitles, data.automatic_captions),
      };
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('Video unavailable') || err.message.includes('Private video')) {
        throw new Yt2PdfError(ErrorCode.VIDEO_PRIVATE, '비공개 또는 삭제된 영상입니다.');
      }
      throw new Yt2PdfError(ErrorCode.VIDEO_NOT_FOUND, `영상 정보를 가져올 수 없습니다: ${err.message}`, err);
    }
  }

  /**
   * 플레이리스트 영상 목록 가져오기
   */
  async getPlaylistVideos(url: string): Promise<VideoMetadata[]> {
    try {
      logger.debug(`플레이리스트 정보 가져오기: ${url}`);
      const { stdout } = await execAsync(`${this.ytdlpPath} --flat-playlist --dump-json "${url}"`);

      const videos = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      if (videos.length === 0) {
        throw new Yt2PdfError(ErrorCode.PLAYLIST_EMPTY, '플레이리스트가 비어 있습니다.');
      }

      // 각 영상의 상세 메타데이터 가져오기
      const metadataList: VideoMetadata[] = [];
      for (const video of videos) {
        try {
          const videoUrl = buildVideoUrl(video.id);
          const metadata = await this.getMetadata(videoUrl);
          metadataList.push(metadata);
        } catch (e) {
          logger.warn(`영상 ${video.id} 메타데이터 가져오기 실패`);
        }
      }

      return metadataList;
    } catch (error) {
      if (error instanceof Yt2PdfError) throw error;
      const err = error as Error;
      throw new Yt2PdfError(ErrorCode.PLAYLIST_EMPTY, `플레이리스트 정보를 가져올 수 없습니다: ${err.message}`, err);
    }
  }

  /**
   * 자막 가져오기
   */
  async getCaptions(videoId: string, langCode: string): Promise<SubtitleSegment[]> {
    const tempDir = path.join(os.tmpdir(), `yt2pdf-${videoId}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      logger.debug(`자막 다운로드: ${videoId} (${langCode})`);
      const url = buildVideoUrl(videoId);

      // 자막 다운로드 시도
      await execAsync(
        `${this.ytdlpPath} --write-sub --write-auto-sub --sub-lang ${langCode} ` +
          `--sub-format vtt --skip-download -o "${tempDir}/%(id)s" "${url}"`
      );

      // VTT 파일 찾기
      const files = await fs.readdir(tempDir);
      const vttFile = files.find((f) => f.endsWith('.vtt'));

      if (!vttFile) {
        logger.debug(`자막 파일 없음: ${langCode}`);
        return [];
      }

      const vttPath = path.join(tempDir, vttFile);
      const vttContent = await fs.readFile(vttPath, 'utf-8');
      return this.parseVTT(vttContent);
    } catch (error) {
      logger.debug(`자막 다운로드 실패: ${(error as Error).message}`);
      return [];
    } finally {
      // 정리
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * 오디오 다운로드 (Whisper용)
   */
  async downloadAudio(videoId: string, outputDir: string): Promise<string> {
    const outputPath = path.join(outputDir, `${videoId}.mp3`);

    try {
      logger.debug(`오디오 다운로드: ${videoId}`);
      const url = buildVideoUrl(videoId);

      await execAsync(
        `${this.ytdlpPath} -x --audio-format mp3 --audio-quality 0 ` +
          `-o "${outputPath}" "${url}"`
      );

      return outputPath;
    } catch (error) {
      const err = error as Error;
      throw new Yt2PdfError(ErrorCode.VIDEO_DOWNLOAD_FAILED, `오디오 다운로드 실패: ${err.message}`, err);
    }
  }

  /**
   * 영상 다운로드
   */
  async downloadVideo(videoId: string, outputDir: string, format: string = 'worst[height>=480]'): Promise<string> {
    const outputPath = path.join(outputDir, `${videoId}.mp4`);

    try {
      logger.debug(`영상 다운로드: ${videoId}`);
      const url = buildVideoUrl(videoId);

      await execAsync(
        `${this.ytdlpPath} -f "${format}" --merge-output-format mp4 ` +
          `-o "${outputPath}" "${url}"`
      );

      return outputPath;
    } catch (error) {
      const err = error as Error;
      throw new Yt2PdfError(ErrorCode.VIDEO_DOWNLOAD_FAILED, `영상 다운로드 실패: ${err.message}`, err);
    }
  }

  /**
   * VTT 파싱
   */
  private parseVTT(content: string): SubtitleSegment[] {
    const segments: SubtitleSegment[] = [];
    const lines = content.split('\n');

    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    let currentText: string[] = [];

    for (const line of lines) {
      // 타임스탬프 라인 감지
      const timestampMatch = line.match(
        /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
      );

      if (timestampMatch) {
        // 이전 세그먼트 저장
        if (currentStart !== null && currentText.length > 0) {
          segments.push({
            start: currentStart,
            end: currentEnd || currentStart,
            text: currentText.join(' ').trim(),
          });
        }

        currentStart = this.parseTimestamp(timestampMatch[1]);
        currentEnd = this.parseTimestamp(timestampMatch[2]);
        currentText = [];
      } else if (line.trim() && currentStart !== null) {
        // VTT 태그 제거
        const cleanedLine = line
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();

        if (cleanedLine) {
          currentText.push(cleanedLine);
        }
      }
    }

    // 마지막 세그먼트 저장
    if (currentStart !== null && currentText.length > 0) {
      segments.push({
        start: currentStart,
        end: currentEnd || currentStart,
        text: currentText.join(' ').trim(),
      });
    }

    return segments;
  }

  /**
   * 타임스탬프 파싱 (HH:MM:SS.mmm 또는 MM:SS.mmm -> 초)
   */
  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  /**
   * 자막 정보 파싱
   */
  private parseCaptions(subtitles?: Record<string, unknown[]>, autoCaptions?: Record<string, unknown[]>): CaptionTrack[] {
    const tracks: CaptionTrack[] = [];

    // 수동 자막
    if (subtitles) {
      for (const code of Object.keys(subtitles)) {
        tracks.push({
          language: code,
          languageCode: code,
          isAutoGenerated: false,
        });
      }
    }

    // 자동 자막
    if (autoCaptions) {
      for (const code of Object.keys(autoCaptions)) {
        // 중복 체크
        if (!tracks.some((t) => t.languageCode === code)) {
          tracks.push({
            language: code,
            languageCode: code,
            isAutoGenerated: true,
          });
        }
      }
    }

    return tracks;
  }
}

// 기본 인스턴스
export const youtubeProvider = new YouTubeProvider();
