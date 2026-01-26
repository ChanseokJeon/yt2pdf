/**
 * 유효성 검사 유틸리티 테스트
 */

import {
  validateYouTubeUrl,
  validateOutputFormat,
  validatePDFLayout,
  validateImageQuality,
  validateInterval,
  validateLanguageCode,
  validateOutputPath,
  validateCLIOptions,
} from '../../../src/utils/validation';

describe('Validation Utils', () => {
  describe('validateYouTubeUrl', () => {
    it('should accept valid YouTube URL', () => {
      const result = validateYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept short YouTube URL', () => {
      const result = validateYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(result.valid).toBe(true);
    });

    it('should reject undefined URL', () => {
      const result = validateYouTubeUrl(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('URL이 필요');
    });

    it('should reject empty URL', () => {
      const result = validateYouTubeUrl('');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid URL', () => {
      const result = validateYouTubeUrl('https://example.com/video');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('유효하지 않은');
    });
  });

  describe('validateOutputFormat', () => {
    it('should accept valid formats', () => {
      expect(validateOutputFormat('pdf').valid).toBe(true);
      expect(validateOutputFormat('md').valid).toBe(true);
      expect(validateOutputFormat('html').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validateOutputFormat(undefined).valid).toBe(true);
    });

    it('should reject invalid format', () => {
      const result = validateOutputFormat('docx');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('유효하지 않은 출력 형식');
    });
  });

  describe('validatePDFLayout', () => {
    it('should accept valid layouts', () => {
      expect(validatePDFLayout('vertical').valid).toBe(true);
      expect(validatePDFLayout('horizontal').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validatePDFLayout(undefined).valid).toBe(true);
    });

    it('should reject invalid layout', () => {
      const result = validatePDFLayout('grid');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateImageQuality', () => {
    it('should accept valid qualities', () => {
      expect(validateImageQuality('low').valid).toBe(true);
      expect(validateImageQuality('medium').valid).toBe(true);
      expect(validateImageQuality('high').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validateImageQuality(undefined).valid).toBe(true);
    });

    it('should reject invalid quality', () => {
      const result = validateImageQuality('ultra');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateInterval', () => {
    it('should accept valid intervals', () => {
      expect(validateInterval(30).valid).toBe(true);
      expect(validateInterval(60).valid).toBe(true);
      expect(validateInterval('120').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validateInterval(undefined).valid).toBe(true);
    });

    it('should reject interval less than 5', () => {
      const result = validateInterval(3);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('최소 5초');
    });

    it('should reject interval greater than 600', () => {
      const result = validateInterval(1000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('최대 600초');
    });

    it('should reject non-numeric string', () => {
      const result = validateInterval('abc');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('숫자여야');
    });
  });

  describe('validateLanguageCode', () => {
    it('should accept valid language codes', () => {
      expect(validateLanguageCode('ko').valid).toBe(true);
      expect(validateLanguageCode('en').valid).toBe(true);
      expect(validateLanguageCode('ja').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validateLanguageCode(undefined).valid).toBe(true);
    });

    it('should reject invalid language code', () => {
      const result = validateLanguageCode('korean');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateOutputPath', () => {
    it('should accept valid paths', () => {
      expect(validateOutputPath('./output').valid).toBe(true);
      expect(validateOutputPath('/tmp/videos').valid).toBe(true);
    });

    it('should accept undefined (uses default)', () => {
      expect(validateOutputPath(undefined).valid).toBe(true);
    });

    it('should reject paths with invalid characters', () => {
      const result = validateOutputPath('path<>with:invalid');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateCLIOptions', () => {
    it('should validate all options at once', () => {
      const result = validateCLIOptions({
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        format: 'pdf',
        layout: 'vertical',
        quality: 'medium',
        interval: 60,
        lang: 'ko',
        output: './output',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect multiple errors', () => {
      const result = validateCLIOptions({
        url: 'invalid-url',
        format: 'invalid',
        interval: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
