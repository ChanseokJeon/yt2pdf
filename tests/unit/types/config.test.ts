/**
 * Config 스키마 테스트
 */

import {
  SummaryConfigSchema,
  TranslationConfigSchema,
  AIConfigSchema,
  ConfigSchema,
} from '../../../src/types/config';

describe('Config Schemas', () => {
  describe('SummaryConfigSchema', () => {
    it('should have correct defaults', () => {
      const result = SummaryConfigSchema.parse({});

      expect(result.enabled).toBe(false);
      expect(result.maxLength).toBe(500);
      expect(result.style).toBe('brief');
      expect(result.language).toBeUndefined();
      expect(result.perSection).toBe(true);
      expect(result.sectionMaxLength).toBe(150);
      expect(result.sectionKeyPoints).toBe(3);
    });

    it('should validate enabled option', () => {
      const result = SummaryConfigSchema.parse({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('should validate maxLength within range', () => {
      expect(() => SummaryConfigSchema.parse({ maxLength: 50 })).toThrow();
      expect(() => SummaryConfigSchema.parse({ maxLength: 3000 })).toThrow();

      const result = SummaryConfigSchema.parse({ maxLength: 1000 });
      expect(result.maxLength).toBe(1000);
    });

    it('should validate style option', () => {
      const brief = SummaryConfigSchema.parse({ style: 'brief' });
      expect(brief.style).toBe('brief');

      const detailed = SummaryConfigSchema.parse({ style: 'detailed' });
      expect(detailed.style).toBe('detailed');

      expect(() => SummaryConfigSchema.parse({ style: 'invalid' })).toThrow();
    });

    it('should accept language option', () => {
      const result = SummaryConfigSchema.parse({ language: 'en' });
      expect(result.language).toBe('en');
    });

    it('should validate perSection option', () => {
      const enabled = SummaryConfigSchema.parse({ perSection: true });
      expect(enabled.perSection).toBe(true);

      const disabled = SummaryConfigSchema.parse({ perSection: false });
      expect(disabled.perSection).toBe(false);
    });

    it('should validate sectionMaxLength within range', () => {
      expect(() => SummaryConfigSchema.parse({ sectionMaxLength: 30 })).toThrow();
      expect(() => SummaryConfigSchema.parse({ sectionMaxLength: 600 })).toThrow();

      const result = SummaryConfigSchema.parse({ sectionMaxLength: 200 });
      expect(result.sectionMaxLength).toBe(200);
    });

    it('should validate sectionKeyPoints within range', () => {
      expect(() => SummaryConfigSchema.parse({ sectionKeyPoints: 0 })).toThrow();
      expect(() => SummaryConfigSchema.parse({ sectionKeyPoints: 6 })).toThrow();

      const result = SummaryConfigSchema.parse({ sectionKeyPoints: 4 });
      expect(result.sectionKeyPoints).toBe(4);
    });
  });

  describe('TranslationConfigSchema', () => {
    it('should have correct defaults', () => {
      const result = TranslationConfigSchema.parse({});

      expect(result.enabled).toBe(false);
      expect(result.defaultLanguage).toBe('ko');
      expect(result.autoTranslate).toBe(true);
    });

    it('should validate enabled option', () => {
      const result = TranslationConfigSchema.parse({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('should validate defaultLanguage option', () => {
      const result = TranslationConfigSchema.parse({ defaultLanguage: 'en' });
      expect(result.defaultLanguage).toBe('en');
    });

    it('should validate autoTranslate option', () => {
      const result = TranslationConfigSchema.parse({ autoTranslate: false });
      expect(result.autoTranslate).toBe(false);
    });
  });

  describe('AIConfigSchema', () => {
    it('should have correct defaults', () => {
      const result = AIConfigSchema.parse({});

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-5.2');
    });

    it('should validate provider option', () => {
      const result = AIConfigSchema.parse({ provider: 'openai' });
      expect(result.provider).toBe('openai');

      expect(() => AIConfigSchema.parse({ provider: 'invalid' })).toThrow();
    });

    it('should validate model option', () => {
      const result = AIConfigSchema.parse({ model: 'gpt-4' });
      expect(result.model).toBe('gpt-4');
    });
  });

  describe('ConfigSchema', () => {
    it('should include summary config', () => {
      const result = ConfigSchema.parse({});

      expect(result).toHaveProperty('summary');
      expect(result.summary.enabled).toBe(false);
    });

    it('should include translation config', () => {
      const result = ConfigSchema.parse({});

      expect(result).toHaveProperty('translation');
      expect(result.translation.enabled).toBe(false);
    });

    it('should include ai config', () => {
      const result = ConfigSchema.parse({});

      expect(result).toHaveProperty('ai');
      expect(result.ai.provider).toBe('openai');
    });

    it('should allow custom summary config', () => {
      const result = ConfigSchema.parse({
        summary: {
          enabled: true,
          maxLength: 1000,
          style: 'detailed',
          language: 'en',
        },
      });

      expect(result.summary.enabled).toBe(true);
      expect(result.summary.maxLength).toBe(1000);
      expect(result.summary.style).toBe('detailed');
      expect(result.summary.language).toBe('en');
    });

    it('should allow custom translation config', () => {
      const result = ConfigSchema.parse({
        translation: {
          enabled: true,
          defaultLanguage: 'ja',
          autoTranslate: false,
        },
      });

      expect(result.translation.enabled).toBe(true);
      expect(result.translation.defaultLanguage).toBe('ja');
      expect(result.translation.autoTranslate).toBe(false);
    });
  });
});
