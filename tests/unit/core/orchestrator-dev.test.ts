/**
 * Orchestrator dev mode 테스트
 */

import { ConfigSchema } from '../../../src/types/config';

describe('Orchestrator Dev Mode', () => {
  describe('config integration', () => {
    it('should parse dev mode config correctly', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          maxChapters: 2,
          maxScreenshots: 3,
          videoQuality: '360p',
          skipAI: true,
        },
      });

      expect(config.dev.enabled).toBe(true);
      expect(config.dev.maxChapters).toBe(2);
      expect(config.dev.maxScreenshots).toBe(3);
      expect(config.dev.videoQuality).toBe('360p');
      expect(config.dev.skipAI).toBe(true);
    });

    it('should have dev mode disabled by default', () => {
      const config = ConfigSchema.parse({});

      expect(config.dev.enabled).toBe(false);
    });
  });

  describe('chapter limiting logic', () => {
    it('should limit chapters when dev mode is enabled', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          maxChapters: 2,
        },
      });

      // Simulate chapter limiting logic
      const fetchedChapters = [
        { title: 'Chapter 1', startTime: 0 },
        { title: 'Chapter 2', startTime: 300 },
        { title: 'Chapter 3', startTime: 600 },
        { title: 'Chapter 4', startTime: 900 },
      ];

      let limitedChapters = fetchedChapters;
      if (config.dev?.enabled && fetchedChapters.length > 0) {
        const maxChapters = config.dev.maxChapters || 3;
        if (fetchedChapters.length > maxChapters) {
          limitedChapters = fetchedChapters.slice(0, maxChapters);
        }
      }

      expect(limitedChapters.length).toBe(2);
      expect(limitedChapters[0].title).toBe('Chapter 1');
      expect(limitedChapters[1].title).toBe('Chapter 2');
    });

    it('should not limit chapters when dev mode is disabled', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: false,
          maxChapters: 2,
        },
      });

      const fetchedChapters = [
        { title: 'Chapter 1', startTime: 0 },
        { title: 'Chapter 2', startTime: 300 },
        { title: 'Chapter 3', startTime: 600 },
      ];

      let limitedChapters = fetchedChapters;
      if (config.dev?.enabled && fetchedChapters.length > 0) {
        const maxChapters = config.dev.maxChapters || 3;
        if (fetchedChapters.length > maxChapters) {
          limitedChapters = fetchedChapters.slice(0, maxChapters);
        }
      }

      expect(limitedChapters.length).toBe(3); // All chapters
    });

    it('should not limit if chapters are less than maxChapters', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          maxChapters: 5,
        },
      });

      const fetchedChapters = [
        { title: 'Chapter 1', startTime: 0 },
        { title: 'Chapter 2', startTime: 300 },
      ];

      let limitedChapters = fetchedChapters;
      if (config.dev?.enabled && fetchedChapters.length > 0) {
        const maxChapters = config.dev.maxChapters || 3;
        if (fetchedChapters.length > maxChapters) {
          limitedChapters = fetchedChapters.slice(0, maxChapters);
        }
      }

      expect(limitedChapters.length).toBe(2); // All chapters kept
    });
  });

  describe('skipAI logic', () => {
    it('should skip AI processing when skipAI is true', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          skipAI: true,
        },
      });

      const shouldSkipAI = config.dev?.enabled && config.dev?.skipAI;
      expect(shouldSkipAI).toBe(true);
    });

    it('should not skip AI when skipAI is false', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          skipAI: false,
        },
      });

      const shouldSkipAI = config.dev?.enabled && config.dev?.skipAI;
      expect(shouldSkipAI).toBe(false);
    });

    it('should not skip AI when dev mode is disabled', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: false,
          skipAI: true, // This should be ignored
        },
      });

      const shouldSkipAI = config.dev?.enabled && config.dev?.skipAI;
      expect(shouldSkipAI).toBe(false);
    });

    it('should return placeholder summary when skipAI is true', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          skipAI: true,
        },
      });

      // Simulate generateSummary behavior
      let summary;
      if (config.dev?.enabled && config.dev?.skipAI) {
        summary = {
          summary: '[DEV MODE: AI 요약 생략됨]',
          keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
          language: config.summary.language || 'ko',
        };
      }

      expect(summary).toBeDefined();
      expect(summary!.summary).toBe('[DEV MODE: AI 요약 생략됨]');
      expect(summary!.keyPoints).toContain('[DEV MODE: AI 처리 생략됨]');
    });
  });

  describe('video quality for dev mode', () => {
    it('should use dev quality when enabled', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          videoQuality: '360p',
        },
      });

      expect(config.dev.videoQuality).toBe('360p');
    });

    it('should support lowest quality option', () => {
      const config = ConfigSchema.parse({
        dev: {
          enabled: true,
          videoQuality: 'lowest',
        },
      });

      expect(config.dev.videoQuality).toBe('lowest');
    });
  });

  describe('production warning', () => {
    it('should detect production paths', () => {
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
