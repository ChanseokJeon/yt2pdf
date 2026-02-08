/**
 * Orchestrator Characterization Tests
 *
 * Captures current behavior of src/core/orchestrator.ts (915 lines)
 * before any future refactoring. These tests document existing behavior,
 * not ideal behavior.
 */

// ============================================================
// jest.mock() calls MUST come before imports
// ============================================================

// --- Providers ---
const mockGetMetadata = jest.fn();
const mockGetPlaylistVideos = jest.fn();
const mockDownloadAudio = jest.fn();
const mockDownloadVideo = jest.fn();
const mockDownloadThumbnail = jest.fn();
const mockDownloadThumbnails = jest.fn();

jest.mock('../../src/providers/youtube', () => ({
  YouTubeProvider: jest.fn().mockImplementation(() => ({
    getMetadata: mockGetMetadata,
    getPlaylistVideos: mockGetPlaylistVideos,
    downloadAudio: mockDownloadAudio,
    downloadVideo: mockDownloadVideo,
    downloadThumbnail: mockDownloadThumbnail,
    downloadThumbnails: mockDownloadThumbnails,
  })),
}));

jest.mock('../../src/providers/ffmpeg', () => ({
  FFmpegWrapper: jest.fn().mockImplementation(() => ({})),
}));

const mockWhisperConstructor = jest.fn();
jest.mock('../../src/providers/whisper', () => ({
  WhisperProvider: mockWhisperConstructor.mockImplementation(() => ({})),
}));

const mockAITranslate = jest.fn();
const mockAIClassifyVideoType = jest.fn();
const mockAISummarize = jest.fn();
const mockAIDetectTopicShifts = jest.fn();
const mockAISummarizeSections = jest.fn();
const mockAIGenerateExecutiveBrief = jest.fn();
const mockAIConstructor = jest.fn();

jest.mock('../../src/providers/ai', () => ({
  AIProvider: mockAIConstructor.mockImplementation(() => ({
    translate: mockAITranslate,
    classifyVideoType: mockAIClassifyVideoType,
    summarize: mockAISummarize,
    detectTopicShifts: mockAIDetectTopicShifts,
    summarizeSections: mockAISummarizeSections,
    generateExecutiveBrief: mockAIGenerateExecutiveBrief,
  })),
}));

const mockProcessAllSections = jest.fn();
const mockUnifiedConstructor = jest.fn();

jest.mock('../../src/providers/unified-ai', () => ({
  UnifiedContentProcessor: mockUnifiedConstructor.mockImplementation(() => ({
    processAllSections: mockProcessAllSections,
  })),
}));

// --- Core modules (instantiated inside processVideo) ---
const mockSubtitleExtract = jest.fn();
jest.mock('../../src/core/subtitle-extractor', () => ({
  SubtitleExtractor: jest.fn().mockImplementation(() => ({
    extract: mockSubtitleExtract,
  })),
}));

const mockCaptureAll = jest.fn();
const mockCaptureForChapters = jest.fn();
const mockCaptureFromThumbnails = jest.fn();
jest.mock('../../src/core/screenshot-capturer', () => ({
  ScreenshotCapturer: jest.fn().mockImplementation(() => ({
    captureAll: mockCaptureAll,
    captureForChapters: mockCaptureForChapters,
    captureFromThumbnails: mockCaptureFromThumbnails,
  })),
}));

const mockContentMerge = jest.fn();
const mockContentMergeWithChapters = jest.fn();
jest.mock('../../src/core/content-merger', () => ({
  ContentMerger: jest.fn().mockImplementation(() => ({
    merge: mockContentMerge,
    mergeWithChapters: mockContentMergeWithChapters,
  })),
}));

const mockGeneratePDF = jest.fn();
const mockGenerateMarkdown = jest.fn();
const mockGenerateHTML = jest.fn();
const mockGenerateBriefPDF = jest.fn();
jest.mock('../../src/core/pdf-generator', () => ({
  PDFGenerator: jest.fn().mockImplementation(() => ({
    generatePDF: mockGeneratePDF,
    generateMarkdown: mockGenerateMarkdown,
    generateHTML: mockGenerateHTML,
    generateBriefPDF: mockGenerateBriefPDF,
  })),
}));

const mockCostEstimate = jest.fn();
const mockCostGetSummary = jest.fn();
jest.mock('../../src/core/cost-estimator', () => ({
  CostEstimator: {
    estimate: (...args: unknown[]) => mockCostEstimate(...args),
    getSummary: (...args: unknown[]) => mockCostGetSummary(...args),
  },
}));

// --- Utils ---
jest.mock('../../src/utils/cache', () => ({
  CacheManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const mockCreateTempDir = jest.fn();
const mockCleanupDir = jest.fn();
const mockEnsureDir = jest.fn();
const mockGetDateString = jest.fn();
const mockGetTimestampString = jest.fn();
const mockApplyFilenamePattern = jest.fn();
const mockGetFileSize = jest.fn();

jest.mock('../../src/utils/file', () => ({
  createTempDir: (...args: unknown[]) => mockCreateTempDir(...args),
  cleanupDir: (...args: unknown[]) => mockCleanupDir(...args),
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
  getDateString: (...args: unknown[]) => mockGetDateString(...args),
  getTimestampString: (...args: unknown[]) => mockGetTimestampString(...args),
  applyFilenamePattern: (...args: unknown[]) => mockApplyFilenamePattern(...args),
  getFileSize: (...args: unknown[]) => mockGetFileSize(...args),
}));

const mockParseYouTubeUrl = jest.fn();
const mockBuildVideoUrl = jest.fn();

jest.mock('../../src/utils/url', () => ({
  parseYouTubeUrl: (...args: unknown[]) => mockParseYouTubeUrl(...args),
  buildVideoUrl: (...args: unknown[]) => mockBuildVideoUrl(...args),
}));

// Mock fs (for copyFile in generateStandardOutput)
const mockCopyFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs', () => ({
  promises: {
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
  },
}));

// ============================================================
// Imports (after all mocks)
// ============================================================

import { Orchestrator } from '../../src/core/orchestrator';
import { ConfigSchema } from '../../src/types/config';
import { Yt2PdfError, ErrorCode } from '../../src/types/index';
import { logger } from '../../src/utils/logger';

// ============================================================
// Test data factories
// ============================================================

function createDefaultConfig() {
  return ConfigSchema.parse({});
}

function createMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 'testVideoId',
    title: 'Test Video Title',
    description: 'Test description',
    duration: 600,
    thumbnail: 'https://img.youtube.com/vi/testVideoId/0.jpg',
    channel: 'Test Channel',
    uploadDate: '2024-01-01',
    viewCount: 1000,
    availableCaptions: [{ language: 'English', languageCode: 'en', isAutoGenerated: false }],
    chapters: [],
    ...overrides,
  };
}

function createSubtitleResult(overrides: Record<string, unknown> = {}) {
  return {
    source: 'youtube' as const,
    language: 'en',
    segments: [
      { start: 0, end: 10, text: 'Hello world' },
      { start: 10, end: 20, text: 'Test subtitle' },
    ],
    ...overrides,
  };
}

function createScreenshots() {
  return [
    { timestamp: 60, imagePath: '/tmp/screenshot_1.png', width: 480, height: 360 },
    { timestamp: 120, imagePath: '/tmp/screenshot_2.png', width: 480, height: 360 },
  ];
}

function createMergedContent() {
  return {
    metadata: createMetadata(),
    sections: [
      {
        timestamp: 60,
        screenshot: { timestamp: 60, imagePath: '/tmp/screenshot_1.png', width: 480, height: 360 },
        subtitles: [{ start: 0, end: 60, text: 'Section 1 text' }],
      },
      {
        timestamp: 120,
        screenshot: {
          timestamp: 120,
          imagePath: '/tmp/screenshot_2.png',
          width: 480,
          height: 360,
        },
        subtitles: [{ start: 60, end: 120, text: 'Section 2 text' }],
      },
    ],
  };
}

// ============================================================
// Setup defaults for all mocks (happy path)
// ============================================================

function setupHappyPathMocks() {
  // URL parsing
  mockParseYouTubeUrl.mockReturnValue({ type: 'video', id: 'testVideoId' });
  mockBuildVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=testVideoId');

  // File utils
  mockCreateTempDir.mockResolvedValue('/tmp/yt2pdf-abc123');
  mockCleanupDir.mockResolvedValue(undefined);
  mockEnsureDir.mockResolvedValue(undefined);
  mockGetDateString.mockReturnValue('2024-01-01');
  mockGetTimestampString.mockReturnValue('20240101_120000');
  mockApplyFilenamePattern.mockReturnValue('2024-01-01_001_Test-Video-Title');
  mockGetFileSize.mockResolvedValue(1024000);

  // YouTube provider
  mockGetMetadata.mockResolvedValue(createMetadata());

  // Subtitle extractor
  mockSubtitleExtract.mockResolvedValue(createSubtitleResult());

  // Screenshot capturer
  const screenshots = createScreenshots();
  mockCaptureAll.mockResolvedValue(screenshots);
  mockCaptureForChapters.mockResolvedValue(screenshots);
  mockCaptureFromThumbnails.mockResolvedValue(screenshots);

  // Content merger
  const mergedContent = createMergedContent();
  mockContentMerge.mockReturnValue(mergedContent);
  mockContentMergeWithChapters.mockReturnValue(mergedContent);

  // PDF generator
  mockGeneratePDF.mockResolvedValue(undefined);
  mockGenerateMarkdown.mockResolvedValue(undefined);
  mockGenerateHTML.mockResolvedValue(undefined);
  mockGenerateBriefPDF.mockResolvedValue(undefined);

  // copyFile
  mockCopyFile.mockResolvedValue(undefined);
}

// ============================================================
// Tests
// ============================================================

describe('Orchestrator (Characterization)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.OPENAI_API_KEY;

    jest.clearAllMocks();
    setupHappyPathMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ----------------------------------------------------------
  // Constructor Tests
  // ----------------------------------------------------------
  describe('Constructor', () => {
    it('creates instance with default config (no OPENAI_API_KEY)', () => {
      delete process.env.OPENAI_API_KEY;
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      expect(orchestrator).toBeInstanceOf(Orchestrator);
      // Without API key, AI providers should NOT be initialized
      expect(mockWhisperConstructor).not.toHaveBeenCalled();
      expect(mockAIConstructor).not.toHaveBeenCalled();
      expect(mockUnifiedConstructor).not.toHaveBeenCalled();
    });

    it('creates instance with OPENAI_API_KEY set (initializes AI providers)', () => {
      process.env.OPENAI_API_KEY = 'test-key-123';
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      expect(orchestrator).toBeInstanceOf(Orchestrator);
      expect(mockWhisperConstructor).toHaveBeenCalled();
      expect(mockAIConstructor).toHaveBeenCalled();
      expect(mockUnifiedConstructor).toHaveBeenCalled();
    });

    it('handles AI provider initialization failures gracefully', () => {
      process.env.OPENAI_API_KEY = 'test-key-123';
      mockWhisperConstructor.mockImplementation(() => {
        throw new Error('Whisper init failed');
      });
      mockAIConstructor.mockImplementation(() => {
        throw new Error('AI init failed');
      });
      mockUnifiedConstructor.mockImplementation(() => {
        throw new Error('Unified init failed');
      });

      const config = createDefaultConfig();
      // Should NOT throw - errors are caught silently
      const orchestrator = new Orchestrator({ config });
      expect(orchestrator).toBeInstanceOf(Orchestrator);
    });
  });

  // ----------------------------------------------------------
  // process() Tests
  // ----------------------------------------------------------
  describe('process()', () => {
    it('throws Yt2PdfError for playlist URL', async () => {
      mockParseYouTubeUrl.mockReturnValue({ type: 'playlist', id: 'PLtest123' });
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      await expect(
        orchestrator.process({ url: 'https://www.youtube.com/playlist?list=PLtest123' })
      ).rejects.toThrow(Yt2PdfError);

      await expect(
        orchestrator.process({ url: 'https://www.youtube.com/playlist?list=PLtest123' })
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_URL,
      });
    });

    it('delegates to processVideo for valid single video URL', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const result = await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(mockParseYouTubeUrl).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=testVideoId'
      );
      expect(mockGetMetadata).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('returns ConvertResult with correct structure', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const result = await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(result).toMatchObject({
        success: true,
        outputPath: expect.any(String),
        metadata: expect.objectContaining({
          id: 'testVideoId',
          title: 'Test Video Title',
        }),
        stats: expect.objectContaining({
          pages: expect.any(Number),
          fileSize: expect.any(Number),
          duration: expect.any(Number),
          screenshotCount: expect.any(Number),
        }),
      });
    });
  });

  // ----------------------------------------------------------
  // processPlaylist() Tests
  // ----------------------------------------------------------
  describe('processPlaylist()', () => {
    it('wraps single video in array if not playlist', async () => {
      mockParseYouTubeUrl.mockReturnValue({ type: 'video', id: 'testVideoId' });
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const results = await orchestrator.processPlaylist({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it('processes multiple videos sequentially', async () => {
      mockParseYouTubeUrl.mockReturnValue({ type: 'playlist', id: 'PLtest123' });
      mockGetPlaylistVideos.mockResolvedValue([
        { id: 'vid1', title: 'Video 1' },
        { id: 'vid2', title: 'Video 2' },
      ]);

      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const results = await orchestrator.processPlaylist({
        url: 'https://www.youtube.com/playlist?list=PLtest123',
      });

      expect(results).toHaveLength(2);
      // buildVideoUrl should be called for each video
      expect(mockBuildVideoUrl).toHaveBeenCalledWith('vid1');
      expect(mockBuildVideoUrl).toHaveBeenCalledWith('vid2');
    });

    it('skips failed videos, continues with rest', async () => {
      mockParseYouTubeUrl.mockReturnValue({ type: 'playlist', id: 'PLtest123' });
      mockGetPlaylistVideos.mockResolvedValue([
        { id: 'vid1', title: 'Video 1' },
        { id: 'vid2', title: 'Video 2' },
        { id: 'vid3', title: 'Video 3' },
      ]);

      // Make second video fail by having getMetadata fail on that call
      let callCount = 0;
      mockGetMetadata.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Network error for vid2');
        }
        return Promise.resolve(createMetadata());
      });

      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const results = await orchestrator.processPlaylist({
        url: 'https://www.youtube.com/playlist?list=PLtest123',
      });

      // vid2 failed, so only vid1 and vid3 should succeed
      expect(results).toHaveLength(2);
      expect(logger.error).toHaveBeenCalled();
    });

    it("updates state to 'fetching' at start for playlist", async () => {
      mockParseYouTubeUrl.mockReturnValue({ type: 'playlist', id: 'PLtest123' });
      mockGetPlaylistVideos.mockResolvedValue([{ id: 'vid1', title: 'Video 1' }]);

      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const progressCallback = jest.fn();
      orchestrator.onProgress(progressCallback);

      await orchestrator.processPlaylist({
        url: 'https://www.youtube.com/playlist?list=PLtest123',
      });

      // First callback should have status 'fetching' for playlist info
      const firstCallState = progressCallback.mock.calls[0][0];
      expect(firstCallState.status).toBe('fetching');
      expect(firstCallState.progress).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // processVideo pipeline Tests (Happy Path)
  // ----------------------------------------------------------
  describe('processVideo pipeline', () => {
    it('executes all 7 steps in order', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const callOrder: string[] = [];

      mockGetMetadata.mockImplementation(async () => {
        callOrder.push('fetchMetadata');
        return createMetadata();
      });
      mockSubtitleExtract.mockImplementation(async () => {
        callOrder.push('extractSubtitles');
        return createSubtitleResult();
      });
      // classifyAndGenerateChapters is internal but goes through AI (not called without AI)
      mockCaptureAll.mockImplementation(async () => {
        callOrder.push('captureScreenshots');
        return createScreenshots();
      });
      mockContentMerge.mockImplementation(() => {
        callOrder.push('mergeContent');
        return createMergedContent();
      });
      mockGeneratePDF.mockImplementation(async () => {
        callOrder.push('generatePDF');
      });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(callOrder).toEqual([
        'fetchMetadata',
        'extractSubtitles',
        'captureScreenshots',
        'mergeContent',
        'generatePDF',
      ]);
    });

    it('creates temp directory and cleans up after', async () => {
      const config = ConfigSchema.parse({ cache: { enabled: false } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(mockCreateTempDir).toHaveBeenCalledWith('yt2pdf-');
      expect(mockCleanupDir).toHaveBeenCalledWith('/tmp/yt2pdf-abc123');
    });

    it('does NOT clean up temp dir when cache is enabled', async () => {
      const config = ConfigSchema.parse({ cache: { enabled: true } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(mockCreateTempDir).toHaveBeenCalledWith('yt2pdf-');
      expect(mockCleanupDir).not.toHaveBeenCalled();
    });

    it('progress callbacks are called with increasing progress values', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const progressCallback = jest.fn();
      orchestrator.onProgress(progressCallback);

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(progressCallback).toHaveBeenCalled();

      // Collect all progress values
      const progressValues = progressCallback.mock.calls.map(
        (call: [{ progress: number }]) => call[0].progress
      );

      // Progress should generally increase (allowing same values in consecutive calls)
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // First progress should be 5 (fetchMetadata step)
      expect(progressValues[0]).toBe(5);
      // Last progress should be 100 (complete)
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });

    it('returns valid ConvertResult with stats', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });

      const result = await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(result.success).toBe(true);
      expect(typeof result.outputPath).toBe('string');
      expect(result.metadata.id).toBe('testVideoId');
      expect(result.stats.fileSize).toBe(1024000);
      expect(result.stats.duration).toBe(600);
      expect(typeof result.stats.screenshotCount).toBe('number');
    });

    it('uses chapters from YouTube metadata when available', async () => {
      const chapters = [
        { title: 'Intro', startTime: 0, endTime: 120 },
        { title: 'Main', startTime: 120, endTime: 480 },
      ];
      mockGetMetadata.mockResolvedValue(
        createMetadata({
          chapters,
        })
      );

      const config = ConfigSchema.parse({ chapter: { useYouTubeChapters: true } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      // With chapters, mergeWithChapters should be used
      expect(mockContentMergeWithChapters).toHaveBeenCalled();
      expect(mockCaptureForChapters).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Dev Mode Tests
  // ----------------------------------------------------------
  describe('Dev mode behavior', () => {
    it('limits chapters to DEV_MODE_SETTINGS.maxChapters (2)', async () => {
      const chapters = [
        { title: 'Ch1', startTime: 0, endTime: 60 },
        { title: 'Ch2', startTime: 60, endTime: 120 },
        { title: 'Ch3', startTime: 120, endTime: 180 },
        { title: 'Ch4', startTime: 180, endTime: 240 },
      ];
      mockGetMetadata.mockResolvedValue(createMetadata({ chapters }));

      const config = ConfigSchema.parse({
        dev: { enabled: true },
        chapter: { useYouTubeChapters: true },
      });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      // Should log about chapter limiting
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('챕터: 4개 → 2개'));
    });

    it('logs dev mode warnings', async () => {
      const config = ConfigSchema.parse({ dev: { enabled: true } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      // Should log the dev mode header
      expect(logger.warn).toHaveBeenCalledWith('[DEV MODE] 빠른 테스트 모드');
      expect(logger.warn).toHaveBeenCalledWith('='.repeat(50));
    });

    it('logs production path warning when output does not include temp/dev/tmp', async () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
        output: { directory: '/home/user/production-output' },
      });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('--dev 모드로 프로덕션 경로에 출력 중')
      );
    });

    it('does NOT log production warning when output includes "dev"', async () => {
      const config = ConfigSchema.parse({
        dev: { enabled: true },
        output: { directory: '/home/user/dev-output' },
      });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      const warnCalls = (logger.warn as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
      const productionWarnings = warnCalls.filter(
        (msg: string) => typeof msg === 'string' && msg.includes('프로덕션 경로에 출력 중')
      );
      expect(productionWarnings).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // Error Handling Tests
  // ----------------------------------------------------------
  describe('Error handling', () => {
    it('cleans up temp dir even on error (finally block)', async () => {
      mockGetMetadata.mockRejectedValue(new Error('Metadata fetch failed'));

      const config = ConfigSchema.parse({ cache: { enabled: false } });
      const orchestrator = new Orchestrator({ config });

      await expect(
        orchestrator.process({
          url: 'https://www.youtube.com/watch?v=testVideoId',
        })
      ).rejects.toThrow('Metadata fetch failed');

      // Cleanup should still be called
      expect(mockCleanupDir).toHaveBeenCalledWith('/tmp/yt2pdf-abc123');
    });

    it('does NOT clean up temp dir on error when cache is enabled', async () => {
      mockGetMetadata.mockRejectedValue(new Error('Metadata fetch failed'));

      const config = ConfigSchema.parse({ cache: { enabled: true } });
      const orchestrator = new Orchestrator({ config });

      await expect(
        orchestrator.process({
          url: 'https://www.youtube.com/watch?v=testVideoId',
        })
      ).rejects.toThrow('Metadata fetch failed');

      expect(mockCleanupDir).not.toHaveBeenCalled();
    });

    it('logs duration warning for videos exceeding maxDuration', async () => {
      mockGetMetadata.mockResolvedValue(
        createMetadata({ duration: 10000 }) // exceeds default 7200
      );

      const config = ConfigSchema.parse({ processing: { maxDuration: 7200 } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('영상 길이(10000초)가 제한(7200초)을 초과합니다')
      );
    });
  });

  // ----------------------------------------------------------
  // Progress / State Tracking Tests
  // ----------------------------------------------------------
  describe('Progress tracking', () => {
    it('onProgress registers callback correctly', () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      orchestrator.onProgress(cb1);
      orchestrator.onProgress(cb2);

      // Trigger a process to verify both callbacks are called
      return orchestrator
        .process({ url: 'https://www.youtube.com/watch?v=testVideoId' })
        .then(() => {
          expect(cb1).toHaveBeenCalled();
          expect(cb2).toHaveBeenCalled();
        });
    });

    it('updateState merges partial state and notifies all callbacks', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const callback = jest.fn();
      orchestrator.onProgress(callback);

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      // Verify that callbacks receive PipelineState objects with expected fields
      for (const call of callback.mock.calls) {
        const state = call[0];
        expect(state).toHaveProperty('status');
        expect(state).toHaveProperty('progress');
        expect(state).toHaveProperty('currentStep');
      }
    });

    it('progress increases through pipeline steps (5 -> 20 -> ... -> 100)', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const callback = jest.fn();
      orchestrator.onProgress(callback);

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      const progressValues = callback.mock.calls.map(
        (call: [{ progress: number }]) => call[0].progress
      );

      // Key pipeline progress milestones should be present
      expect(progressValues).toContain(5); // fetchMetadata
      expect(progressValues).toContain(20); // extractSubtitles
      expect(progressValues).toContain(80); // generateOutput
      expect(progressValues).toContain(100); // complete

      // All progress values should be between 0 and 100
      for (const p of progressValues) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
      }
    });

    it('status transitions through fetching -> processing -> generating -> complete', async () => {
      const config = createDefaultConfig();
      const orchestrator = new Orchestrator({ config });
      const callback = jest.fn();
      orchestrator.onProgress(callback);

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      const statuses = callback.mock.calls.map(
        (call: [{ status: string }]) => call[0].status
      );
      const uniqueStatuses = [...new Set(statuses)];

      expect(uniqueStatuses).toContain('fetching');
      expect(uniqueStatuses).toContain('processing');
      expect(uniqueStatuses).toContain('generating');
      expect(uniqueStatuses).toContain('complete');
    });
  });

  // ----------------------------------------------------------
  // estimateCost Tests
  // ----------------------------------------------------------
  describe('estimateCost', () => {
    it('returns free message for YouTube captions', () => {
      const result = Orchestrator.estimateCost(600, true);
      expect(result).toBe('무료 (YouTube 자막 사용)');
    });

    it('calculates cost for non-YouTube captions via CostEstimator', () => {
      const mockEstimate = {
        whisperCost: 0.06,
        totalCost: 0.06,
        currency: 'USD',
        breakdown: { whisper: { minutes: 10, costPerMinute: 0.006 } },
      };
      mockCostEstimate.mockReturnValue(mockEstimate);
      mockCostGetSummary.mockReturnValue('예상 비용:\n  - Whisper API: 10분 × $0.006/분 = $0.060\n  - 총 비용: $0.060');

      const result = Orchestrator.estimateCost(600, false);

      expect(mockCostEstimate).toHaveBeenCalledWith(600);
      expect(mockCostGetSummary).toHaveBeenCalledWith(mockEstimate);
      expect(result).toContain('예상 비용');
    });
  });

  // ----------------------------------------------------------
  // Output Format Tests
  // ----------------------------------------------------------
  describe('Output format handling', () => {
    it('generates PDF by default', async () => {
      const config = ConfigSchema.parse({ output: { format: 'pdf' } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
      });

      expect(mockGeneratePDF).toHaveBeenCalled();
      expect(mockGenerateMarkdown).not.toHaveBeenCalled();
      expect(mockGenerateHTML).not.toHaveBeenCalled();
    });

    it('generates Markdown when format is md', async () => {
      const config = ConfigSchema.parse({ output: { format: 'md' } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
        format: 'md',
      });

      expect(mockGenerateMarkdown).toHaveBeenCalled();
      expect(mockGeneratePDF).not.toHaveBeenCalled();
    });

    it('generates HTML when format is html', async () => {
      const config = ConfigSchema.parse({ output: { format: 'html' } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
        format: 'html',
      });

      expect(mockGenerateHTML).toHaveBeenCalled();
      expect(mockGeneratePDF).not.toHaveBeenCalled();
    });

    it('generates brief PDF when format is brief', async () => {
      const config = ConfigSchema.parse({ output: { format: 'brief' } });
      const orchestrator = new Orchestrator({ config });

      await orchestrator.process({
        url: 'https://www.youtube.com/watch?v=testVideoId',
        format: 'brief',
      });

      expect(mockGenerateBriefPDF).toHaveBeenCalled();
      expect(mockGeneratePDF).not.toHaveBeenCalled();
    });
  });
});
