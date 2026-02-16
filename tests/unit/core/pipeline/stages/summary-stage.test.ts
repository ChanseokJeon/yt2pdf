/**
 * SummaryStage unit tests
 */

// ============================================================
// jest.mock() calls MUST come before imports
// ============================================================

const mockLoggerInfo = jest.fn();
const mockLoggerDebug = jest.fn();
const mockLoggerWarn = jest.fn();
jest.mock('../../../../../src/utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
  },
}));

// ============================================================
// Imports
// ============================================================

import { SummaryStage } from '../../../../../src/core/pipeline/stages/summary-stage.js';
import { PipelineContext } from '../../../../../src/core/pipeline/types.js';
import { ConfigSchema } from '../../../../../src/types/config.js';
import { SubtitleSegment } from '../../../../../src/types/index.js';
import { AIProvider } from '../../../../../src/providers/ai.js';

describe('SummaryStage', () => {
  let stage: SummaryStage;
  let mockContext: Partial<PipelineContext>;
  let mockAI: jest.Mocked<AIProvider>;

  beforeEach(() => {
    jest.clearAllMocks();

    stage = new SummaryStage();

    mockAI = {
      summarize: jest.fn(),
    } as any;

    const defaultConfig = ConfigSchema.parse({});
    // Enable summary by default for tests
    defaultConfig.summary.enabled = true;

    const sampleSegments: SubtitleSegment[] = [
      { start: 0, end: 5, text: 'First segment', index: 0 },
      { start: 5, end: 10, text: 'Second segment', index: 1 },
    ];

    mockContext = {
      config: defaultConfig,
      ai: mockAI,
      processedSegments: sampleSegments,
      onProgress: jest.fn(),
      traceEnabled: false,
      traceSteps: [],
    };
  });

  describe('name property', () => {
    it('should be "summary"', () => {
      expect(stage.name).toBe('summary');
    });
  });

  describe('execute()', () => {
    it('should skip when summary is disabled', async () => {
      mockContext.config!.summary.enabled = false;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.summary).toBeUndefined();
      expect(mockAI.summarize).not.toHaveBeenCalled();
    });

    it('should skip when no AI provider', async () => {
      mockContext.config!.summary.enabled = true;
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.summary).toBeUndefined();
    });

    it('should skip when no processedSegments', async () => {
      mockContext.config!.summary.enabled = true;
      mockContext.processedSegments = [];

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.summary).toBeUndefined();
      expect(mockAI.summarize).not.toHaveBeenCalled();
    });

    it('should return dev placeholder when dev mode enabled', async () => {
      mockContext.config!.summary.enabled = true;
      mockContext.config!.dev = { enabled: true };

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.summary).toEqual({
        summary: '[DEV MODE] 전체 요약 생략됨',
        keyPoints: ['[DEV MODE] 섹션 요약 참조'],
        language: 'ko',
      });
      expect(mockLoggerInfo).toHaveBeenCalledWith('[DEV MODE] 전체 요약 생략');
      expect(mockAI.summarize).not.toHaveBeenCalled();
    });

    it('should generate summary successfully', async () => {
      const mockSummaryResult = {
        summary: 'This is a test summary',
        keyPoints: ['Point 1', 'Point 2', 'Point 3'],
        language: 'ko',
      };

      mockAI.summarize.mockResolvedValue(mockSummaryResult);

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.summarize).toHaveBeenCalledWith(mockContext.processedSegments, {
        maxLength: mockContext.config!.summary.maxLength,
        style: mockContext.config!.summary.style,
        language: mockContext.config!.translation.defaultLanguage,
      });

      expect(mockContext.summary).toEqual({
        summary: 'This is a test summary',
        keyPoints: ['Point 1', 'Point 2', 'Point 3'],
        language: 'ko',
      });

      expect(mockLoggerDebug).toHaveBeenCalledWith('요약 생성 완료: 22자');
    });

    it('should call onProgress with correct parameters', async () => {
      const mockSummaryResult = {
        summary: 'Test summary',
        keyPoints: ['Point 1'],
        language: 'ko',
      };

      mockAI.summarize.mockResolvedValue(mockSummaryResult);

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: '요약 생성',
        progress: 36,
      });
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('AI service unavailable');
      mockAI.summarize.mockRejectedValue(error);

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.summary).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith('요약 생성 실패', error);
    });

    it('should use summary.language when specified', async () => {
      mockContext.config!.summary.language = 'en';

      const mockSummaryResult = {
        summary: 'English summary',
        keyPoints: ['Point 1'],
        language: 'en',
      };

      mockAI.summarize.mockResolvedValue(mockSummaryResult);

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.summarize).toHaveBeenCalledWith(mockContext.processedSegments, {
        maxLength: mockContext.config!.summary.maxLength,
        style: mockContext.config!.summary.style,
        language: 'en',
      });
    });

    it('should fallback to translation.defaultLanguage when summary.language not set', async () => {
      mockContext.config!.summary.language = undefined;
      mockContext.config!.translation.defaultLanguage = 'ja';

      const mockSummaryResult = {
        summary: 'Japanese summary',
        keyPoints: ['Point 1'],
        language: 'ja',
      };

      mockAI.summarize.mockResolvedValue(mockSummaryResult);

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.summarize).toHaveBeenCalledWith(mockContext.processedSegments, {
        maxLength: mockContext.config!.summary.maxLength,
        style: mockContext.config!.summary.style,
        language: 'ja',
      });
    });
  });
});
