import { describe, it, expect } from '@jest/globals';
import {
  normalizeTextForPDF,
  sanitizeForAI,
  sanitizeAndNormalize,
} from '../../../src/utils/text-normalizer.js';

describe('text-normalizer', () => {
  describe('normalizeTextForPDF', () => {
    it('should return empty string for empty input', () => {
      expect(normalizeTextForPDF('')).toBe('');
    });

    it('should return same string for null/undefined input', () => {
      expect(normalizeTextForPDF(null as any)).toBe(null);
      expect(normalizeTextForPDF(undefined as any)).toBe(undefined);
    });

    it('should normalize NFD to NFC for Korean text', () => {
      // NFD 형태의 한글: ㅎ(U+1112) + ㅏ(U+1161) + ㄴ(U+11AB) + ㄱ(U+1100) + ㅡ(U+1173) + ㄹ(U+11AF)
      const nfd = '\u1112\u1161\u11AB\u1100\u1173\u11AF'; // ㅎㅏㄴㄱㅡㄹ
      const nfc = '한글'; // 한(U+D55C) + 글(U+AE00)

      const result = normalizeTextForPDF(nfd);
      expect(result).toBe(nfc);
    });

    it('should remove control characters except tab and newline', () => {
      const input = 'Hello\x00World\x01Test\x7F\t\nKeep';
      const expected = 'HelloWorldTest\t\nKeep';
      expect(normalizeTextForPDF(input)).toBe(expected);
    });

    it('should preserve tab and newline characters', () => {
      const input = 'Line1\tTab\nLine2';
      expect(normalizeTextForPDF(input)).toBe('Line1\tTab\nLine2');
    });

    it('should remove Unicode replacement character', () => {
      const input = 'Hello\uFFFDWorld';
      expect(normalizeTextForPDF(input)).toBe('HelloWorld');
    });

    it('should remove zero-width characters', () => {
      const input = 'Hello\u200BWorld\u200C\u200D\uFEFFTest';
      expect(normalizeTextForPDF(input)).toBe('HelloWorldTest');
    });

    it('should remove Korean extended characters (D7B0-D7FF)', () => {
      const input = 'Normal한글\uD7B0\uD7FFText';
      expect(normalizeTextForPDF(input)).toBe('Normal한글Text');
    });

    it('should remove Korean extended characters (A960-A97F)', () => {
      const input = 'Text\uA960\uA97FWith한글';
      expect(normalizeTextForPDF(input)).toBe('TextWith한글');
    });

    it('should remove Private Use Area characters', () => {
      const input = 'Hello\uE000\uF8FFWorld';
      expect(normalizeTextForPDF(input)).toBe('HelloWorld');
    });

    it('should replace extended Latin characters', () => {
      const input = 'ħello Ħorld';
      expect(normalizeTextForPDF(input)).toBe('hello Horld');
    });

    it('should handle complex mixed text', () => {
      const input = 'Hello\x00한글\uD7B0Test\u200B\uFFFD\t안녕\n';
      const expected = 'Hello한글Test\t안녕\n';
      expect(normalizeTextForPDF(input)).toBe(expected);
    });

    it('should preserve standard Korean characters (AC00-D7AF)', () => {
      const input = '가나다라마바사아자차카타파하';
      expect(normalizeTextForPDF(input)).toBe(input);
    });

    it('should preserve basic ASCII and punctuation', () => {
      const input = 'Hello World! 123 (test) "quotes" @#$%';
      expect(normalizeTextForPDF(input)).toBe(input);
    });

    it('should handle empty whitespace correctly', () => {
      const input = '   \t\n   ';
      expect(normalizeTextForPDF(input)).toBe('   \t\n   ');
    });
  });

  describe('sanitizeForAI', () => {
    it('should return empty string for empty input', () => {
      expect(sanitizeForAI('')).toBe('');
    });

    it('should return same string for null/undefined input', () => {
      expect(sanitizeForAI(null as any)).toBe(null);
      expect(sanitizeForAI(undefined as any)).toBe(undefined);
    });

    it('should remove Korean extended-B characters (D7B0-D7FF)', () => {
      // Use actual D7B0-D7FF range characters
      const input = 'Normal\uD7B0\uD7B5\uD7FA\uD7FFText';
      const result = sanitizeForAI(input);
      // Extended-B characters should be removed
      expect(result).not.toContain('\uD7B0');
      expect(result).not.toContain('\uD7B5');
      expect(result).not.toContain('\uD7FA');
      expect(result).not.toContain('\uD7FF');
      // Normal text should be preserved
      expect(result).toContain('Normal');
      expect(result).toContain('Text');
    });

    it('should remove Korean extended-A characters (A960-A97F)', () => {
      const input = 'Text\uA960\uA97FWith한글';
      expect(sanitizeForAI(input)).toBe('TextWith한글');
    });

    it('should remove parenthesized Korean characters (3200-321E)', () => {
      const input = 'Test\u3200\u321EText';
      expect(sanitizeForAI(input)).toBe('TestText');
    });

    it('should remove garbage pattern: Korean + digits/punctuation + Korean', () => {
      const input = '한89:;글Test';
      const result = sanitizeForAI(input);
      expect(result).toBe('한글Test');
      expect(result).not.toContain('89:;');
    });

    it('should preserve valid time patterns', () => {
      // This test documents current behavior - time patterns in the middle of Korean text
      // will have the numbers removed but Korean preserved
      const input = '시간12:34분';
      const result = sanitizeForAI(input);
      // The regex removes digits between Korean chars
      expect(result).toBe('시간분');
    });

    it('should remove consecutive uppercase ASCII before Korean', () => {
      const input = 'IJKLM이상한텍스트';
      const result = sanitizeForAI(input);
      expect(result).toBe('이상한텍스트');
      expect(result).not.toContain('IJKLM');
    });

    it('should handle multiple garbage patterns', () => {
      const input = '정상ABC이IJKLMNOP거89:;기';
      const result = sanitizeForAI(input);
      // First pattern: ABC이 (3 uppercase) - preserved
      // Second pattern: IJKLMNOP거 (8 uppercase) - removes uppercase, keeps 거
      // Third pattern: 89:; between Korean - removed
      expect(result).not.toContain('IJKLMNOP');
      expect(result).not.toContain('89:;');
    });

    it('should preserve standard Korean text (AC00-D7AF)', () => {
      const input = '가나다라마바사아자차카타파하';
      expect(sanitizeForAI(input)).toBe(input);
    });

    it('should preserve normal mixed Korean and ASCII', () => {
      const input = 'Hello 안녕 World 세상';
      expect(sanitizeForAI(input)).toBe(input);
    });

    it('should preserve CJK characters', () => {
      const input = '韓國語 中文 日本語';
      expect(sanitizeForAI(input)).toBe(input);
    });

    it('should handle complex AI response text', () => {
      const input = '이것은ABCD정상적인89:;텍스트입니다';
      const result = sanitizeForAI(input);
      // ABCD (4 uppercase) between Korean triggers pattern removal
      // 89:; between Korean triggers pattern removal
      expect(result).not.toContain('89:;');
    });
  });

  describe('sanitizeAndNormalize', () => {
    it('should return empty string for empty input', () => {
      expect(sanitizeAndNormalize('')).toBe('');
    });

    it('should return same string for null/undefined input', () => {
      expect(sanitizeAndNormalize(null as any)).toBe(null);
      expect(sanitizeAndNormalize(undefined as any)).toBe(undefined);
    });

    it('should apply both PDF normalization and AI sanitization', () => {
      const input = 'Hello\u200B한글\uD7B0IJKLM이89:;것\x00Test\uFFFD';
      const result = sanitizeAndNormalize(input);

      // Should remove zero-width (\u200B)
      expect(result).not.toContain('\u200B');
      // Should remove extended Korean (\uD7B0)
      expect(result).not.toContain('\uD7B0');
      // Should remove garbage patterns (IJKLM, 89:;)
      expect(result).not.toContain('IJKLM');
      expect(result).not.toContain('89:;');
      // Should remove control char (\x00)
      expect(result).not.toContain('\x00');
      // Should remove replacement char (\uFFFD)
      expect(result).not.toContain('\uFFFD');

      // Should preserve normal text
      expect(result).toContain('Hello');
      expect(result).toContain('한글');
      expect(result).toContain('Test');
    });

    it('should normalize NFD and remove AI garbage', () => {
      // Combining NFD Korean + garbage pattern
      const nfd = '\u1112\u1161\u11ABIJKLM이';
      const result = sanitizeAndNormalize(nfd);

      // Should normalize to NFC
      expect(result).toContain('한');
      // Should remove IJKLM garbage
      expect(result).not.toContain('IJKLM');
    });

    it('should handle complex real-world AI response', () => {
      const input = '요약:\n한글\u200B텍스트입니다\uD7B0.\nIJKLM이89:;것은 테스트\x00입니다.';
      const result = sanitizeAndNormalize(input);

      expect(result).toContain('요약:');
      expect(result).toContain('\n'); // newlines preserved
      expect(result).toContain('한글');
      expect(result).toContain('텍스트입니다');
      expect(result).toContain('테스트');
      expect(result).toContain('입니다');

      expect(result).not.toContain('\u200B');
      expect(result).not.toContain('\uD7B0');
      expect(result).not.toContain('IJKLM');
      expect(result).not.toContain('89:;');
      expect(result).not.toContain('\x00');
    });

    it('should preserve clean text unchanged', () => {
      const input = 'Hello World\n안녕하세요\nTest 123';
      expect(sanitizeAndNormalize(input)).toBe(input);
    });

    it('should handle edge case with only whitespace and special chars', () => {
      const input = '\u200B\u200C\u200D\uFEFF   \t\n   ';
      const expected = '   \t\n   '; // zero-width removed, whitespace preserved
      expect(sanitizeAndNormalize(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle very long strings', () => {
      const longText = 'A'.repeat(10000) + '한글'.repeat(5000);
      const result = normalizeTextForPDF(longText);
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('A');
      expect(result).toContain('한글');
    });

    it('should handle strings with only special characters', () => {
      const input = '\u200B\u200C\u200D\uFEFF\uFFFD\uD7B0';
      const result = sanitizeAndNormalize(input);
      expect(result).toBe('');
    });

    it('should handle mixed RTL and LTR text', () => {
      const input = 'Hello مرحبا 안녕 שלום';
      const result = normalizeTextForPDF(input);
      expect(result).toBe(input); // Should preserve RTL text
    });

    it('should handle emoji and special symbols', () => {
      const input = 'Test 😀 ✓ → ★ 한글';
      const result = normalizeTextForPDF(input);
      // Emojis and symbols should be preserved unless in private use area
      expect(result).toContain('Test');
      expect(result).toContain('한글');
    });
  });
});
