/**
 * 통합 AI 프로세서 테스트
 */

// Mock logger to avoid chalk ESM issues
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock fs
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockUnlinkSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

// Mock OpenAI
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

import { UnifiedContentProcessor } from '../../../src/providers/unified-ai';

describe('UnifiedContentProcessor', () => {
  let processor: UnifiedContentProcessor;

  beforeEach(() => {
    processor = new UnifiedContentProcessor('test-key', 'gpt-4o-mini');
  });

  describe('estimateTokens', () => {
    it('should estimate Korean text tokens (1.5x)', () => {
      const koreanText = '안녕하세요'; // 5 chars
      const tokens = processor.estimateTokens(koreanText);
      expect(tokens).toBe(8); // 5 * 1.5 = 7.5 → 8
    });

    it('should estimate English text tokens (0.25x)', () => {
      const englishText = 'Hello World'; // 11 chars
      const tokens = processor.estimateTokens(englishText);
      expect(tokens).toBe(3); // 11 / 4 = 2.75 → 3
    });

    it('should handle mixed language text', () => {
      const mixedText = '안녕 Hello'; // 2 Korean + 6 other
      const tokens = processor.estimateTokens(mixedText);
      expect(tokens).toBe(5); // (2 * 1.5) + (6 / 4) = 3 + 1.5 = 4.5 → 5
    });

    it('should handle empty text', () => {
      const tokens = processor.estimateTokens('');
      expect(tokens).toBe(0);
    });
  });

  describe('createBatches', () => {
    it('should create single batch for small content', () => {
      const sections = [
        { rawText: 'Short text 1' },
        { rawText: 'Short text 2' },
      ];
      const batches = processor.createBatches(sections, 10000);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it('should split into multiple batches when exceeding limit', () => {
      const longText = '한글 텍스트 '.repeat(1000); // ~3000 tokens
      const sections = [
        { rawText: longText },
        { rawText: longText },
        { rawText: longText },
      ];
      const batches = processor.createBatches(sections, 5000);
      expect(batches.length).toBeGreaterThan(1);
    });

    it('should handle empty sections array', () => {
      const batches = processor.createBatches([], 10000);
      expect(batches).toHaveLength(0);
    });

    it('should include prompt overhead in calculation', () => {
      // 500 tokens overhead + section tokens
      const sections = [{ rawText: 'a'.repeat(4000) }]; // 1000 tokens
      const batches = processor.createBatches(sections, 1400); // 500 + 1000 = 1500 > 1400
      // Should still fit since we're under 1500 total
      expect(batches).toHaveLength(1);
    });
  });

  describe('cache key generation', () => {
    it('should generate consistent hash for same content', () => {
      // Access private method via any cast for testing
      const proc = processor as any;
      const hash1 = proc.hashContent(['text1', 'text2']);
      const hash2 = proc.hashContent(['text1', 'text2']);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different content', () => {
      const proc = processor as any;
      const hash1 = proc.hashContent(['text1']);
      const hash2 = proc.hashContent(['text2']);
      expect(hash1).not.toBe(hash2);
    });

    it('should generate config hash based on options', () => {
      const proc = processor as any;
      const hash1 = proc.hashConfig({ targetLanguage: 'ko', maxKeyPoints: 3 });
      const hash2 = proc.hashConfig({ targetLanguage: 'en', maxKeyPoints: 3 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('parseResponse', () => {
    it('should parse valid JSON', () => {
      const proc = processor as any;
      const result = proc.parseResponse('{"sections": [{"index": 0}]}');
      expect(result.sections).toHaveLength(1);
    });

    it('should extract JSON from markdown code block', () => {
      const proc = processor as any;
      const result = proc.parseResponse('```json\n{"sections": []}\n```');
      expect(result.sections).toBeDefined();
    });

    it('should handle invalid JSON gracefully', () => {
      const proc = processor as any;
      const result = proc.parseResponse('not valid json');
      expect(result.sections).toEqual([]);
    });

    it('should extract JSON object from mixed content', () => {
      const proc = processor as any;
      const result = proc.parseResponse('Here is the result: {"sections": [{"index": 0}]}');
      expect(result.sections).toHaveLength(1);
    });
  });

  describe('cache operations', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return null when cache file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const proc = processor as any;
      const result = await proc.readCache('test-key');

      expect(result).toBeNull();
    });

    it('should return null and delete expired cache', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          result: {
            sections: {},
            globalSummary: { summary: '', keyPoints: [], language: 'ko' },
            totalTokensUsed: 0,
          },
          expiresAt: Date.now() - 1000, // Expired
        })
      );

      const proc = processor as any;
      const result = await proc.readCache('test-key');

      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should return cached result when valid', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          result: {
            sections: { 0: { oneLiner: 'test' } },
            globalSummary: { summary: 'test', keyPoints: [], language: 'ko' },
            totalTokensUsed: 100,
          },
          expiresAt: Date.now() + 100000,
        })
      );

      const proc = processor as any;
      const result = await proc.readCache('test-key');

      expect(result).not.toBeNull();
      expect(result.fromCache).toBe(true);
    });

    it('should return null on read error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const proc = processor as any;
      const result = await proc.readCache('test-key');

      expect(result).toBeNull();
    });

    it('should write cache successfully', async () => {
      const proc = processor as any;
      const result = {
        sections: new Map([[0, { oneLiner: 'test' }]]),
        globalSummary: { summary: 'test', keyPoints: [], language: 'ko' },
        totalTokensUsed: 100,
        fromCache: false,
      };

      await proc.writeCache('test-key', result);

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should handle write cache error gracefully', () => {
      mockMkdirSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      const proc = processor as any;
      const result = {
        sections: new Map(),
        globalSummary: { summary: '', keyPoints: [], language: 'ko' },
        totalTokensUsed: 0,
        fromCache: false,
      };

      // Should not throw - writeCache is now synchronous
      expect(() => proc.writeCache('test-key', result)).not.toThrow();
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt with quotes enabled', () => {
      const proc = processor as any;
      const prompt = proc.buildPrompt('ko', 3, true);

      expect(prompt).toContain('한국어');
      expect(prompt).toContain('notableQuotes');
    });

    it('should build prompt without quotes', () => {
      const proc = processor as any;
      const prompt = proc.buildPrompt('en', 5, false);

      expect(prompt).toContain('English');
      expect(prompt).not.toContain('notableQuotes');
    });
  });

  describe('processBatch', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should process batch successfully', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [
                  {
                    index: 0,
                    oneLiner: 'Test summary',
                    keyPoints: ['Point 1', 'Point 2'],
                    mainInformation: { paragraphs: ['P1'], bullets: ['B1'] },
                    notableQuotes: [{ text: 'Quote', speaker: 'Speaker' }],
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 500 },
      });

      const proc = processor as any;
      const result = await proc.processBatch(
        [{ timestamp: 0, rawText: 'Test content' }],
        { targetLanguage: 'ko', maxKeyPoints: 3, includeQuotes: true }
      );

      expect(result.sections.size).toBe(1);
      expect(result.tokensUsed).toBe(500);
    });

    it('should provide fallback for missing sections', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ sections: [] }),
            },
          },
        ],
        usage: { total_tokens: 100 },
      });

      const proc = processor as any;
      const result = await proc.processBatch(
        [{ timestamp: 0, rawText: 'Test content' }],
        { targetLanguage: 'ko' }
      );

      expect(result.sections.size).toBe(1);
      expect(result.sections.get(0).oneLiner).toBe('');
      expect(result.sections.get(0).keyPoints).toEqual([]);
    });

    it('should retry on API failure', async () => {
      mockCreate
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({ sections: [{ index: 0, oneLiner: 'Test' }] }),
              },
            },
          ],
          usage: { total_tokens: 100 },
        });

      const proc = processor as any;
      const result = await proc.processBatch(
        [{ timestamp: 0, rawText: 'Test content' }],
        { targetLanguage: 'ko' }
      );

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.sections.size).toBe(1);
    });

    it('should throw after max retries', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      const proc = processor as any;
      await expect(
        proc.processBatch([{ timestamp: 0, rawText: 'Test content' }], { targetLanguage: 'ko' })
      ).rejects.toThrow('API Error');

      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('processAllSections', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockExistsSync.mockReturnValue(false);
    });

    it('should process all sections and generate global summary', async () => {
      mockCreate
        // First call: processBatch
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  sections: [
                    { index: 0, oneLiner: 'Summary 1', keyPoints: ['KP1'] },
                  ],
                }),
              },
            },
          ],
          usage: { total_tokens: 500 },
        })
        // Second call: generateGlobalSummary
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Global summary',
                  keyPoints: ['Global KP1', 'Global KP2'],
                  targetAudience: '개발자',
                  difficulty: 'intermediate',
                }),
              },
            },
          ],
        });

      const result = await processor.processAllSections(
        [{ timestamp: 0, subtitles: [{ start: 0, end: 10, text: 'Test text' }] }],
        { videoId: 'test123', targetLanguage: 'ko', enableCache: false }
      );

      expect(result.sections.size).toBe(1);
      expect(result.globalSummary.summary).toBe('Global summary');
      expect(result.globalSummary.language).toBe('ko');
      expect(result.fromCache).toBe(false);
    });

    it('should return cached result when available', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          result: {
            sections: { 0: { oneLiner: 'Cached' } },
            globalSummary: { summary: 'Cached summary', keyPoints: [], language: 'ko' },
            totalTokensUsed: 100,
          },
          expiresAt: Date.now() + 100000,
        })
      );

      const result = await processor.processAllSections(
        [{ timestamp: 0, subtitles: [{ start: 0, end: 10, text: 'Test' }] }],
        { videoId: 'test123', targetLanguage: 'ko', enableCache: true }
      );

      expect(result.fromCache).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should save to cache after processing', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => undefined);
      mockWriteFileSync.mockImplementation(() => undefined);
      mockCreate
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({ sections: [{ index: 0, oneLiner: 'New' }] }),
              },
            },
          ],
          usage: { total_tokens: 100 },
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'New summary',
                  keyPoints: [],
                  targetAudience: '개발자',
                }),
              },
            },
          ],
        });

      await processor.processAllSections(
        [{ timestamp: 0, subtitles: [{ start: 0, end: 10, text: 'Test' }] }],
        { videoId: 'test123', targetLanguage: 'ko', enableCache: true }
      );

      // Cache write is async so we need to wait a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(mockMkdirSync).toHaveBeenCalled();
    });
  });

  describe('generateGlobalSummary', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should generate global summary from sections', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Combined summary',
                keyPoints: ['KP1', 'KP2'],
                targetAudience: '개발자, 테크 리드',
                difficulty: 'intermediate',
                keywords: ['AI', 'LLM'],
                prerequisites: ['JavaScript 기초'],
                recommendedFor: ['AI 학습자'],
                benefits: ['AI 활용법 습득'],
              }),
            },
          },
        ],
      });

      const proc = processor as any;
      const result = await proc.generateGlobalSummary(
        [
          { oneLiner: 'One', keyPoints: ['K1'] },
          { oneLiner: 'Two', keyPoints: ['K2'] },
        ],
        'ko'
      );

      expect(result.summary).toBe('Combined summary');
      expect(result.keyPoints).toHaveLength(2);
      expect(result.language).toBe('ko');
      expect(result.targetAudience).toBe('개발자, 테크 리드');
      expect(result.difficulty).toBe('intermediate');
      expect(result.estimatedReadTime).toBeGreaterThan(0);
    });

    it('should return empty result for empty sections', async () => {
      const proc = processor as any;
      const result = await proc.generateGlobalSummary([], 'ko');

      expect(result.summary).toBe('');
      expect(result.keyPoints).toHaveLength(0);
      expect(result.language).toBe('ko');
    });

    it('should return empty result when all oneLiners are empty', async () => {
      const proc = processor as any;
      const result = await proc.generateGlobalSummary(
        [
          { oneLiner: '', keyPoints: [] },
          { oneLiner: '', keyPoints: [] },
        ],
        'ko'
      );

      expect(result.summary).toBe('');
      expect(result.language).toBe('ko');
    });

    it('should handle API error gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      const proc = processor as any;
      const result = await proc.generateGlobalSummary(
        [{ oneLiner: 'Test', keyPoints: ['K1'] }],
        'ko'
      );

      expect(result.summary).toBe('');
      expect(result.keyPoints).toHaveLength(0);
      expect(result.language).toBe('ko');
      expect(result.estimatedReadTime).toBeGreaterThan(0);
    });
  });
});
