/**
 * Unit tests for SubtitleStage
 */

import { SubtitleStage } from '../../../../../src/core/pipeline/stages/subtitle-stage.js';
import { PipelineContext } from '../../../../../src/core/pipeline/types.js';
import { SubtitleExtractor } from '../../../../../src/core/subtitle-extractor.js';
import { logger } from '../../../../../src/utils/logger.js';
import { SubtitleSegment, SubtitleResult } from '../../../../../src/types/index.js';
import { ConfigSchema } from '../../../../../src/types/config.js';

// Mock dependencies
jest.mock('../../../../../src/core/subtitle-extractor.js');
jest.mock('../../../../../src/utils/logger.js');

const MockedSubtitleExtractor = SubtitleExtractor as jest.MockedClass<typeof SubtitleExtractor>;

describe('SubtitleStage', () => {
  let stage: SubtitleStage;
  let mockContext: PipelineContext;
  let mockExtractorInstance: jest.Mocked<SubtitleExtractor>;

  beforeEach(() => {
    jest.clearAllMocks();

    stage = new SubtitleStage();

    // Mock SubtitleExtractor instance
    mockExtractorInstance = {
      extract: jest.fn(),
    } as unknown as jest.Mocked<SubtitleExtractor>;

    MockedSubtitleExtractor.mockImplementation(() => mockExtractorInstance);

    // Base context
    const config = ConfigSchema.parse({});
    mockContext = {
      videoId: 'test-video-id',
      tempDir: '/tmp/test',
      config,
      options: { format: 'pdf' },
      youtube: {
        downloadAudio: jest.fn(),
      } as any,
      ffmpeg: {} as any,
      whisper: undefined,
      ai: undefined,
      unifiedProcessor: undefined,
      cache: {} as any,
      metadata: {
        videoId: 'test-video-id',
        title: 'Test Video',
        duration: 100,
        availableCaptions: ['en'],
        chapters: [],
      },
      onProgress: jest.fn(),
      traceEnabled: false,
      traceSteps: [],
    };
  });

  describe('name', () => {
    it('should be "subtitles"', () => {
      expect(stage.name).toBe('subtitles');
    });
  });

  describe('execute', () => {
    it('should call onProgress with subtitle extraction step', async () => {
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: [],
      };
      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);

      await stage.execute(mockContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        status: 'processing',
        currentStep: '자막 추출',
        progress: 20,
      });
    });

    it('should create SubtitleExtractor with correct options', async () => {
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: [],
      };
      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);

      await stage.execute(mockContext);

      expect(MockedSubtitleExtractor).toHaveBeenCalledWith({
        youtube: mockContext.youtube,
        whisper: mockContext.whisper,
        config: mockContext.config.subtitle,
        cache: mockContext.cache,
      });
    });

    it('should extract subtitles and set context fields', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
        { start: 5, end: 10, text: 'World' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };
      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);

      await stage.execute(mockContext);

      expect(mockExtractorInstance.extract).toHaveBeenCalledWith('test-video-id', undefined);
      expect(mockContext.subtitles).toEqual(mockSubtitles);
      expect(mockContext.processedSegments).toEqual(mockSegments);
    });

    it('should download audio when no captions and whisper exists', async () => {
      mockContext.metadata!.availableCaptions = [];
      mockContext.whisper = {} as any;
      (mockContext.youtube.downloadAudio as jest.Mock).mockResolvedValue('/tmp/audio.mp3');

      const mockSubtitles: SubtitleResult = {
        source: 'whisper',
        language: 'en',
        segments: [],
      };
      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);

      await stage.execute(mockContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '오디오 다운로드 (Whisper용)',
        progress: 25,
      });
      expect(mockContext.youtube.downloadAudio).toHaveBeenCalledWith('test-video-id', '/tmp/test');
      expect(mockExtractorInstance.extract).toHaveBeenCalledWith('test-video-id', '/tmp/audio.mp3');
    });

    it('should not download audio when captions exist', async () => {
      mockContext.metadata!.availableCaptions = ['en', 'ko'];
      mockContext.whisper = {} as any;

      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: [],
      };
      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);

      await stage.execute(mockContext);

      expect(mockContext.youtube.downloadAudio).not.toHaveBeenCalled();
      expect(mockExtractorInstance.extract).toHaveBeenCalledWith('test-video-id', undefined);
    });

    it('should translate when enabled, different language, and ai exists', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };
      const translatedSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: '안녕하세요', translation: 'Hello' },
      ];

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.translation.enabled = true;
      mockContext.config.translation.autoTranslate = true;
      mockContext.config.translation.defaultLanguage = 'ko';
      mockContext.ai = {
        translate: jest.fn().mockResolvedValue({ translatedSegments }),
      } as any;

      await stage.execute(mockContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '번역 중 (en → ko)',
        progress: 32,
      });
      expect(logger.info).toHaveBeenCalledWith('자막 번역: en → ko');
      expect(mockContext.ai.translate).toHaveBeenCalledWith(mockSegments, {
        sourceLanguage: 'en',
        targetLanguage: 'ko',
      });
      expect(mockContext.processedSegments).toEqual(translatedSegments);
      expect(logger.debug).toHaveBeenCalledWith('번역 완료: 1개 세그먼트');
    });

    it('should skip translation when subtitle language matches default', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: '안녕하세요' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'ko',
        segments: mockSegments,
      };

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.translation.enabled = true;
      mockContext.config.translation.autoTranslate = true;
      mockContext.config.translation.defaultLanguage = 'ko';
      mockContext.ai = {
        translate: jest.fn(),
      } as any;

      await stage.execute(mockContext);

      expect(mockContext.ai.translate).not.toHaveBeenCalled();
      expect(mockContext.processedSegments).toEqual(mockSegments);
    });

    it('should use original segments when translation fails', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.translation.enabled = true;
      mockContext.config.translation.autoTranslate = true;
      mockContext.config.translation.defaultLanguage = 'ko';
      mockContext.ai = {
        translate: jest.fn().mockRejectedValue(new Error('Translation failed')),
      } as any;

      await stage.execute(mockContext);

      expect(logger.warn).toHaveBeenCalledWith(
        '번역 실패, 원본 자막 사용',
        expect.any(Error)
      );
      expect(mockContext.processedSegments).toEqual(mockSegments);
    });

    it('should skip translation when dev mode enabled with skipTranslation', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.dev = { enabled: true };
      mockContext.config.translation.enabled = true;
      mockContext.config.translation.autoTranslate = true;
      mockContext.config.translation.defaultLanguage = 'ko';
      mockContext.ai = {
        translate: jest.fn(),
      } as any;

      await stage.execute(mockContext);

      expect(logger.info).toHaveBeenCalledWith('[DEV MODE] 자막 번역 생략');
      expect(mockContext.ai.translate).not.toHaveBeenCalled();
      expect(mockContext.processedSegments).toEqual(mockSegments);
    });

    it('should skip translation when translation disabled', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.translation.enabled = false;
      mockContext.ai = {
        translate: jest.fn(),
      } as any;

      await stage.execute(mockContext);

      expect(mockContext.ai.translate).not.toHaveBeenCalled();
      expect(mockContext.processedSegments).toEqual(mockSegments);
    });

    it('should skip translation when ai is undefined', async () => {
      const mockSegments: SubtitleSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
      ];
      const mockSubtitles: SubtitleResult = {
        source: 'youtube',
        language: 'en',
        segments: mockSegments,
      };

      mockExtractorInstance.extract.mockResolvedValue(mockSubtitles);
      mockContext.config.translation.enabled = true;
      mockContext.config.translation.autoTranslate = true;
      mockContext.ai = undefined;

      await stage.execute(mockContext);

      expect(mockContext.processedSegments).toEqual(mockSegments);
    });
  });
});
