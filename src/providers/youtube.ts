/**
 * YouTube Provider - yt-dlp 래퍼
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  VideoMetadata,
  CaptionTrack,
  SubtitleSegment,
  ErrorCode,
  Yt2PdfError,
  Chapter,
} from '../types/index.js';
import { isValidYouTubeUrl, buildVideoUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import { getValidatedProxyUrl, isYouTubeIpBlock } from '../utils/proxy.js';

const execFileAsync = promisify(execFile);

/** Timeout for metadata/caption/lightweight yt-dlp calls (ms) */
export const YTDLP_METADATA_TIMEOUT_MS = 30_000;

/** Timeout for download operations (audio/video) (ms) */
export const YTDLP_DOWNLOAD_TIMEOUT_MS = 300_000;

export class YouTubeProvider {
  private ytdlpPath: string;
  private proxyUrl?: string;
  private forceProxy: boolean;
  private _lastCallUsedProxy = false;
  private _lastCallFallbackTriggered = false;

  constructor(ytdlpPath?: string, forceProxy?: boolean) {
    this.ytdlpPath = ytdlpPath || process.env.YT_DLP_PATH || 'yt-dlp';
    this.forceProxy = forceProxy ?? false;
    const rawProxy = process.env.YT_DLP_PROXY;
    this.proxyUrl = getValidatedProxyUrl(rawProxy);
    if (rawProxy && !this.proxyUrl) {
      logger.warn(`Invalid proxy URL ignored: ${rawProxy.substring(0, 50)}...`);
    }
  }

  /** 마지막 호출에서 프록시가 사용되었는지 여부 */
  wasProxyUsed(): boolean {
    return this._lastCallUsedProxy;
  }

  /** 마지막 호출에서 폴백이 트리거되었는지 여부 */
  wasFallbackTriggered(): boolean {
    return this._lastCallFallbackTriggered;
  }

  /** Whether a validated proxy URL is available */
  hasValidProxy(): boolean {
    return !!this.proxyUrl;
  }

  /** Base args for all yt-dlp calls (no proxy) */
  private getBaseArgs(): string[] {
    return [];
  }

  /** Proxy args to add on retry */
  private getProxyArgs(): string[] {
    return this.proxyUrl ? ['--proxy', this.proxyUrl] : [];
  }

  /** Whether proxy fallback is available */
  private hasProxy(): boolean {
    return !!this.proxyUrl;
  }

  /**
   * Execute yt-dlp with automatic proxy fallback on IP block detection.
   * forceProxy=true: 프록시가 있으면 첫 시도부터 프록시 사용.
   * forceProxy=false (기본): 프록시 없이 먼저 시도, IP 차단 시 프록시로 재시도.
   */
  private async execWithProxyFallback(
    args: string[],
    options?: { maxBuffer?: number; timeout?: number }
  ): Promise<{ stdout: string; stderr: string }> {
    // Reset tracking
    this._lastCallUsedProxy = false;
    this._lastCallFallbackTriggered = false;

    // forceProxy: 프록시가 있으면 첫 시도부터 프록시 사용
    if (this.forceProxy && this.hasProxy()) {
      this._lastCallUsedProxy = true;
      const result = await execFileAsync(
        this.ytdlpPath,
        [...this.getBaseArgs(), ...this.getProxyArgs(), ...args],
        options
      );
      return {
        stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString(),
        stderr: result.stderr
          ? typeof result.stderr === 'string'
            ? result.stderr
            : result.stderr.toString()
          : '',
      };
    }

    try {
      const result = await execFileAsync(this.ytdlpPath, [...this.getBaseArgs(), ...args], options);
      return {
        stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString(),
        stderr: result.stderr
          ? typeof result.stderr === 'string'
            ? result.stderr
            : result.stderr.toString()
          : '',
      };
    } catch (error: unknown) {
      const err = error as Error & { stderr?: string };

      // Combine err.message and err.stderr for comprehensive block detection
      const errorText = [err.message, err.stderr].filter(Boolean).join(' ');

      if (this.hasProxy() && isYouTubeIpBlock(errorText)) {
        logger.warn('YouTube IP 차단 감지, 프록시로 재시도 중...');
        logger.debug(`프록시: ${this.proxyUrl}`);
        this._lastCallUsedProxy = true;
        this._lastCallFallbackTriggered = true;
        const result = await execFileAsync(
          this.ytdlpPath,
          [...this.getBaseArgs(), ...this.getProxyArgs(), ...args],
          options
        );
        return {
          stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString(),
          stderr: result.stderr
            ? typeof result.stderr === 'string'
              ? result.stderr
              : result.stderr.toString()
            : '',
        };
      }

      throw error;
    }
  }

  /**
   * yt-dlp 설치 확인
   */
  static async checkInstallation(): Promise<boolean> {
    try {
      await execFileAsync('yt-dlp', ['--version'], { timeout: 5_000 });
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
      const { stdout } = await this.execWithProxyFallback(['--dump-json', '--no-playlist', url], {
        timeout: YTDLP_METADATA_TIMEOUT_MS,
      });
      const data = JSON.parse(stdout) as {
        id: string;
        title?: string;
        description?: string;
        duration?: number;
        thumbnail?: string;
        uploader?: string;
        channel?: string;
        upload_date?: string;
        view_count?: number;
        subtitles?: Record<string, unknown[]>;
        automatic_captions?: Record<string, unknown[]>;
        chapters?: Array<{ title?: string; start_time?: number; end_time?: number }>;
      };

      // 챕터 파싱
      const chapters = this.parseChapters(data.chapters, data.duration);

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
        chapters: chapters.length > 0 ? chapters : undefined,
      };
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes('Video unavailable') || err.message.includes('Private video')) {
        throw new Yt2PdfError(ErrorCode.VIDEO_PRIVATE, '비공개 또는 삭제된 영상입니다.');
      }
      throw new Yt2PdfError(
        ErrorCode.VIDEO_NOT_FOUND,
        `영상 정보를 가져올 수 없습니다: ${err.message}`,
        err
      );
    }
  }

  /**
   * 플레이리스트 영상 목록 가져오기
   */
  async getPlaylistVideos(url: string): Promise<VideoMetadata[]> {
    try {
      logger.debug(`플레이리스트 정보 가져오기: ${url}`);
      const { stdout } = await this.execWithProxyFallback(['--flat-playlist', '--dump-json', url], {
        timeout: YTDLP_METADATA_TIMEOUT_MS,
      });

      const videos = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { id: string });

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
        } catch (e: unknown) {
          logger.warn(`영상 ${video.id} 메타데이터 가져오기 실패`);
        }
      }

      return metadataList;
    } catch (error: unknown) {
      if (error instanceof Yt2PdfError) throw error;
      const err = error as Error;
      throw new Yt2PdfError(
        ErrorCode.PLAYLIST_EMPTY,
        `플레이리스트 정보를 가져올 수 없습니다: ${err.message}`,
        err
      );
    }
  }

  /**
   * 자막 가져오기
   */
  async getCaptions(videoId: string, langCode: string): Promise<SubtitleSegment[]> {
    const tempDir = path.join(os.tmpdir(), `v2doc-${videoId}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      logger.debug(`자막 다운로드: ${videoId} (${langCode})`);
      const url = buildVideoUrl(videoId);

      // 자막 다운로드 시도
      await this.execWithProxyFallback(
        [
          '--write-sub',
          '--write-auto-sub',
          '--sub-lang',
          langCode,
          '--sub-format',
          'vtt',
          '--skip-download',
          '-o',
          `${tempDir}/%(id)s`,
          url,
        ],
        { timeout: YTDLP_METADATA_TIMEOUT_MS }
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

      await this.execWithProxyFallback(
        ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputPath, url],
        { timeout: YTDLP_DOWNLOAD_TIMEOUT_MS }
      );

      return outputPath;
    } catch (error) {
      const err = error as Error;
      throw new Yt2PdfError(
        ErrorCode.VIDEO_DOWNLOAD_FAILED,
        `오디오 다운로드 실패: ${err.message}`,
        err
      );
    }
  }

  /**
   * 영상 다운로드
   */
  async downloadVideo(
    videoId: string,
    outputDir: string,
    format: string = 'worst[height>=480]'
  ): Promise<string> {
    const outputPath = path.join(outputDir, `${videoId}.mp4`);

    try {
      logger.debug(`영상 다운로드: ${videoId}`);
      const url = buildVideoUrl(videoId);

      await this.execWithProxyFallback(
        ['-f', format, '--merge-output-format', 'mp4', '-o', outputPath, url],
        { timeout: YTDLP_DOWNLOAD_TIMEOUT_MS }
      );

      return outputPath;
    } catch (error) {
      const err = error as Error;
      throw new Yt2PdfError(
        ErrorCode.VIDEO_DOWNLOAD_FAILED,
        `영상 다운로드 실패: ${err.message}`,
        err
      );
    }
  }

  /**
   * 썸네일 다운로드 (JPEG로 변환)
   * NOTE: fetch-based -- no proxy fallback (i.ytimg.com CDN is rarely blocked)
   * If needed, implement via undici ProxyAgent
   */
  async downloadThumbnail(thumbnailUrl: string, outputPath: string): Promise<string> {
    try {
      logger.debug(`썸네일 다운로드: ${thumbnailUrl}`);

      // 더 나은 품질의 썸네일 URL 사용 (maxresdefault 또는 hqdefault)
      // YouTube 썸네일 URL 패턴: https://i.ytimg.com/vi/{videoId}/{quality}.jpg
      let betterUrl = thumbnailUrl;
      if (thumbnailUrl.includes('i.ytimg.com')) {
        const videoIdMatch = thumbnailUrl.match(/\/vi\/([^/]+)\//);
        if (videoIdMatch) {
          // maxresdefault > sddefault > hqdefault 순으로 시도
          betterUrl = `https://i.ytimg.com/vi/${videoIdMatch[1]}/maxresdefault.jpg`;
        }
      }

      // Node.js fetch를 사용하여 썸네일 다운로드
      let response = await fetch(betterUrl);
      if (!response.ok && betterUrl !== thumbnailUrl) {
        // maxresdefault가 없으면 원본 URL 시도
        response = await fetch(thumbnailUrl);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // 이미지 형식 확인 및 변환 (ffmpeg 사용)
      const tempPath = outputPath.replace('.jpg', '_temp');
      await fs.writeFile(tempPath, buffer);

      try {
        // ffmpeg로 JPEG 변환
        await execFileAsync('ffmpeg', ['-y', '-i', tempPath, '-q:v', '2', outputPath]);
        await fs.unlink(tempPath).catch(() => {});
      } catch {
        // ffmpeg 변환 실패 시 원본 사용
        await fs.rename(tempPath, outputPath);
      }

      logger.debug(`썸네일 저장 완료: ${outputPath}`);
      return outputPath;
    } catch (error) {
      const err = error as Error;
      logger.warn(`썸네일 다운로드 실패: ${err.message}`);
      throw new Yt2PdfError(
        ErrorCode.VIDEO_DOWNLOAD_FAILED,
        `썸네일 다운로드 실패: ${err.message}`,
        err
      );
    }
  }

  /**
   * YouTube 썸네일 여러 장 다운로드 (dev mode 최적화용)
   * 영상의 여러 지점 썸네일을 빠르게 가져옴 (비디오 다운로드 불필요)
   * NOTE: fetch-based -- no proxy fallback (i.ytimg.com CDN is rarely blocked)
   */
  async downloadThumbnails(
    videoId: string,
    outputDir: string,
    count: number = 2
  ): Promise<{ path: string; timestamp: number }[]> {
    // YouTube 썸네일 URL 패턴들 (영상 내 여러 지점)
    const thumbnailVariants = [
      { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, position: 0 },
      { url: `https://i.ytimg.com/vi/${videoId}/1.jpg`, position: 0.25 },
      { url: `https://i.ytimg.com/vi/${videoId}/2.jpg`, position: 0.5 },
      { url: `https://i.ytimg.com/vi/${videoId}/3.jpg`, position: 0.75 },
      { url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, position: 0 },
    ];

    const results: { path: string; timestamp: number }[] = [];
    const selected = thumbnailVariants.slice(0, Math.min(count + 1, thumbnailVariants.length));

    logger.info(`[DEV MODE] YouTube 썸네일 ${count}개 다운로드 중...`);

    for (let i = 0; i < selected.length && results.length < count; i++) {
      const { url, position } = selected[i];
      const outputPath = path.join(outputDir, `thumbnail_${i.toString().padStart(4, '0')}.jpg`);

      try {
        const response = await fetch(url);
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(outputPath, buffer);
        results.push({ path: outputPath, timestamp: position });
        logger.debug(`썸네일 저장: ${outputPath}`);
      } catch {
        // 실패 시 다음 썸네일 시도
        continue;
      }
    }

    if (results.length === 0) {
      throw new Yt2PdfError(ErrorCode.VIDEO_DOWNLOAD_FAILED, '썸네일 다운로드 실패');
    }

    logger.info(`[DEV MODE] 썸네일 ${results.length}개 다운로드 완료`);
    return results;
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
  private parseCaptions(
    subtitles?: Record<string, unknown[]>,
    autoCaptions?: Record<string, unknown[]>
  ): CaptionTrack[] {
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

  /**
   * YouTube 챕터 파싱
   * yt-dlp chapters 형식: [{ "title": "...", "start_time": 0, "end_time": 60 }, ...]
   */
  private parseChapters(
    chapters?: Array<{ title?: string; start_time?: number; end_time?: number }>,
    duration?: number
  ): Chapter[] {
    if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
      return [];
    }

    const parsedChapters: Chapter[] = [];

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if (chapter && typeof chapter.start_time === 'number') {
        // end_time이 없으면 다음 챕터의 start_time 또는 영상 끝 사용
        let endTime = chapter.end_time;
        if (typeof endTime !== 'number') {
          if (i + 1 < chapters.length && typeof chapters[i + 1].start_time === 'number') {
            endTime = chapters[i + 1].start_time;
          } else if (typeof duration === 'number') {
            endTime = duration;
          } else {
            endTime = chapter.start_time + 60; // fallback: 60초
          }
        }

        parsedChapters.push({
          title: chapter.title || `챕터 ${i + 1}`,
          startTime: chapter.start_time,
          endTime: endTime ?? chapter.start_time + 60, // 보장된 숫자 값
        });
      }
    }

    logger.debug(`챕터 파싱 완료: ${parsedChapters.length}개`);
    return parsedChapters;
  }
}

// 기본 인스턴스
export const youtubeProvider = new YouTubeProvider();
