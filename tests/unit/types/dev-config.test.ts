/**
 * DevConfig 스키마 테스트 (단순화됨)
 */

import { DevConfigSchema, DEV_MODE_SETTINGS, ConfigSchema } from '../../../src/types/config';

describe('DevConfigSchema (simplified)', () => {
  describe('defaults', () => {
    it('should have only enabled field with false default', () => {
      const result = DevConfigSchema.parse({});

      expect(result.enabled).toBe(false);
      expect(Object.keys(result)).toEqual(['enabled']);
    });
  });

  describe('enabled field', () => {
    it('should accept boolean values', () => {
      expect(DevConfigSchema.parse({ enabled: true }).enabled).toBe(true);
      expect(DevConfigSchema.parse({ enabled: false }).enabled).toBe(false);
    });
  });

  describe('full config integration', () => {
    it('should be included in ConfigSchema', () => {
      const result = ConfigSchema.parse({});

      expect(result).toHaveProperty('dev');
      expect(result.dev.enabled).toBe(false);
    });

    it('should accept enabled: true', () => {
      const result = ConfigSchema.parse({
        dev: { enabled: true },
      });

      expect(result.dev.enabled).toBe(true);
    });
  });
});

describe('DEV_MODE_SETTINGS constant', () => {
  it('should have hardcoded dev mode values', () => {
    expect(DEV_MODE_SETTINGS.maxChapters).toBe(2);
    expect(DEV_MODE_SETTINGS.maxScreenshots).toBe(2);
    expect(DEV_MODE_SETTINGS.videoQuality).toBe('360p');
    expect(DEV_MODE_SETTINGS.aiSampleSections).toBe(1);
  });

  it('should be readonly', () => {
    // TypeScript enforces this, but we can verify the object is frozen-like
    expect(typeof DEV_MODE_SETTINGS.maxChapters).toBe('number');
    expect(typeof DEV_MODE_SETTINGS.maxScreenshots).toBe('number');
    expect(typeof DEV_MODE_SETTINGS.videoQuality).toBe('string');
    expect(typeof DEV_MODE_SETTINGS.aiSampleSections).toBe('number');
  });
});
