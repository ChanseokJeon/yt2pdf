/**
 * 자막 추출기
 */

import { SubtitleResult, ErrorCode, Yt2PdfError } from '../types/index.js';
import { SubtitleConfig } from '../types/config.js';
import { YouTubeProvider } from '../providers/youtube.js';
import { WhisperProvider } from '../providers/whisper.js';
import { CacheManager } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

export interface SubtitleExtractorOptions {
  youtube: YouTubeProvider;
  whisper?: WhisperProvider;
  config: SubtitleConfig;
  cache?: CacheManager;
}

export class SubtitleExtractor {
  private youtube: YouTubeProvider;
  private whisper?: WhisperProvider;
  private config: SubtitleConfig;
  private cache?: CacheManager;

  constructor(options: SubtitleExtractorOptions) {
    this.youtube = options.youtube;
    this.whisper = options.whisper;
    this.config = options.config;
    this.cache = options.cache;
  }

  /**
   * 자막 추출
   * @param videoId YouTube 비디오 ID
   * @param audioPath 오디오 파일 경로 (Whisper 폴백용)
   */
  async extract(videoId: string, audioPath?: string): Promise<SubtitleResult> {
    const cacheKey = `subtitle:${videoId}:${this.config.languages.join(',')}`;

    // 캐시 확인
    if (this.cache) {
      const cached = await this.cache.get<SubtitleResult>(cacheKey);
      if (cached) {
        logger.debug('자막 캐시 히트');
        return cached;
      }
    }

    // YouTube 자막 시도
    for (const lang of this.config.languages) {
      try {
        logger.debug(`YouTube 자막 시도: ${lang}`);
        const segments = await this.youtube.getCaptions(videoId, lang);

        if (segments.length > 0) {
          const result: SubtitleResult = {
            source: 'youtube',
            language: lang,
            segments,
          };

          // 캐시 저장
          await this.cache?.set(cacheKey, result);
          logger.success(`YouTube 자막 추출 완료: ${lang}`);
          return result;
        }
      } catch (e) {
        logger.debug(`YouTube 자막 실패 (${lang}): ${(e as Error).message}`);
      }
    }

    // Whisper 폴백
    if (this.whisper && audioPath) {
      logger.info('YouTube 자막 없음, Whisper 변환 시작...');

      try {
        const whisperResult = await this.whisper.transcribe(audioPath, {
          language: this.config.languages[0],
        });

        const result: SubtitleResult = {
          source: 'whisper',
          language: whisperResult.language,
          segments: whisperResult.segments,
        };

        // 캐시 저장
        await this.cache?.set(cacheKey, result);
        logger.success('Whisper 변환 완료');
        return result;
      } catch (e) {
        throw new Yt2PdfError(
          ErrorCode.WHISPER_API_ERROR,
          `Whisper 변환 실패: ${(e as Error).message}`
        );
      }
    }

    // 둘 다 실패
    throw new Yt2PdfError(
      ErrorCode.NO_CAPTIONS_AVAILABLE,
      '사용 가능한 자막이 없습니다. Whisper를 사용하려면 OPENAI_API_KEY를 설정하세요.'
    );
  }

  /**
   * 사용 가능한 자막 언어 목록 조회
   */
  async getAvailableLanguages(videoId: string): Promise<string[]> {
    // YouTube에서 직접 메타데이터로 확인
    // (현재는 간단하게 구현)
    const languages: string[] = [];

    for (const lang of this.config.languages) {
      try {
        const segments = await this.youtube.getCaptions(videoId, lang);
        if (segments.length > 0) {
          languages.push(lang);
        }
      } catch {
        // 무시
      }
    }

    return languages;
  }
}
