/**
 * Unit tests for ScreenshotStage
 */

import { ScreenshotStage } from '../../../../../src/core/pipeline/stages/screenshot-stage.js';
import { PipelineContext } from '../../../../../src/core/pipeline/types.js';
import { ScreenshotCapturer } from '../../../../../src/core/screenshot-capturer.js';
import { logger } from '../../../../../src/utils/logger.js';
import { Screenshot, Chapter } from '../../../../../src/types/index.js';

jest.mock('../../../../../src/core/screenshot-capturer.js');
jest.mock('../../../../../src/utils/logger.js');

describe('ScreenshotStage', () => {
  let stage: ScreenshotStage;
  let mockContext: Partial<PipelineContext>;
  let mockScreenshotCapturer: jest.Mocked<ScreenshotCapturer>;
  const mockScreenshots: Screenshot[] = [
    { timestamp: 0, imagePath: '/tmp/s1.jpg', width: 480, height: 360 },
    { timestamp: 60, imagePath: '/tmp/s2.jpg', width: 480, height: 360 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    stage = new ScreenshotStage();

    mockScreenshotCapturer = {
      captureAll: jest.fn().mockResolvedValue(mockScreenshots),
      captureForChapters: jest.fn().mockResolvedValue(mockScreenshots),
      captureFromThumbnails: jest.fn().mockResolvedValue(mockScreenshots),
    } as any;

    (ScreenshotCapturer as jest.MockedClass<typeof ScreenshotCapturer>).mockImplementation(
      () => mockScreenshotCapturer
    );

    mockContext = {
      videoId: 'test-video-id',
      config: {
        screenshot: {
          interval: 60,
          quality: 'low' as const,
        },
        dev: {
          enabled: false,
        },
      } as any,
      tempDir: '/tmp/test',
      ffmpeg: {} as any,
      youtube: {} as any,
      metadata: {
        id: 'test-video-id',
        title: 'Test Video',
        duration: 120,
        thumbnail: 'http://example.com/thumb.jpg',
      } as any,
      chapters: [],
      onProgress: jest.fn(),
      traceEnabled: false,
      traceSteps: [],
    };
  });

  describe('name', () => {
    it('should be "screenshots"', () => {
      expect(stage.name).toBe('screenshots');
    });
  });

  describe('execute', () => {
    it('should call onProgress with initial state', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '스크린샷 캡처',
        progress: 40,
      });
    });

    it('should call onProgress with final progress', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        progress: 70,
      });
    });

    it('should create ScreenshotCapturer with correct config', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(ScreenshotCapturer).toHaveBeenCalledWith({
        ffmpeg: mockContext.ffmpeg,
        youtube: mockContext.youtube,
        config: mockContext.config!.screenshot,
        tempDir: mockContext.tempDir,
        devQuality: undefined,
        devMaxScreenshots: undefined,
        useThumbnails: false,
        onProgress: expect.any(Function),
      });
    });

    it('should call captureAll for time-based capture (no chapters)', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(mockScreenshotCapturer.captureAll).toHaveBeenCalledWith(
        'test-video-id',
        120,
        'http://example.com/thumb.jpg'
      );
      expect(mockScreenshotCapturer.captureForChapters).not.toHaveBeenCalled();
    });

    it('should call captureForChapters when chapters exist', async () => {
      const chapters: Chapter[] = [
        { title: 'Chapter 1', startTime: 0, endTime: 60 },
        { title: 'Chapter 2', startTime: 60, endTime: 120 },
      ];
      mockContext.chapters = chapters;

      await stage.execute(mockContext as PipelineContext);

      expect(mockScreenshotCapturer.captureForChapters).toHaveBeenCalledWith(
        'test-video-id',
        chapters,
        'http://example.com/thumb.jpg'
      );
      expect(mockScreenshotCapturer.captureAll).not.toHaveBeenCalled();
    });

    it('should use dev mode settings when enabled', async () => {
      mockContext.config = {
        screenshot: { interval: 60, quality: 'low' as const },
        dev: { enabled: true },
      } as any;

      await stage.execute(mockContext as PipelineContext);

      expect(ScreenshotCapturer).toHaveBeenCalledWith({
        ffmpeg: mockContext.ffmpeg,
        youtube: mockContext.youtube,
        config: mockContext.config.screenshot,
        tempDir: mockContext.tempDir,
        devQuality: '360p',
        devMaxScreenshots: 2,
        useThumbnails: true,
        onProgress: expect.any(Function),
      });
    });

    it('should call captureFromThumbnails in dev mode', async () => {
      mockContext.config = {
        screenshot: { interval: 60, quality: 'low' as const },
        dev: { enabled: true },
      } as any;

      await stage.execute(mockContext as PipelineContext);

      expect(mockScreenshotCapturer.captureFromThumbnails).toHaveBeenCalledWith(
        'test-video-id',
        120,
        2
      );
    });

    it('should fallback to captureAll when thumbnails fail in dev mode', async () => {
      mockContext.config = {
        screenshot: { interval: 60, quality: 'low' as const },
        dev: { enabled: true },
      } as any;

      mockScreenshotCapturer.captureFromThumbnails.mockRejectedValueOnce(
        new Error('Thumbnail failed')
      );

      await stage.execute(mockContext as PipelineContext);

      expect(mockScreenshotCapturer.captureFromThumbnails).toHaveBeenCalled();
      expect(mockScreenshotCapturer.captureAll).toHaveBeenCalledWith(
        'test-video-id',
        120,
        'http://example.com/thumb.jpg'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[DEV MODE] 썸네일 실패, FFmpeg 방식으로 폴백'
      );
    });

    it('should fallback to captureForChapters when thumbnails fail with chapters in dev mode', async () => {
      const chapters: Chapter[] = [
        { title: 'Chapter 1', startTime: 0, endTime: 60 },
      ];
      mockContext.chapters = chapters;
      mockContext.config = {
        screenshot: { interval: 60, quality: 'low' as const },
        dev: { enabled: true },
      } as any;

      mockScreenshotCapturer.captureFromThumbnails.mockRejectedValueOnce(
        new Error('Thumbnail failed')
      );

      await stage.execute(mockContext as PipelineContext);

      expect(mockScreenshotCapturer.captureFromThumbnails).toHaveBeenCalled();
      expect(mockScreenshotCapturer.captureForChapters).toHaveBeenCalledWith(
        'test-video-id',
        chapters,
        'http://example.com/thumb.jpg'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[DEV MODE] 썸네일 실패, FFmpeg 방식으로 폴백'
      );
    });

    it('should set context.useChapters to true when chapters exist', async () => {
      mockContext.chapters = [
        { title: 'Chapter 1', startTime: 0, endTime: 60 },
      ];

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.useChapters).toBe(true);
    });

    it('should set context.useChapters to false when no chapters', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.useChapters).toBe(false);
    });

    it('should set context.screenshots to the captured screenshots', async () => {
      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.screenshots).toEqual(mockScreenshots);
    });

    it('should report progress from ScreenshotCapturer onProgress callback', async () => {
      let progressCallback: ((current: number, total: number) => void) | undefined;

      (ScreenshotCapturer as jest.MockedClass<typeof ScreenshotCapturer>).mockImplementation(
        (options) => {
          progressCallback = options.onProgress;
          return mockScreenshotCapturer;
        }
      );

      await stage.execute(mockContext as PipelineContext);

      // Simulate progress callback from ScreenshotCapturer
      expect(progressCallback).toBeDefined();
      progressCallback!(1, 5);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '스크린샷 캡처 (1/5)',
        progress: 46, // 40 + (1/5 * 30)
      });

      progressCallback!(3, 5);
      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '스크린샷 캡처 (3/5)',
        progress: 58, // 40 + (3/5 * 30)
      });
    });
  });
});
