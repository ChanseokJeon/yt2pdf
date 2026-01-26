/**
 * 텍스트 유틸리티 테스트
 */

import { decodeHtmlEntities, deduplicateSubtitles, cleanSubtitleText } from '../../../src/utils/text';

describe('Text Utils', () => {
  describe('decodeHtmlEntities', () => {
    it('should decode common HTML entities', () => {
      expect(decodeHtmlEntities('&amp;')).toBe('&');
      expect(decodeHtmlEntities('&lt;')).toBe('<');
      expect(decodeHtmlEntities('&gt;')).toBe('>');
      expect(decodeHtmlEntities('&quot;')).toBe('"');
      expect(decodeHtmlEntities('&#39;')).toBe("'");
      expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
    });

    it('should decode numeric entities (decimal)', () => {
      expect(decodeHtmlEntities('&#65;')).toBe('A');
      expect(decodeHtmlEntities('&#97;')).toBe('a');
      // &#8221; is the RIGHT DOUBLE QUOTATION MARK (")
      expect(decodeHtmlEntities('&#8221;')).toBe('\u201D');
    });

    it('should decode numeric entities (hex)', () => {
      expect(decodeHtmlEntities('&#x41;')).toBe('A');
      expect(decodeHtmlEntities('&#x61;')).toBe('a');
    });

    it('should handle multiple entities in a string', () => {
      expect(decodeHtmlEntities('Hello &amp; World &gt;&gt; Test')).toBe('Hello & World >> Test');
    });

    it('should handle text without entities', () => {
      expect(decodeHtmlEntities('Hello World')).toBe('Hello World');
    });
  });

  describe('deduplicateSubtitles', () => {
    it('should remove consecutive duplicate lines', () => {
      const input = ['Hello', 'Hello', 'Hello', 'World'];
      const result = deduplicateSubtitles(input);
      expect(result).toEqual(['Hello', 'World']);
    });

    it('should handle progressive subtitles', () => {
      const input = ['Hello', 'Hello World', 'Hello World!'];
      const result = deduplicateSubtitles(input);
      // 이전 것이 현재의 접두사면 교체
      expect(result).toEqual(['Hello World!']);
    });

    it('should keep non-duplicate lines', () => {
      const input = ['First line', 'Second line', 'Third line'];
      const result = deduplicateSubtitles(input);
      expect(result).toEqual(['First line', 'Second line', 'Third line']);
    });

    it('should handle empty array', () => {
      expect(deduplicateSubtitles([])).toEqual([]);
    });

    it('should skip empty strings', () => {
      const input = ['Hello', '', '   ', 'World'];
      const result = deduplicateSubtitles(input);
      expect(result).toEqual(['Hello', 'World']);
    });

    it('should skip shorter prefix when current is longer', () => {
      const input = ['I am', 'I am the', 'I am the last speaker'];
      const result = deduplicateSubtitles(input);
      expect(result).toEqual(['I am the last speaker']);
    });
  });

  describe('cleanSubtitleText', () => {
    it('should decode HTML entities and clean text', () => {
      expect(cleanSubtitleText('Hello &gt;&gt; World')).toBe('Hello >> World');
    });

    it('should remove VTT tags', () => {
      // VTT tags like <v>...</v> are removed, content inside is preserved
      expect(cleanSubtitleText('<v>Hello</v>')).toBe('Hello');
      expect(cleanSubtitleText('<c.yellow>Text</c>')).toBe('Text');
    });

    it('should collapse multiple spaces', () => {
      expect(cleanSubtitleText('Hello    World')).toBe('Hello World');
    });

    it('should trim whitespace', () => {
      expect(cleanSubtitleText('  Hello World  ')).toBe('Hello World');
    });

    it('should handle complex input', () => {
      const input = '  <v>Hello &amp; World</v>   &gt;&gt;  ';
      expect(cleanSubtitleText(input)).toBe('Hello & World >>');
    });
  });
});
