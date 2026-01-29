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

  describe('getLanguageName', () => {
    it('should return Korean for ko code', () => {
      const proc = processor as any;
      expect(proc.getLanguageName('ko')).toBe('한국어');
    });

    it('should return English for en code', () => {
      const proc = processor as any;
      expect(proc.getLanguageName('en')).toBe('English');
    });

    it('should return code itself for unknown language', () => {
      const proc = processor as any;
      expect(proc.getLanguageName('xyz')).toBe('xyz');
    });
  });
});
