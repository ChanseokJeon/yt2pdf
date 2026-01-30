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

  constructor(apiKey?: string, model: string = 'gpt-4o-mini') {
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
   * 통합 프롬프트 생성
   */
  private buildPrompt(targetLanguage: string, maxKeyPoints: number, includeQuotes: boolean): string {
    const langName = this.getLanguageName(targetLanguage);

    return `You are an expert content analyst performing TWO DISTINCT tasks for each video section.

═══════════════════════════════════════════════════════════════
TASK A: TRANSLATION (translatedText field)
═══════════════════════════════════════════════════════════════
Create a clean, readable translation of what the speaker said.
- Preserve narrative flow and speaker's voice
- Remove filler words, false starts, repetitions
- This is for READING the content

═══════════════════════════════════════════════════════════════
TASK B: FACT EXTRACTION (mainInformation field)
═══════════════════════════════════════════════════════════════
Extract STANDALONE FACTS that exist independently of how they were presented.

⚠️ CRITICAL: Do NOT restate or summarize the translation!
⚠️ Extract the UNDERLYING DATA, not "the speaker said..."

EXTRACTION CATEGORIES (tag each bullet):
• [METRIC] - Numbers, statistics, percentages, timelines, quantities
• [TOOL] - Specific tools, platforms, technologies, products mentioned
• [TECHNIQUE] - Methods, processes, workflows, how-to steps
• [DEFINITION] - New terms, concepts, frameworks explained
• [INSIGHT] - Key claims, conclusions, predictions, recommendations

PARAGRAPHS: Provide analytical CONTEXT (why this matters, how it connects)
- NOT a summary of what was said
- IS an explanation of significance or implications

═══════════════════════════════════════════════════════════════
TASK C: NOTABLE QUOTES (notableQuotes field) - REQUIRED
═══════════════════════════════════════════════════════════════
⚠️ MANDATORY: You MUST extract at least 1 quote per section.

Look for these types of statements:
• Specific claims with numbers: "AI가 코드의 99%를 작성합니다"
• Bold assertions: "10배의 차이가 있습니다"
• Memorable phrases that summarize a key point
• Counterintuitive or surprising statements

If the section contains dialogue, extract the most impactful statement.
If no obvious quote exists, extract the most specific factual claim as a quote.

FORMAT: {"text": "원문 그대로", "speaker": "발표자"}

Examples of GOOD quotes:
• "15명으로 4개의 소프트웨어 제품을 운영하고 있습니다"
• "AI를 사용하는 조직과 그렇지 않은 조직의 차이는 90%입니다"
• "코드의 99%가 AI 에이전트에 의해 작성됩니다"

⚠️ FALLBACK RULE: If you cannot find a memorable quote, use the most specific factual statement that contains a number or concrete claim. Example: "15명으로 4개의 소프트웨어 제품을 운영합니다" is acceptable as a quote.

═══════════════════════════════════════════════════════════════
QUALITY EXAMPLES
═══════════════════════════════════════════════════════════════

❌ BAD bullet (translation restatement):
"발표자는 자신의 회사가 15명으로 4개 제품을 운영한다고 말한다"

✓ GOOD bullet (fact extraction):
"[METRIC] 팀 규모: 15명 | 제품 수: 4개 | 성장: 월간 두 자릿수 (6개월 연속)"

❌ BAD paragraph (translation summary):
"발표자는 AI를 활용한 회사 운영의 중요성을 강조하며 개인 경험을 공유했다."

✓ GOOD paragraph (analytical context):
"이 사례는 AI 네이티브 조직이 전통적 엔지니어링 조직 대비 10배 생산성을 달성할 수 있음을 실증한다. 핵심은 코드 작성의 99%를 AI에 위임하고 인간은 검증과 방향 설정에 집중하는 구조다."

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON)
═══════════════════════════════════════════════════════════════
{
  "sections": [
    {
      "index": 0,
      "oneLiner": "핵심 주제 한 문장 (최대 50자) - ${langName}",
      "keyPoints": [
        "핵심 포인트 1 (20단어 이내)",
        "핵심 포인트 2",
        "핵심 포인트 3"
      ],
      "notableQuotes": [{"text": "가장 인상적인 직접 인용문", "speaker": "발표자"}],  // ⚠️ REQUIRED: At least 1 quote per section - MUST appear before mainInformation
      "mainInformation": {
        "paragraphs": [
          "이 섹션의 의미와 맥락을 설명하는 분석적 문단 (번역 요약 아님)"
        ],
        "bullets": [
          "[METRIC] 구체적 수치나 통계",
          "[TECHNIQUE] 언급된 방법론이나 프로세스",
          "[TOOL] 언급된 도구나 기술",
          "[INSIGHT] 핵심 주장이나 결론"
        ]
      },
      "translatedText": "화자가 말한 내용의 깔끔한 번역문..."
    }
  ]
}

═══════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════
1. ALL output in ${langName}
2. Every bullet in mainInformation MUST have a category tag
3. If a category has no extractable facts, skip it (don't force)
4. keyPoints: max ${maxKeyPoints} items, under 20 words each
5. translatedText = for reading | mainInformation = for reference
${includeQuotes ? '6. ⚠️ notableQuotes is MANDATORY - extract at least 1 quote per section, NEVER return empty array' : ''}`;
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
          max_tokens: Math.min(16000, sections.length * 800),
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
        max_tokens: 1000,
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
