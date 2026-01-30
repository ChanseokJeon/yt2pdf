/**
 * AI Provider - OpenAI GPT for Summary and Translation
 */

import OpenAI from 'openai';
import { ErrorCode, Yt2PdfError, SubtitleSegment, VideoType, Chapter, ExecutiveBrief, VideoMetadata } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface SummaryOptions {
  maxLength?: number; // 최대 문자 수
  language?: string; // 요약 언어
  style?: 'brief' | 'detailed'; // 요약 스타일
}

export interface SectionSummaryOptions {
  language?: string;
  maxSummaryLength?: number;
  maxKeyPoints?: number;
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  language: string;
}

export interface TranslationOptions {
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface TranslationResult {
  translatedSegments: SubtitleSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}

export class AIProvider {
  private client: OpenAI;
  private model: string;

  /**
   * AI 응답 텍스트에서 이상한 유니코드 문자 제거
   * - 표준 한글 음절(AC00-D7AF)만 허용
   * - 희귀 한글 확장 문자(걻걼걽걾 등) 제거
   */
  private sanitizeText(text: string): string {
    if (!text) return text;

    // 허용할 문자 범위:
    // - 기본 라틴 문자, 숫자, 공백, 구두점 (0020-007E)
    // - 표준 한글 음절 (AC00-D7AF) - 가~힣
    // - 한글 자모 (1100-11FF, 3130-318F) - ㄱ~ㅎ, ㅏ~ㅣ 등
    // - CJK 통합 한자 (4E00-9FFF) - 가끔 포함될 수 있음
    // - 일반 구두점, 괄호, 따옴표 등
    //
    // 제거할 문자:
    // - 호환 한글 자모 확장 (3200-321E) - 괄호로 둘러싸인 한글
    // - 한글 확장-A (A960-A97F)
    // - 한글 확장-B (D7B0-D7FF) - 걻걼걽걾 같은 이상한 문자들

    const sanitized = text.replace(/[\uD7B0-\uD7FF\uA960-\uA97F\u3200-\u321E]/g, '');

    // 연속된 이상한 패턴 제거 (예: "89:;", "이IJKLM" 같은 깨진 텍스트)
    // ASCII와 한글이 비정상적으로 섞인 패턴 감지
    const cleanedOfGarbage = sanitized
      // 숫자+구두점이 단어 중간에 나타나는 패턴 (예: "89:;")
      .replace(/[\uAC00-\uD7AF][\d:;]+[\uAC00-\uD7AF]/g, (match) => {
        // 의미 있는 패턴(시간 표기 등)이 아니면 한글만 유지
        const hangul = match.replace(/[\d:;]+/g, '');
        return hangul;
      })
      // 연속된 의미 없는 문자 시퀀스 제거
      .replace(/[A-Z]{4,}[가-힣]/g, (match) => {
        // "IJKLM이" 같은 패턴 - 마지막 한글만 유지
        const lastHangul = match.match(/[가-힣]+$/);
        return lastHangul ? lastHangul[0] : '';
      });

    return cleanedOfGarbage;
  }

  constructor(apiKey?: string, model: string = 'gpt-5.2') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Yt2PdfError(
        ErrorCode.API_KEY_MISSING,
        'OpenAI API 키가 필요합니다. OPENAI_API_KEY 환경변수를 설정하세요.'
      );
    }
    this.client = new OpenAI({ apiKey: key });
    this.model = model;
  }

  /**
   * 자막 텍스트를 요약
   */
  async summarize(segments: SubtitleSegment[], options: SummaryOptions = {}): Promise<SummaryResult> {
    const { maxLength = 500, language = 'ko', style = 'brief' } = options;

    // 자막 텍스트 합치기
    const fullText = segments.map((s) => s.text).join(' ');

    if (!fullText.trim()) {
      return {
        summary: '',
        keyPoints: [],
        language,
      };
    }

    const stylePrompt =
      style === 'detailed'
        ? '상세하고 포괄적인 요약을 작성하세요.'
        : '핵심만 간결하게 요약하세요.';

    const languageMap: Record<string, string> = {
      ko: '한국어',
      en: 'English',
      ja: '日本語',
      zh: '中文',
    };

    const targetLang = languageMap[language] || language;

    try {
      logger.debug(`AI 요약 시작: ${segments.length}개 세그먼트, 언어: ${language}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `당신은 영상 콘텐츠 요약 전문가입니다. ${stylePrompt}
응답은 반드시 ${targetLang}로 작성하세요.

응답 형식:
SUMMARY:
[요약 내용]

KEY_POINTS:
- [핵심 포인트 1]
- [핵심 포인트 2]
- [핵심 포인트 3]`,
          },
          {
            role: 'user',
            content: `다음 영상 자막을 ${maxLength}자 이내로 요약하고 주요 포인트를 추출하세요:\n\n${fullText}`,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || '';

      // 응답 파싱
      const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)(?=KEY_POINTS:|$)/i);
      const keyPointsMatch = content.match(/KEY_POINTS:\s*([\s\S]*?)$/i);

      // 이상한 유니코드 문자 제거 적용
      const rawSummary = summaryMatch ? summaryMatch[1].trim() : content.trim();
      const summary = this.sanitizeText(rawSummary);
      const keyPointsText = keyPointsMatch ? keyPointsMatch[1].trim() : '';

      const keyPoints = keyPointsText
        .split('\n')
        .map((line) => this.sanitizeText(line.replace(/^[-•*]\s*/, '').trim()))
        .filter((line) => line.length > 0);

      logger.debug(`AI 요약 완료: ${summary.length}자, ${keyPoints.length}개 핵심 포인트`);

      return {
        summary,
        keyPoints,
        language,
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`AI 요약 실패: ${err.message}`);
      throw new Yt2PdfError(ErrorCode.WHISPER_API_ERROR, `AI 요약 오류: ${err.message}`, err);
    }
  }

  /**
   * 섹션별 요약 생성 (배치 처리)
   */
  async summarizeSections(
    sections: Array<{ timestamp: number; subtitles: SubtitleSegment[] }>,
    options: SectionSummaryOptions = {}
  ): Promise<Array<{ timestamp: number; summary: string; keyPoints: string[] }>> {
    const { language = 'ko', maxSummaryLength = 150, maxKeyPoints = 3 } = options;

    if (sections.length === 0) {
      return [];
    }

    const languageMap: Record<string, string> = {
      ko: '한국어',
      en: 'English',
      ja: '日本語',
      zh: '中文',
    };
    const targetLang = languageMap[language] || language;

    // 섹션 텍스트 준비
    const sectionTexts = sections.map((section, idx) => {
      const text = section.subtitles.map((s) => s.text).join(' ').trim();
      return `[섹션 ${idx}] (${this.formatTimestamp(section.timestamp)})\n${text}`;
    });

    try {
      logger.debug(`섹션별 요약 시작: ${sections.length}개 섹션`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `당신은 영상 콘텐츠 분석 전문가입니다. 각 섹션의 핵심 내용을 ${targetLang}로 요약하세요.

각 섹션에 대해 다음 형식으로 응답하세요:
[섹션 N]
요약: (${maxSummaryLength}자 이내의 핵심 내용)
포인트:
- (핵심 포인트 1)
- (핵심 포인트 2)
${maxKeyPoints > 2 ? '- (핵심 포인트 3)' : ''}

요약은 해당 구간에서 다루는 핵심 주제와 인사이트를 담아야 합니다.
원문이 영어라도 반드시 ${targetLang}로 작성하세요.`,
          },
          {
            role: 'user',
            content: `다음 영상 섹션들을 각각 요약하세요:\n\n${sectionTexts.join('\n\n')}`,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: Math.min(4000, sections.length * 300),
      });

      const content = response.choices[0]?.message?.content || '';

      // 응답 파싱
      const results: Array<{ timestamp: number; summary: string; keyPoints: string[] }> = [];

      for (let i = 0; i < sections.length; i++) {
        const sectionRegex = new RegExp(
          `\\[섹션\\s*${i}\\][\\s\\S]*?요약:\\s*([^\\n]+)[\\s\\S]*?포인트:\\s*([\\s\\S]*?)(?=\\[섹션\\s*${i + 1}\\]|$)`,
          'i'
        );
        const match = content.match(sectionRegex);

        if (match) {
          // 이상한 유니코드 문자 제거 적용
          const summary = this.sanitizeText(match[1].trim());
          const pointsText = match[2].trim();
          const keyPoints = pointsText
            .split('\n')
            .map((line) => this.sanitizeText(line.replace(/^[-•*]\s*/, '').trim()))
            .filter((line) => line.length > 0)
            .slice(0, maxKeyPoints);

          results.push({
            timestamp: sections[i].timestamp,
            summary,
            keyPoints,
          });
        } else {
          // 파싱 실패시 빈 결과
          results.push({
            timestamp: sections[i].timestamp,
            summary: '',
            keyPoints: [],
          });
        }
      }

      logger.debug(`섹션별 요약 완료: ${results.filter((r) => r.summary).length}/${sections.length}개 성공`);

      return results;
    } catch (error) {
      const err = error as Error;
      logger.error(`섹션별 요약 실패: ${err.message}`);
      // 에러 시 빈 결과 반환
      return sections.map((s) => ({
        timestamp: s.timestamp,
        summary: '',
        keyPoints: [],
      }));
    }
  }

  /**
   * 타임스탬프 포맷
   */
  private formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * 자막 번역
   */
  async translate(
    segments: SubtitleSegment[],
    options: TranslationOptions
  ): Promise<TranslationResult> {
    const { sourceLanguage, targetLanguage } = options;

    if (segments.length === 0) {
      return {
        translatedSegments: [],
        sourceLanguage: sourceLanguage || 'unknown',
        targetLanguage,
      };
    }

    const languageMap: Record<string, string> = {
      ko: '한국어',
      en: 'English',
      ja: '日本語',
      zh: '中文',
      es: 'Español',
      fr: 'Français',
      de: 'Deutsch',
    };

    const targetLang = languageMap[targetLanguage] || targetLanguage;
    const sourceLang = sourceLanguage ? languageMap[sourceLanguage] || sourceLanguage : '원본 언어';

    try {
      logger.debug(
        `AI 번역 시작: ${segments.length}개 세그먼트, ${sourceLang} → ${targetLang}`
      );

      // 배치로 번역 (최대 50개씩)
      const batchSize = 50;
      const translatedSegments: SubtitleSegment[] = [];

      for (let i = 0; i < segments.length; i += batchSize) {
        const batch = segments.slice(i, i + batchSize);
        const textsToTranslate = batch.map((s, idx) => `[${idx}] ${s.text}`).join('\n');

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `당신은 전문 번역가입니다. ${sourceLang}에서 ${targetLang}로 자막을 번역하세요.

중요 규칙:
1. 각 줄의 [번호]를 유지하세요
2. 번역 결과는 반드시 ${targetLang}로만 작성하세요 - 원문(영어)을 절대 포함하지 마세요
3. 번역이 어려운 고유명사나 기술 용어도 ${targetLang}로 음역하거나 설명하세요
4. 불확실해도 반드시 ${targetLang}로만 응답하세요

예시:
입력: [0] So I actually don't have one unfortunately
출력: [0] 사실 저는 안타깝게도 하나도 없습니다`,
            },
            {
              role: 'user',
              content: textsToTranslate,
            },
          ],
          temperature: 0.3,
          max_completion_tokens: 4000,
        });

        const content = response.choices[0]?.message?.content || '';
        const lines = content.split('\n').filter((line) => line.trim());

        // 번역된 텍스트 파싱
        const translatedTexts: Map<number, string> = new Map();
        for (const line of lines) {
          const match = line.match(/^\[(\d+)\]\s*(.+)$/);
          if (match) {
            translatedTexts.set(parseInt(match[1], 10), match[2].trim());
          }
        }

        // 세그먼트에 번역 적용 (검증 및 재시도 포함)
        for (let j = 0; j < batch.length; j++) {
          const original = batch[j];
          let translatedText = translatedTexts.get(j);
          if (!translatedText) {
            // 번역 파싱 실패시 원문 유지하되 경고 로그
            translatedText = original.text;
            logger.warn(`번역 파싱 실패, 원문 유지: ${original.text.slice(0, 30)}...`);
          }

          // 번역 검증: 목표 언어가 한국어인 경우 한글 비율 확인
          if (targetLanguage === 'ko' && translatedText) {
            const koreanChars = (translatedText.match(/[\uAC00-\uD7AF]/g) || []).length;
            const totalChars = translatedText.replace(/[\s\d\W]/g, '').length;
            const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;

            // 한글이 50% 미만이면 재시도 (최대 1회)
            if (koreanRatio < 0.5 && totalChars > 5) {
              logger.warn(`번역 품질 낮음 (한글 ${(koreanRatio * 100).toFixed(0)}%), 재시도 중...`);
              try {
                const retryResponse = await this.client.chat.completions.create({
                  model: this.model,
                  messages: [
                    {
                      role: 'system',
                      content: `이전 번역에 영어가 혼합되었습니다. 반드시 100% 한국어로만 번역하세요. 기술 용어도 한글로 음역하거나 설명하세요.`,
                    },
                    {
                      role: 'user',
                      content: `한국어로 번역: ${original.text}`,
                    },
                  ],
                  temperature: 0.2,
                  max_completion_tokens: 500,
                });
                const retryText = retryResponse.choices[0]?.message?.content?.trim();
                if (retryText) {
                  const retryKoreanChars = (retryText.match(/[\uAC00-\uD7AF]/g) || []).length;
                  const retryTotalChars = retryText.replace(/[\s\d\W]/g, '').length;
                  const retryKoreanRatio = retryTotalChars > 0 ? retryKoreanChars / retryTotalChars : 0;

                  // 재시도 결과가 더 나으면 사용, 아니면 번역 불가 표시
                  if (retryKoreanRatio >= 0.5) {
                    translatedText = retryText;
                    logger.debug(`재시도 성공 (한글 ${(retryKoreanRatio * 100).toFixed(0)}%)`);
                  } else {
                    // 재시도도 실패하면 번역 불가 표시 (영어 원문 노출 방지)
                    translatedText = `[번역 불가]`;
                    logger.warn(`재시도 실패, 번역 불가 처리: ${original.text.slice(0, 30)}...`);
                  }
                }
              } catch {
                // 재시도 API 호출 실패 시 번역 불가 표시
                translatedText = `[번역 불가]`;
                logger.warn(`재시도 API 실패, 번역 불가 처리`);
              }
            }
          }

          translatedSegments.push({
            start: original.start,
            end: original.end,
            text: translatedText,
          });
        }
      }

      logger.debug(`AI 번역 완료: ${translatedSegments.length}개 세그먼트`);

      return {
        translatedSegments,
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage,
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`AI 번역 실패: ${err.message}`);
      throw new Yt2PdfError(ErrorCode.WHISPER_API_ERROR, `AI 번역 오류: ${err.message}`, err);
    }
  }

  /**
   * 언어 감지
   */
  async detectLanguage(text: string): Promise<string> {
    if (!text.trim()) {
      return 'unknown';
    }

    try {
      const sampleText = text.slice(0, 500);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              '텍스트의 언어를 감지하세요. ISO 639-1 언어 코드만 반환하세요 (예: ko, en, ja, zh).',
          },
          {
            role: 'user',
            content: sampleText,
          },
        ],
        temperature: 0,
        max_completion_tokens: 10,
      });

      const detectedLang = response.choices[0]?.message?.content?.trim().toLowerCase() || 'unknown';
      logger.debug(`언어 감지 결과: ${detectedLang}`);
      return detectedLang;
    } catch (error) {
      logger.warn('언어 감지 실패, unknown 반환');
      return 'unknown';
    }
  }

  /**
   * 영상 유형 분류
   */
  async classifyVideoType(
    metadata: { title: string; description: string; channel: string },
    subtitleSample: string
  ): Promise<{ type: VideoType; confidence: number }> {
    try {
      logger.debug('영상 유형 분류 시작...');

      const prompt = `다음 YouTube 영상의 유형을 분류하세요.

제목: ${metadata.title}
채널: ${metadata.channel}
설명: ${metadata.description.slice(0, 500)}

자막 샘플:
${subtitleSample.slice(0, 500)}

다음 유형 중 하나로 분류하세요:
- conference_talk: 컨퍼런스/세미나 발표 (기술 발표, 연사가 청중 앞에서 발표)
- tutorial: 튜토리얼/강좌 (단계별 설명, how-to 콘텐츠)
- interview: 인터뷰 (질문-답변 형식, 대담)
- lecture: 강의 (대학 강의, 교육 콘텐츠)
- demo: 제품 데모 (제품 시연, 기능 소개)
- discussion: 토론/패널 (여러 사람이 의견 교환)
- unknown: 분류 불가

응답 형식 (JSON만):
{"type": "유형", "confidence": 0.0~1.0}`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '당신은 YouTube 영상 콘텐츠 분류 전문가입니다. JSON 형식으로만 응답하세요.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_completion_tokens: 100,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';

      // JSON 파싱 시도
      const jsonMatch = content.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validTypes: VideoType[] = ['conference_talk', 'tutorial', 'interview', 'lecture', 'demo', 'discussion', 'unknown'];
        const type = validTypes.includes(parsed.type) ? parsed.type : 'unknown';
        const confidence = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;

        logger.debug(`영상 유형: ${type} (신뢰도: ${confidence})`);
        return { type, confidence };
      }

      return { type: 'unknown', confidence: 0 };
    } catch (error) {
      logger.warn('영상 유형 분류 실패, unknown 반환');
      return { type: 'unknown', confidence: 0 };
    }
  }

  /**
   * 토픽 기반 챕터 자동 생성
   */
  async detectTopicShifts(
    segments: SubtitleSegment[],
    options: { minChapterLength?: number; maxChapters?: number; language?: string } = {}
  ): Promise<Chapter[]> {
    const { minChapterLength = 60, maxChapters = 20, language = 'ko' } = options;

    if (segments.length === 0) {
      return [];
    }

    try {
      logger.debug(`토픽 기반 챕터 생성 시작: ${segments.length}개 세그먼트`);

      // 자막을 시간순으로 그룹화 (30초 단위)
      const timeBlocks: Array<{ startTime: number; text: string }> = [];
      let currentBlock = { startTime: segments[0].start, texts: [segments[0].text] };

      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.start - currentBlock.startTime > 30) {
          timeBlocks.push({ startTime: currentBlock.startTime, text: currentBlock.texts.join(' ') });
          currentBlock = { startTime: seg.start, texts: [seg.text] };
        } else {
          currentBlock.texts.push(seg.text);
        }
      }
      timeBlocks.push({ startTime: currentBlock.startTime, text: currentBlock.texts.join(' ') });

      // 너무 많으면 샘플링
      const sampleBlocks = timeBlocks.length > 40
        ? timeBlocks.filter((_, i) => i % Math.ceil(timeBlocks.length / 40) === 0)
        : timeBlocks;

      const blocksText = sampleBlocks.map((b) =>
        `[${this.formatTimestamp(b.startTime)}] ${b.text.slice(0, 200)}`
      ).join('\n\n');

      const languageMap: Record<string, string> = {
        ko: '한국어',
        en: 'English',
        ja: '日本語',
        zh: '中文',
      };
      const targetLang = languageMap[language] || language;

      const prompt = `다음은 YouTube 영상의 자막입니다. 주제 전환점을 감지하여 챕터를 생성하세요.

자막:
${blocksText}

요구사항:
- 최소 챕터 길이: ${minChapterLength}초
- 최대 챕터 수: ${maxChapters}개
- 챕터 제목은 ${targetLang}로 작성
- 각 챕터는 해당 구간의 핵심 주제를 반영

응답 형식 (JSON 배열만):
[{"title": "챕터 제목", "startTime": 0}, {"title": "다음 챕터", "startTime": 120}, ...]

중요: startTime은 초 단위 숫자입니다.`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '당신은 영상 콘텐츠 분석 전문가입니다. 주제 전환을 감지하여 챕터를 생성합니다. JSON 배열로만 응답하세요.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';

      // JSON 배열 파싱
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('챕터 JSON 파싱 실패');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{ title: string; startTime: number }>;

      // 챕터 생성
      const chapters: Chapter[] = [];
      const lastSegmentEnd = segments[segments.length - 1].end;

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item.startTime !== 'number' || !item.title) continue;

        const endTime = i + 1 < parsed.length
          ? parsed[i + 1].startTime
          : lastSegmentEnd;

        // 최소 길이 확인
        if (endTime - item.startTime >= minChapterLength) {
          chapters.push({
            title: item.title,
            startTime: item.startTime,
            endTime: endTime,
          });
        }
      }

      // 최대 챕터 수 제한
      const limitedChapters = chapters.slice(0, maxChapters);
      logger.debug(`토픽 기반 챕터 생성 완료: ${limitedChapters.length}개`);

      return limitedChapters;
    } catch (error) {
      logger.warn('토픽 기반 챕터 생성 실패', error as Error);
      return [];
    }
  }

  /**
   * Executive Brief 생성
   */
  async generateExecutiveBrief(
    metadata: VideoMetadata,
    chapters: Chapter[],
    segments: SubtitleSegment[],
    options: { language?: string } = {}
  ): Promise<ExecutiveBrief> {
    const { language = 'ko' } = options;

    const languageMap: Record<string, string> = {
      ko: '한국어',
      en: 'English',
      ja: '日本語',
      zh: '中文',
    };
    const targetLang = languageMap[language] || language;

    try {
      logger.debug('Executive Brief 생성 시작...');

      // 전체 자막 텍스트 (요약용)
      const fullText = segments.map((s) => s.text).join(' ');

      // 챕터별 자막 매핑
      const chapterTexts = chapters.map((chapter) => {
        const chapterSegments = segments.filter(
          (s) => s.start >= chapter.startTime && s.start < chapter.endTime
        );
        return {
          title: chapter.title,
          startTime: chapter.startTime,
          text: chapterSegments.map((s) => s.text).join(' '),
        };
      });

      const prompt = `다음 YouTube 영상의 Executive Brief를 작성하세요.

제목: ${metadata.title}
채널: ${metadata.channel}
영상 길이: ${this.formatTimestamp(metadata.duration)}
영상 유형: ${metadata.videoType || 'unknown'}

전체 자막:
${fullText.slice(0, 3000)}

챕터:
${chapterTexts.map((c) => `[${this.formatTimestamp(c.startTime)}] ${c.title}\n${c.text.slice(0, 300)}`).join('\n\n')}

요구사항 (${targetLang}로 작성):
1. summary: 3-5문장의 핵심 요약
2. keyTakeaways: 3-5개의 핵심 포인트 (문장형)
3. chapterSummaries: 각 챕터별 한 줄 요약
4. actionItems: 실행 가능한 항목 (해당되는 경우에만, 없으면 빈 배열)

응답 형식 (JSON만):
{
  "summary": "...",
  "keyTakeaways": ["...", "..."],
  "chapterSummaries": [{"title": "챕터1", "startTime": 0, "summary": "..."}],
  "actionItems": ["...", "..."]
}`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `당신은 비즈니스 콘텐츠 요약 전문가입니다. 영상의 핵심을 간결하게 정리합니다. 반드시 ${targetLang}로 작성하고 JSON 형식으로만 응답하세요.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';

      // JSON 파싱
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON 파싱 실패');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 이상한 유니코드 문자 제거 적용
      const brief: ExecutiveBrief = {
        title: metadata.title,
        metadata: {
          channel: metadata.channel,
          duration: metadata.duration,
          videoType: metadata.videoType || 'unknown',
          uploadDate: metadata.uploadDate,
          videoId: metadata.id,
        },
        summary: this.sanitizeText(parsed.summary || ''),
        keyTakeaways: Array.isArray(parsed.keyTakeaways)
          ? parsed.keyTakeaways.map((t: string) => this.sanitizeText(t))
          : [],
        chapterSummaries: Array.isArray(parsed.chapterSummaries)
          ? parsed.chapterSummaries.map((c: { title?: string; startTime?: number; summary?: string }, i: number) => ({
              title: this.sanitizeText(c.title || chapters[i]?.title || `챕터 ${i + 1}`),
              startTime: c.startTime ?? chapters[i]?.startTime ?? 0,
              summary: this.sanitizeText(c.summary || ''),
            }))
          : [],
        actionItems: Array.isArray(parsed.actionItems) && parsed.actionItems.length > 0
          ? parsed.actionItems.map((a: string) => this.sanitizeText(a))
          : undefined,
      };

      logger.debug('Executive Brief 생성 완료');
      return brief;
    } catch (error) {
      logger.warn('Executive Brief 생성 실패', error as Error);

      // 폴백: 기본 brief 반환
      return {
        title: metadata.title,
        metadata: {
          channel: metadata.channel,
          duration: metadata.duration,
          videoType: metadata.videoType || 'unknown',
          uploadDate: metadata.uploadDate,
          videoId: metadata.id,
        },
        summary: '요약을 생성할 수 없습니다.',
        keyTakeaways: [],
        chapterSummaries: chapters.map((c) => ({
          title: c.title,
          startTime: c.startTime,
          summary: '',
        })),
      };
    }
  }
}
