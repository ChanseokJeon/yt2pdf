/**
 * Whisper Provider - OpenAI Whisper API
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import { SubtitleSegment, ErrorCode, Yt2PdfError } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface WhisperOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
}

export interface WhisperResult {
  text: string;
  segments: SubtitleSegment[];
  language: string;
  duration: number;
}

export class WhisperProvider {
  private client: OpenAI;
  private static COST_PER_MINUTE = 0.006; // USD

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Yt2PdfError(ErrorCode.API_KEY_MISSING, 'OpenAI API 키가 필요합니다. OPENAI_API_KEY 환경변수를 설정하세요.');
    }
    this.client = new OpenAI({ apiKey: key });
  }

  /**
   * 음성을 텍스트로 변환
   */
  async transcribe(audioPath: string, options?: WhisperOptions): Promise<WhisperResult> {
    try {
      logger.debug(`Whisper 변환 시작: ${audioPath}`);

      const audioFile = fs.createReadStream(audioPath);

      const response = await this.client.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: options?.language,
        prompt: options?.prompt,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      // OpenAI API 응답 타입 처리
      const typedResponse = response as unknown as {
        text: string;
        language: string;
        duration: number;
        segments?: Array<{
          start: number;
          end: number;
          text: string;
        }>;
      };

      const segments: SubtitleSegment[] = (typedResponse.segments || []).map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
      }));

      logger.debug(`Whisper 변환 완료: ${segments.length}개 세그먼트`);

      return {
        text: typedResponse.text,
        language: typedResponse.language || options?.language || 'unknown',
        duration: typedResponse.duration || 0,
        segments,
      };
    } catch (error) {
      const err = error as Error;
      throw new Yt2PdfError(ErrorCode.WHISPER_API_ERROR, `Whisper API 오류: ${err.message}`, err);
    }
  }

  /**
   * 비용 추정
   */
  static estimateCost(durationSeconds: number): number {
    const minutes = Math.ceil(durationSeconds / 60);
    return minutes * this.COST_PER_MINUTE;
  }

  /**
   * 비용 포맷
   */
  static formatCost(cost: number): string {
    return `$${cost.toFixed(3)}`;
  }
}
