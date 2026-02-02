/**
 * DevConfig 스키마 테스트
 */

import { DevConfigSchema, ConfigSchema } from '../../../src/types/config';

describe('DevConfigSchema', () => {
  describe('defaults', () => {
    it('should have correct defaults', () => {
      const result = DevConfigSchema.parse({});

      expect(result.enabled).toBe(false);
      expect(result.maxChapters).toBe(3);
      expect(result.maxScreenshots).toBe(3);
      expect(result.videoQuality).toBe('360p');
      expect(result.skipAI).toBe(true);
    });
  });

  describe('enabled field', () => {
    it('should accept boolean values', () => {
      expect(DevConfigSchema.parse({ enabled: true }).enabled).toBe(true);
      expect(DevConfigSchema.parse({ enabled: false }).enabled).toBe(false);
    });
  });

  describe('maxChapters field', () => {
    it('should validate min value of 1', () => {
      expect(() => DevConfigSchema.parse({ maxChapters: 0 })).toThrow();
      expect(DevConfigSchema.parse({ maxChapters: 1 }).maxChapters).toBe(1);
    });

    it('should validate max value of 10', () => {
      expect(() => DevConfigSchema.parse({ maxChapters: 11 })).toThrow();
      expect(DevConfigSchema.parse({ maxChapters: 10 }).maxChapters).toBe(10);
    });

    it('should accept values within range', () => {
      expect(DevConfigSchema.parse({ maxChapters: 5 }).maxChapters).toBe(5);
    });
  });

  describe('maxScreenshots field', () => {
    it('should validate min value of 1', () => {
      expect(() => DevConfigSchema.parse({ maxScreenshots: 0 })).toThrow();
      expect(DevConfigSchema.parse({ maxScreenshots: 1 }).maxScreenshots).toBe(1);
    });

    it('should validate max value of 10', () => {
      expect(() => DevConfigSchema.parse({ maxScreenshots: 11 })).toThrow();
      expect(DevConfigSchema.parse({ maxScreenshots: 10 }).maxScreenshots).toBe(10);
    });
  });

  describe('videoQuality field', () => {
    it('should accept valid enum values', () => {
      expect(DevConfigSchema.parse({ videoQuality: 'lowest' }).videoQuality).toBe('lowest');
      expect(DevConfigSchema.parse({ videoQuality: '360p' }).videoQuality).toBe('360p');
      expect(DevConfigSchema.parse({ videoQuality: '480p' }).videoQuality).toBe('480p');
    });

    it('should reject invalid enum values', () => {
      expect(() => DevConfigSchema.parse({ videoQuality: '720p' })).toThrow();
      expect(() => DevConfigSchema.parse({ videoQuality: 'high' })).toThrow();
    });
  });

  describe('skipAI field', () => {
    it('should accept boolean values', () => {
      expect(DevConfigSchema.parse({ skipAI: true }).skipAI).toBe(true);
      expect(DevConfigSchema.parse({ skipAI: false }).skipAI).toBe(false);
    });
  });

  describe('full config integration', () => {
    it('should be included in ConfigSchema', () => {
      const result = ConfigSchema.parse({});

      expect(result).toHaveProperty('dev');
      expect(result.dev.enabled).toBe(false);
    });

    it('should allow custom dev config in ConfigSchema', () => {
      const result = ConfigSchema.parse({
        dev: {
          enabled: true,
          maxChapters: 2,
          maxScreenshots: 5,
          videoQuality: 'lowest',
          skipAI: false,
        },
      });

      expect(result.dev.enabled).toBe(true);
      expect(result.dev.maxChapters).toBe(2);
      expect(result.dev.maxScreenshots).toBe(5);
      expect(result.dev.videoQuality).toBe('lowest');
      expect(result.dev.skipAI).toBe(false);
    });

    it('should merge dev config with defaults', () => {
      const result = ConfigSchema.parse({
        dev: {
          enabled: true,
          maxChapters: 2,
          // other fields use defaults
        },
      });

      expect(result.dev.enabled).toBe(true);
      expect(result.dev.maxChapters).toBe(2);
      expect(result.dev.maxScreenshots).toBe(3); // default
      expect(result.dev.videoQuality).toBe('360p'); // default
      expect(result.dev.skipAI).toBe(true); // default
    });
  });
});
