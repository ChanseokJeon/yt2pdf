/**
 * 통합 콘텐츠 프로세서 - 번역 + 요약 + 핵심 추출을 1회 API 호출로 처리
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SubtitleSegment, CoverMetadata } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getLanguageName } from '../utils/language.js';

export interface KeyPoint {
  text: string;
  category?: 'insight' | 'action' | 'metric' | 'definition';
}

export interface MainInformation {
  paragraphs: string[];
  bullets: string[];
}

export interface NotableQuote {
  text: string;
  speaker?: string;
}

export interface EnhancedSectionContent {
  oneLiner: string;
  keyPoints: string[];
  notableQuotes: NotableQuote[];
  mainInformation: MainInformation;
  translatedText?: string;
}

export interface UnifiedProcessResult {
  sections: Map<number, EnhancedSectionContent>;
  globalSummary: CoverMetadata;
  totalTokensUsed: number;
  fromCache: boolean;
}

export interface UnifiedProcessOptions {
  videoId: string;
  sourceLanguage?: string;
  targetLanguage: string;
  maxKeyPoints?: number;
  includeQuotes?: boolean;
  enableCache?: boolean;
}

export class UnifiedContentProcessor {
  private client: OpenAI;
  private model: string;
  private cacheDir: string;

  constructor(apiKey?: string, model: string = 'gpt-5.2') {
    this.client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
    this.model = model;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.cacheDir = path.join(home, '.cache', 'yt2pdf', 'ai');
  }

  /**
   * 토큰 추정 (한글 1.5배, 영문 0.25배)
   */
  estimateTokens(text: string): number {
    const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
    const otherChars = text.length - koreanChars;
    return Math.ceil(koreanChars * 1.5 + otherChars / 4);
  }

  /**
   * 배치 생성 (토큰 한계 + 섹션 수 기준)
   * - 출력 토큰 제한으로 인해 배치당 최대 섹션 수 제한 필요
   */
  createBatches<T extends { rawText: string }>(
    sections: T[],
    maxTokens: number = 80000,
    maxSectionsPerBatch: number = 5 // 배치당 최대 섹션 수
  ): T[][] {
    const batches: T[][] = [];
    let currentBatch: T[] = [];
    let currentTokens = 500; // 프롬프트 오버헤드

    for (const section of sections) {
      const sectionTokens = this.estimateTokens(section.rawText);

      // 토큰 제한 또는 섹션 수 제한 도달 시 새 배치
      if (
        (currentTokens + sectionTokens > maxTokens || currentBatch.length >= maxSectionsPerBatch) &&
        currentBatch.length > 0
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 500;
      }

      currentBatch.push(section);
      currentTokens += sectionTokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * 캐시 키 생성
   */
  private generateCacheKey(videoId: string, contentHash: string, configHash: string): string {
    return `${videoId}_${contentHash}_${configHash}`;
  }

  /**
   * 콘텐츠 해시 생성
   */
  private hashContent(texts: string[]): string {
    return crypto.createHash('sha256').update(texts.join('|')).digest('hex').substring(0, 16);
  }

  /**
   * 설정 해시 생성
   */
  private hashConfig(options: UnifiedProcessOptions): string {
    return crypto
      .createHash('md5')
      .update(
        JSON.stringify({
          targetLanguage: options.targetLanguage,
          maxKeyPoints: options.maxKeyPoints,
          includeQuotes: options.includeQuotes,
        })
      )
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * 캐시에서 읽기
   */
  private readCache(key: string): UnifiedProcessResult | null {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`);
      if (!fs.existsSync(filePath)) return null;

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
        result: {
          sections: Record<string, EnhancedSectionContent>;
          globalSummary: CoverMetadata;
          totalTokensUsed: number;
        };
        expiresAt: number;
      };

      // TTL 확인 (30일)
      if (Date.now() > content.expiresAt) {
        fs.unlinkSync(filePath);
        return null;
      }

      // Map 복원
      const sections = new Map(
        Object.entries(content.result.sections).map(([k, v]) => [Number(k), v])
      );

      return {
        sections,
        globalSummary: content.result.globalSummary,
        totalTokensUsed: content.result.totalTokensUsed,
        fromCache: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * 캐시에 저장
   */
  private writeCache(key: string, result: UnifiedProcessResult): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const filePath = path.join(this.cacheDir, `${key}.json`);

      // Map을 객체로 변환
      const serializable = {
        result: {
          ...result,
          sections: Object.fromEntries(result.sections),
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30일
      };

      fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2));
    } catch (e: unknown) {
      logger.warn('캐시 저장 실패', e as Error);
    }
  }

  /**
   * 통합 프롬프트 생성 - GPT-5.2 최적화
   */
  private buildPrompt(
    targetLanguage: string,
    maxKeyPoints: number,
    includeQuotes: boolean
  ): string {
    const langName = getLanguageName(targetLanguage);

    return `Process ALL sections. Output ${langName}.

For EACH section, extract:
1. oneLiner: 1-sentence summary (max 50 chars)
2. keyPoints: ${maxKeyPoints} key points (max 20 words each)
3. mainInformation:
   - paragraphs: 3 analytical paragraphs (not translation summary)
   - bullets: 6 facts with tags [METRIC/TOOL/TECHNIQUE/DEFINITION/INSIGHT]
${
  includeQuotes
    ? `4. notableQuotes: 3 quotes about CORE CONTENT only
   ❌ NEVER extract: speaker intro ("저는 마지막 연사"), meta-talk ("이 발표에서는", "제가 할 수 있는 최선은"), transitions ("다음으로"), audience mentions ("여러분")
   ✓ MUST contain: specific numbers/data, key claims, methodology, definitions`
    : ''
}

Output JSON:
{
  "sections": [
    {
      "index": 0,
      "oneLiner": "...",
      "keyPoints": ["...", "...", "..."],
      "mainInformation": {
        "paragraphs": ["...", "...", "..."],
        "bullets": ["[METRIC] ...", "[TOOL] ...", "[TECHNIQUE] ...", "[DEFINITION] ...", "[INSIGHT] ...", "[INSIGHT] ..."]
      }${
        includeQuotes
          ? `,
      "notableQuotes": [{"text": "...", "speaker": "발표자"}, {"text": "...", "speaker": "발표자"}, {"text": "...", "speaker": "발표자"}]`
          : ''
      }
    }
  ]
}

⚠️ CRITICAL: Process EVERY section provided. Do not skip any section.`;
  }

  /**
   * 단일 배치 처리
   */
  private async processBatch(
    sections: Array<{ timestamp: number; rawText: string }>,
    options: UnifiedProcessOptions
  ): Promise<{ sections: Map<number, EnhancedSectionContent>; tokensUsed: number }> {
    const { targetLanguage, maxKeyPoints = 3, includeQuotes = true } = options;

    const sectionsText = sections
      .map((s, idx) => `[SECTION ${idx}] (timestamp: ${s.timestamp}s)\n${s.rawText}`)
      .join('\n\n---\n\n');

    const systemPrompt = this.buildPrompt(targetLanguage, maxKeyPoints, includeQuotes);

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: sectionsText },
          ],
          temperature: 0.3,
          // 섹션당 ~3000토큰 필요 (translatedText 제거로 감소)
          // 배치당 최대 5섹션이므로 최대 15000토큰
          max_completion_tokens: Math.min(15000, sections.length * 3000),
          response_format: { type: 'json_object' },
        });

        const tokensUsed = response.usage?.total_tokens || 0;
        const content = response.choices[0]?.message?.content || '{}';

        // JSON 파싱
        const parsed = this.parseResponse(content);
        const resultMap = new Map<number, EnhancedSectionContent>();

        for (const item of parsed.sections || []) {
          const original = sections[item.index];
          if (!original) {
            logger.warn(`섹션 인덱스 ${item.index} 매핑 실패 (총 ${sections.length}개)`);
            continue;
          }

          resultMap.set(original.timestamp, {
            oneLiner: item.oneLiner || '',
            keyPoints: item.keyPoints || [],
            notableQuotes: item.notableQuotes || [],
            mainInformation: {
              paragraphs: item.mainInformation?.paragraphs || [],
              bullets: item.mainInformation?.bullets || [],
            },
          });
        }

        // 누락된 섹션 폴백
        for (const section of sections) {
          if (!resultMap.has(section.timestamp)) {
            resultMap.set(section.timestamp, {
              oneLiner: '',
              keyPoints: [],
              mainInformation: { paragraphs: [], bullets: [] },
              notableQuotes: [],
            });
          }
        }

        return { sections: resultMap, tokensUsed };
      } catch (e: unknown) {
        retries++;
        if (retries >= maxRetries) throw e;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retries)));
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * JSON 응답 파싱 (복구 로직 포함)
   */
  private parseResponse(raw: string): {
    sections: Array<{
      index: number;
      oneLiner: string;
      keyPoints: string[];
      mainInformation: { paragraphs: string[]; bullets: string[] };
      notableQuotes: Array<{ text: string; speaker?: string }>;
    }>;
  } {
    // JSON 블록 추출
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) raw = jsonMatch[1];

    // JSON 객체 추출
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) raw = objectMatch[0];

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // 디버깅: 응답 구조 확인
      if (!parsed.sections || !Array.isArray(parsed.sections)) {
        logger.warn(`AI 응답에 sections 배열 없음. 키: ${Object.keys(parsed).join(', ')}`);
        // sections가 다른 키에 있는지 확인
        const possibleKeys = ['sections', 'data', 'results', 'items', 'content'];
        for (const key of possibleKeys) {
          const value = parsed[key];
          if (Array.isArray(value)) {
            logger.info(`대체 키 '${key}' 사용: ${value.length}개 항목`);
            return {
              sections: value as Array<{
                index: number;
                oneLiner: string;
                keyPoints: string[];
                mainInformation: { paragraphs: string[]; bullets: string[] };
                notableQuotes: Array<{ text: string; speaker?: string }>;
              }>,
            };
          }
        }
      }
      return {
        sections:
          (parsed.sections as Array<{
            index: number;
            oneLiner: string;
            keyPoints: string[];
            mainInformation: { paragraphs: string[]; bullets: string[] };
            notableQuotes: Array<{ text: string; speaker?: string }>;
          }>) || [],
      };
    } catch (e: unknown) {
      logger.warn(`JSON 파싱 실패: ${(e as Error).message}`);
      logger.debug(`원본 응답 (처음 500자): ${raw.substring(0, 500)}`);
      return { sections: [] };
    }
  }

  /**
   * 메인 처리 함수
   */
  async processAllSections(
    sections: Array<{ timestamp: number; subtitles: SubtitleSegment[] }>,
    options: UnifiedProcessOptions
  ): Promise<UnifiedProcessResult> {
    const { videoId, enableCache = true } = options;

    // 섹션 준비
    const prepared = sections.map((s) => ({
      timestamp: s.timestamp,
      rawText: s.subtitles
        .map((seg) => seg.text)
        .join(' ')
        .trim(),
    }));

    // 캐시 키 생성
    const contentHash = this.hashContent(prepared.map((p) => p.rawText));
    const configHash = this.hashConfig(options);
    const cacheKey = this.generateCacheKey(videoId, contentHash, configHash);

    // 캐시 확인
    if (enableCache) {
      const cached = this.readCache(cacheKey);
      if (cached) {
        logger.info(`캐시 히트: ${videoId}`);
        return cached;
      }
    }

    // 배치 생성 및 처리
    const batches = this.createBatches(prepared);
    logger.info(`${prepared.length}개 섹션을 ${batches.length}개 배치로 처리 (배치당 최대 5개)`);
    if (batches.length > 1) {
      logger.debug(`배치 구성: ${batches.map((b, i) => `[${i + 1}] ${b.length}개`).join(', ')}`);
    }

    const allSections = new Map<number, EnhancedSectionContent>();
    let totalTokens = 0;

    for (const batch of batches) {
      const result = await this.processBatch(batch, options);
      for (const [ts, content] of result.sections) {
        allSections.set(ts, content);
      }
      totalTokens += result.tokensUsed;
    }

    // 전체 요약 생성
    const globalSummary = await this.generateGlobalSummary(
      Array.from(allSections.values()),
      options.targetLanguage
    );

    const finalResult: UnifiedProcessResult = {
      sections: allSections,
      globalSummary,
      totalTokensUsed: totalTokens,
      fromCache: false,
    };

    // 캐시 저장
    if (enableCache) {
      this.writeCache(cacheKey, finalResult);
    }

    logger.info(`AI 처리 완료: ${totalTokens} 토큰 사용`);
    return finalResult;
  }

  /**
   * 전체 요약 생성 (섹션 요약들을 종합)
   */
  private async generateGlobalSummary(
    sectionContents: EnhancedSectionContent[],
    targetLanguage: string
  ): Promise<CoverMetadata> {
    const langName = getLanguageName(targetLanguage);

    const allOneLiners = sectionContents.map((s) => s.oneLiner).filter(Boolean);
    const allKeyPoints = sectionContents.flatMap((s) => s.keyPoints).filter(Boolean);
    const allParagraphs = sectionContents
      .flatMap((s) => s.mainInformation?.paragraphs || [])
      .filter(Boolean);

    if (allOneLiners.length === 0) {
      return {
        summary: '',
        keyPoints: [],
        language: targetLanguage,
      };
    }

    // 총 단어 수 계산 (estimatedReadTime 산출용)
    const totalWords = allParagraphs.join(' ').split(/\s+/).length;
    const estimatedReadTime = Math.ceil(totalWords / 200); // 분당 200단어 가정

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `Create comprehensive summary. Output in ${langName}.

Output JSON:
{
  "summary": "3-5 sentence summary",
  "keyPoints": ["SHORT_TITLE: detailed description", ...],
  "targetAudience": "쉼표로 구분된 대상 독자 (e.g., 개발자, 테크 리드, PM)",
  "difficulty": "beginner|intermediate|advanced",
  "keywords": ["키워드1", "키워드2", ...] (5-10개),
  "prerequisites": ["사전지식1", ...] (0-3개, 없으면 빈 배열),
  "recommendedFor": ["추천대상1", "추천대상2", ...] (2-4개),
  "benefits": ["얻을 수 있는 것1", "얻을 수 있는 것2", ...] (3-5개)
}

Each keyPoint MUST follow the format: "SHORT_TITLE: description"
- SHORT_TITLE should be 2-5 words, punchy and memorable (like a headline)
- Examples: "10배 격차: AI를 100% 도입하면...", "코드 비용 절감: AI로 코드 작성 비용이..."`,
          },
          {
            role: 'user',
            content: `Section summaries:\n${allOneLiners.join('\n')}\n\nKey points:\n${allKeyPoints.join('\n')}`,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}') as {
        summary?: string;
        keyPoints?: string[];
        targetAudience?: string;
        difficulty?: string;
        keywords?: string[];
        prerequisites?: string[];
        recommendedFor?: string[];
        benefits?: string[];
      };
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.keyPoints || [],
        language: targetLanguage,
        targetAudience: parsed.targetAudience,
        difficulty:
          parsed.difficulty === 'beginner' ||
          parsed.difficulty === 'intermediate' ||
          parsed.difficulty === 'advanced'
            ? parsed.difficulty
            : undefined,
        keywords: parsed.keywords || undefined,
        prerequisites: parsed.prerequisites || undefined,
        recommendedFor: parsed.recommendedFor || undefined,
        benefits: parsed.benefits || undefined,
        estimatedReadTime,
      };
    } catch (e: unknown) {
      logger.warn('전체 요약 생성 실패', e as Error);
      return {
        summary: '',
        keyPoints: [],
        language: targetLanguage,
        estimatedReadTime,
      };
    }
  }
}
