/**
 * 통합 콘텐츠 프로세서 - 번역 + 요약 + 핵심 추출을 1회 API 호출로 처리
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SubtitleSegment } from '../types/index.js';
import { logger } from '../utils/logger.js';

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
  translatedText: string;
}

export interface UnifiedProcessResult {
  sections: Map<number, EnhancedSectionContent>;
  globalSummary: {
    summary: string;
    keyPoints: string[];
  };
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
   * 배치 생성 (토큰 한계 기준)
   */
  createBatches<T extends { rawText: string }>(
    sections: T[],
    maxTokens: number = 80000
  ): T[][] {
    const batches: T[][] = [];
    let currentBatch: T[] = [];
    let currentTokens = 500; // 프롬프트 오버헤드

    for (const section of sections) {
      const sectionTokens = this.estimateTokens(section.rawText);

      if (currentTokens + sectionTokens > maxTokens && currentBatch.length > 0) {
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
    return crypto.createHash('md5')
      .update(JSON.stringify({
        targetLanguage: options.targetLanguage,
        maxKeyPoints: options.maxKeyPoints,
        includeQuotes: options.includeQuotes,
      }))
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * 캐시에서 읽기
   */
  private async readCache(key: string): Promise<UnifiedProcessResult | null> {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`);
      if (!fs.existsSync(filePath)) return null;

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // TTL 확인 (30일)
      if (Date.now() > content.expiresAt) {
        fs.unlinkSync(filePath);
        return null;
      }

      // Map 복원
      content.result.sections = new Map(Object.entries(content.result.sections).map(
        ([k, v]) => [Number(k), v as EnhancedSectionContent]
      ));

      return { ...content.result, fromCache: true };
    } catch {
      return null;
    }
  }

  /**
   * 캐시에 저장
   */
  private async writeCache(key: string, result: UnifiedProcessResult): Promise<void> {
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
    } catch (e) {
      logger.warn('캐시 저장 실패', e as Error);
    }
  }

  /**
   * 통합 프롬프트 생성 - GPT-5.2 최적화
   */
  private buildPrompt(targetLanguage: string, maxKeyPoints: number, includeQuotes: boolean): string {
    const langName = this.getLanguageName(targetLanguage);

    return `Process ALL sections. Output ${langName}.

For EACH section, extract:
1. oneLiner: 1-sentence summary (max 50 chars)
2. keyPoints: ${maxKeyPoints} key points (max 20 words each)
3. translatedText: Clean translation of speaker's words
4. mainInformation:
   - paragraphs: 3 analytical paragraphs (not translation summary)
   - bullets: 6 facts with tags [METRIC/TOOL/TECHNIQUE/DEFINITION/INSIGHT]
${includeQuotes ? `5. notableQuotes: 3 quotes with specific data/numbers (reject vague quotes like "그것이 당신을 방해합니다")` : ''}

Output JSON:
{
  "sections": [
    {
      "index": 0,
      "oneLiner": "...",
      "keyPoints": ["...", "...", "..."],
      "translatedText": "...",
      "mainInformation": {
        "paragraphs": ["...", "...", "..."],
        "bullets": ["[METRIC] ...", "[TOOL] ...", "[TECHNIQUE] ...", "[DEFINITION] ...", "[INSIGHT] ...", "[INSIGHT] ..."]
      }${includeQuotes ? `,
      "notableQuotes": [{"text": "...", "speaker": "발표자"}, {"text": "...", "speaker": "발표자"}, {"text": "...", "speaker": "발표자"}]` : ''}
    }
  ]
}

⚠️ CRITICAL: Process EVERY section provided. Do not skip any section.`;
  }

  /**
   * 언어 이름 변환
   */
  private getLanguageName(code: string): string {
    const map: Record<string, string> = {
      ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
    };
    return map[code] || code;
  }

  /**
   * 단일 배치 처리
   */
  private async processBatch(
    sections: Array<{ timestamp: number; rawText: string }>,
    options: UnifiedProcessOptions
  ): Promise<{ sections: Map<number, EnhancedSectionContent>; tokensUsed: number }> {
    const { targetLanguage, maxKeyPoints = 3, includeQuotes = true } = options;

    const sectionsText = sections.map((s, idx) =>
      `[SECTION ${idx}] (timestamp: ${s.timestamp}s)\n${s.rawText}`
    ).join('\n\n---\n\n');

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
          max_completion_tokens: Math.min(16000, sections.length * 1400),
          response_format: { type: 'json_object' },
        });

        const tokensUsed = response.usage?.total_tokens || 0;
        const content = response.choices[0]?.message?.content || '{}';

        // JSON 파싱
        const parsed = this.parseResponse(content);
        const resultMap = new Map<number, EnhancedSectionContent>();

        for (const item of parsed.sections || []) {
          const original = sections[item.index];
          if (!original) continue;

          resultMap.set(original.timestamp, {
            oneLiner: item.oneLiner || '',
            keyPoints: item.keyPoints || [],
            notableQuotes: item.notableQuotes || [],
            mainInformation: {
              paragraphs: item.mainInformation?.paragraphs || [],
              bullets: item.mainInformation?.bullets || [],
            },
            translatedText: item.translatedText || original.rawText,
          });
        }

        // 누락된 섹션 폴백
        for (const section of sections) {
          if (!resultMap.has(section.timestamp)) {
            resultMap.set(section.timestamp, {
              oneLiner: '',
              keyPoints: [],
              mainInformation: { paragraphs: [], bullets: [] },
              translatedText: section.rawText,
              notableQuotes: [],
            });
          }
        }

        return { sections: resultMap, tokensUsed };
      } catch (e) {
        retries++;
        if (retries >= maxRetries) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries)));
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * JSON 응답 파싱 (복구 로직 포함)
   */
  private parseResponse(raw: string): { sections: Array<{
    index: number;
    oneLiner: string;
    keyPoints: string[];
    mainInformation: { paragraphs: string[]; bullets: string[] };
    translatedText: string;
    notableQuotes: Array<{ text: string; speaker?: string }>;
  }> } {
    // JSON 블록 추출
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) raw = jsonMatch[1];

    // JSON 객체 추출
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) raw = objectMatch[0];

    try {
      return JSON.parse(raw);
    } catch {
      logger.warn('JSON 파싱 실패, 빈 결과 반환');
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
    const prepared = sections.map(s => ({
      timestamp: s.timestamp,
      rawText: s.subtitles.map(seg => seg.text).join(' ').trim(),
    }));

    // 캐시 키 생성
    const contentHash = this.hashContent(prepared.map(p => p.rawText));
    const configHash = this.hashConfig(options);
    const cacheKey = this.generateCacheKey(videoId, contentHash, configHash);

    // 캐시 확인
    if (enableCache) {
      const cached = await this.readCache(cacheKey);
      if (cached) {
        logger.info(`캐시 히트: ${videoId}`);
        return cached;
      }
    }

    // 배치 생성 및 처리
    const batches = this.createBatches(prepared);
    logger.info(`${prepared.length}개 섹션을 ${batches.length}개 배치로 처리`);

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
      await this.writeCache(cacheKey, finalResult);
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
  ): Promise<{ summary: string; keyPoints: string[] }> {
    const langName = this.getLanguageName(targetLanguage);

    const allOneLiners = sectionContents.map(s => s.oneLiner).filter(Boolean);
    const allKeyPoints = sectionContents.flatMap(s => s.keyPoints).filter(Boolean);

    if (allOneLiners.length === 0) {
      return { summary: '', keyPoints: [] };
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `Create a comprehensive summary from section summaries. Output in ${langName}.
Format: {"summary": "3-5 sentence summary", "keyPoints": ["top 5 key points"]}`,
          },
          {
            role: 'user',
            content: `Section summaries:\n${allOneLiners.join('\n')}\n\nKey points:\n${allKeyPoints.join('\n')}`,
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 1000,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.keyPoints || [],
      };
    } catch {
      return { summary: '', keyPoints: [] };
    }
  }
}
