/**
 * Orchestrator dev mode 테스트 (단순화됨)
 */

import { ConfigSchema, DEV_MODE_SETTINGS } from '../../../src/types/config';

describe('Orchestrator Dev Mode (simplified)', () => {
  describe('config integration', () => {
    it('should parse dev mode config with only enabled field', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
      });

      expect(config.dev.enabled).toBe(true);
      expect(Object.keys(config.dev)).toEqual(['enabled']);
    });

    it('should have dev mode disabled by default', () => {
      const config = ConfigSchema.parse({});

      expect(config.dev.enabled).toBe(false);
    });
  });

  describe('chapter limiting logic', () => {
    it('should limit chapters using DEV_MODE_SETTINGS when dev mode is enabled', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
      });

      const fetchedChapters = [
        { title: 'Chapter 1', startTime: 0 },
        { title: 'Chapter 2', startTime: 300 },
        { title: 'Chapter 3', startTime: 600 },
        { title: 'Chapter 4', startTime: 900 },
      ];

      let limitedChapters = fetchedChapters;
      if (config.dev?.enabled && fetchedChapters.length > DEV_MODE_SETTINGS.maxChapters) {
        limitedChapters = fetchedChapters.slice(0, DEV_MODE_SETTINGS.maxChapters);
      }

      expect(limitedChapters.length).toBe(DEV_MODE_SETTINGS.maxChapters); // 2
      expect(limitedChapters[0].title).toBe('Chapter 1');
      expect(limitedChapters[1].title).toBe('Chapter 2');
    });

    it('should not limit chapters when dev mode is disabled', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: false },
      });

      const fetchedChapters = [
        { title: 'Chapter 1', startTime: 0 },
        { title: 'Chapter 2', startTime: 300 },
        { title: 'Chapter 3', startTime: 600 },
      ];

      let limitedChapters = fetchedChapters;
      if (config.dev?.enabled && fetchedChapters.length > DEV_MODE_SETTINGS.maxChapters) {
        limitedChapters = fetchedChapters.slice(0, DEV_MODE_SETTINGS.maxChapters);
      }

      expect(limitedChapters.length).toBe(3); // All chapters
    });
  });

  describe('AI sampling logic', () => {
    it('should sample AI processing using DEV_MODE_SETTINGS when dev mode is enabled', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
      });

      const sections = [
        { timestamp: 0, content: 'Section 1' },
        { timestamp: 300, content: 'Section 2' },
        { timestamp: 600, content: 'Section 3' },
      ];

      const shouldSample = config.dev?.enabled && sections.length > DEV_MODE_SETTINGS.aiSampleSections;

      let sectionsToProcess = sections;
      let sectionsToSkip: typeof sections = [];

      if (shouldSample) {
        sectionsToProcess = sections.slice(0, DEV_MODE_SETTINGS.aiSampleSections);
        sectionsToSkip = sections.slice(DEV_MODE_SETTINGS.aiSampleSections);
      }

      expect(shouldSample).toBe(true);
      expect(sectionsToProcess.length).toBe(DEV_MODE_SETTINGS.aiSampleSections); // 1
      expect(sectionsToSkip.length).toBe(2);
    });

    it('should not sample when dev mode is disabled', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: false },
      });

      const sections = [
        { timestamp: 0, content: 'Section 1' },
        { timestamp: 300, content: 'Section 2' },
      ];

      const shouldSample = config.dev?.enabled && sections.length > DEV_MODE_SETTINGS.aiSampleSections;

      expect(shouldSample).toBe(false);
    });
  });

  describe('DEV_MODE_SETTINGS values', () => {
    it('should have expected hardcoded values', () => {
      expect(DEV_MODE_SETTINGS.maxChapters).toBe(2);
      expect(DEV_MODE_SETTINGS.maxScreenshots).toBe(2);
      expect(DEV_MODE_SETTINGS.videoQuality).toBe('360p');
      expect(DEV_MODE_SETTINGS.aiSampleSections).toBe(1);
    });
  });

  describe('production warning', () => {
    it('should detect production paths when dev mode enabled', () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
      });

      const testPaths = [
        { path: '/tmp/output', shouldWarn: false },
        { path: './temp/test', shouldWarn: false },
        { path: './dev/output', shouldWarn: false },
        { path: './output/production', shouldWarn: true },
        { path: '/home/user/documents', shouldWarn: true },
      ];

      for (const { path, shouldWarn } of testPaths) {
        const isProductionPath =
          config.dev?.enabled &&
          path &&
          !path.includes('temp') &&
          !path.includes('dev') &&
          !path.includes('tmp');

        expect(isProductionPath).toBe(shouldWarn);
      }
    });
  });
});
