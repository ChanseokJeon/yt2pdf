/**
 * ContentProcessingStage unit tests
 */

// ============================================================
// jest.mock() calls MUST come before imports
// ============================================================

const mockMerge = jest.fn();
const mockMergeWithChapters = jest.fn();
jest.mock('../../../../../src/core/content-merger.js', () => ({
  ContentMerger: jest.fn().mockImplementation(() => ({
    merge: mockMerge,
    mergeWithChapters: mockMergeWithChapters,
  })),
}));

const mockLoggerInfo = jest.fn();
const mockLoggerDebug = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerSuccess = jest.fn();
jest.mock('../../../../../src/utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    success: mockLoggerSuccess,
  },
}));

// ============================================================
// Imports
// ============================================================

import { ContentProcessingStage } from '../../../../../src/core/pipeline/stages/content-processing-stage.js';
import { ContentMerger } from '../../../../../src/core/content-merger.js';
import { PipelineContext } from '../../../../../src/core/pipeline/types.js';
import { ConfigSchema } from '../../../../../src/types/config.js';
import { AIProvider } from '../../../../../src/providers/ai.js';
import { UnifiedContentProcessor } from '../../../../../src/providers/unified-ai.js';

// ============================================================
// Helpers
// ============================================================

function makeBaseContent(sectionCount = 2) {
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    timestamp: i * 60,
    subtitles: [{ start: i * 60, end: i * 60 + 30, text: `Segment ${i}`, index: i }],
    screenshots: [],
  }));
  return {
    title: 'Test Video',
    sections,
    metadata: { title: 'Test Video', duration: 600 },
  };
}

function makeContext(overrides: Partial<PipelineContext> = {}): Partial<PipelineContext> {
  const defaultConfig = ConfigSchema.parse({});
  defaultConfig.summary.enabled = true;
  defaultConfig.summary.perSection = true;

  return {
    videoId: 'test-video-id',
    config: defaultConfig,
    metadata: { title: 'Test Video', duration: 600 } as any,
    subtitles: { language: 'en', segments: [], source: 'youtube' as const } as any,
    processedSegments: [
      { start: 0, end: 30, text: 'First segment', index: 0 },
      { start: 60, end: 90, text: 'Second segment', index: 1 },
    ],
    screenshots: [{ timestamp: 0, path: '/tmp/s1.jpg' }] as any,
    chapters: [],
    summary: undefined,
    useChapters: false,
    ai: undefined,
    unifiedProcessor: undefined,
    onProgress: jest.fn(),
    traceEnabled: false,
    traceSteps: [],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('ContentProcessingStage', () => {
  let stage: ContentProcessingStage;

  beforeEach(() => {
    jest.clearAllMocks();
    stage = new ContentProcessingStage();

    // Default: merge returns base content
    mockMerge.mockReturnValue(makeBaseContent());
    mockMergeWithChapters.mockReturnValue(makeBaseContent());
  });

  // ----------------------------------------------------------
  // 1. name
  // ----------------------------------------------------------
  describe('name property', () => {
    it('should be "content-processing"', () => {
      expect(stage.name).toBe('content-processing');
    });
  });

  // ----------------------------------------------------------
  // Merging tests (2-6)
  // ----------------------------------------------------------
  describe('content merging', () => {
    it('should call onProgress with correct parameters', async () => {
      const ctx = makeContext();
      await stage.execute(ctx as PipelineContext);

      expect(ctx.onProgress).toHaveBeenCalledWith({
        currentStep: '콘텐츠 병합',
        progress: 75,
      });
    });

    it('should use mergeWithChapters when useChapters is true', async () => {
      const ctx = makeContext({ useChapters: true, chapters: [{ title: 'Ch1', startTime: 0 }] as any });
      await stage.execute(ctx as PipelineContext);

      expect(mockMergeWithChapters).toHaveBeenCalledWith(
        ctx.metadata,
        expect.objectContaining({ segments: ctx.processedSegments }),
        ctx.screenshots,
        ctx.chapters
      );
      expect(mockMerge).not.toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('챕터 기준 콘텐츠 병합'));
    });

    it('should use merge when useChapters is false', async () => {
      const ctx = makeContext({ useChapters: false });
      await stage.execute(ctx as PipelineContext);

      expect(mockMerge).toHaveBeenCalledWith(
        ctx.metadata,
        expect.objectContaining({ segments: ctx.processedSegments }),
        ctx.screenshots
      );
      expect(mockMergeWithChapters).not.toHaveBeenCalled();
    });

    it('should attach summary when context.summary exists', async () => {
      const summaryObj = { summary: 'Global summary', keyPoints: ['P1'], language: 'ko' };
      const ctx = makeContext({ summary: summaryObj as any });

      const content = makeBaseContent();
      mockMerge.mockReturnValue(content);

      await stage.execute(ctx as PipelineContext);

      expect(content.summary).toEqual(summaryObj);
    });

    it('should set context.content with the result', async () => {
      const content = makeBaseContent();
      mockMerge.mockReturnValue(content);

      const ctx = makeContext();
      await stage.execute(ctx as PipelineContext);

      expect(ctx.content).toBe(content);
    });
  });

  // ----------------------------------------------------------
  // Unified AI tests (7-14)
  // ----------------------------------------------------------
  describe('processUnifiedAI (via execute)', () => {
    let mockUnifiedProcessor: jest.Mocked<Partial<UnifiedContentProcessor>>;

    beforeEach(() => {
      mockUnifiedProcessor = {
        processAllSections: jest.fn().mockResolvedValue({
          sections: new Map(),
          globalSummary: undefined,
          totalTokensUsed: 100,
        }),
      };
    });

    it('should skip when no unifiedProcessor', async () => {
      const ctx = makeContext({ unifiedProcessor: undefined });
      await stage.execute(ctx as PipelineContext);

      // No AI processing calls should happen
      expect(mockLoggerInfo).not.toHaveBeenCalledWith('통합 AI 처리 시작...');
    });

    it('should skip when summary not enabled', async () => {
      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });
      ctx.config!.summary.enabled = false;

      await stage.execute(ctx as PipelineContext);

      expect(mockUnifiedProcessor.processAllSections).not.toHaveBeenCalled();
    });

    it('should skip when no sections', async () => {
      const emptyContent = makeBaseContent(0);
      mockMerge.mockReturnValue(emptyContent);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });

      await stage.execute(ctx as PipelineContext);

      expect(mockUnifiedProcessor.processAllSections).not.toHaveBeenCalled();
    });

    it('should call processAllSections with correct args', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });

      await stage.execute(ctx as PipelineContext);

      expect(mockUnifiedProcessor.processAllSections).toHaveBeenCalledWith(
        content.sections.map((s) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        expect.objectContaining({
          videoId: 'test-video-id',
          sourceLanguage: 'en',
          includeQuotes: true,
        })
      );
    });

    it('should apply enhanced results to sections', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      const sectionsMap = new Map();
      sectionsMap.set(0, {
        oneLiner: 'Section 0 summary',
        keyPoints: ['KP1'],
        mainInformation: 'Main info',
        notableQuotes: [{ text: 'Quote 1' }],
      });
      sectionsMap.set(60, {
        oneLiner: 'Section 1 summary',
        keyPoints: ['KP2'],
        mainInformation: 'Main info 2',
        notableQuotes: [],
      });

      mockUnifiedProcessor.processAllSections!.mockResolvedValue({
        sections: sectionsMap,
        globalSummary: undefined,
        totalTokensUsed: 200,
      } as any);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });
      await stage.execute(ctx as PipelineContext);

      expect(content.sections[0].sectionSummary).toEqual({
        summary: 'Section 0 summary',
        keyPoints: ['KP1'],
        mainInformation: 'Main info',
        notableQuotes: ['Quote 1'],
      });
      expect(content.sections[1].sectionSummary).toEqual({
        summary: 'Section 1 summary',
        keyPoints: ['KP2'],
        mainInformation: 'Main info 2',
        notableQuotes: [],
      });
    });

    it('should sample sections in dev mode and set placeholders for skipped', async () => {
      // DEV_MODE_SETTINGS.aiSampleSections = 1, so need > 1 sections
      const content = makeBaseContent(3);
      mockMerge.mockReturnValue(content);

      const sectionsMap = new Map();
      sectionsMap.set(0, {
        oneLiner: 'Processed section',
        keyPoints: ['KP1'],
        mainInformation: 'Info',
        notableQuotes: [],
      });

      mockUnifiedProcessor.processAllSections!.mockResolvedValue({
        sections: sectionsMap,
        globalSummary: undefined,
        totalTokensUsed: 50,
      } as any);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });
      ctx.config!.dev = { enabled: true };

      await stage.execute(ctx as PipelineContext);

      // Only first section should be processed (aiSampleSections = 1)
      expect(mockUnifiedProcessor.processAllSections).toHaveBeenCalledWith(
        [{ timestamp: 0, subtitles: content.sections[0].subtitles }],
        expect.any(Object)
      );

      // First section: AI processed
      expect(content.sections[0].sectionSummary).toEqual({
        summary: 'Processed section',
        keyPoints: ['KP1'],
        mainInformation: 'Info',
        notableQuotes: [],
      });

      // Skipped sections: placeholders
      expect(content.sections[1].sectionSummary).toEqual({
        summary: '[DEV MODE: AI 샘플링 - 요약 생략됨]',
        keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
      });
      expect(content.sections[2].sectionSummary).toEqual({
        summary: '[DEV MODE: AI 샘플링 - 요약 생략됨]',
        keyPoints: ['[DEV MODE: AI 처리 생략됨]'],
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('[DEV MODE] AI:')
      );
    });

    it('should set content.summary from globalSummary when not already set', async () => {
      const content = makeBaseContent(1);
      // No summary on content
      delete (content as any).summary;
      mockMerge.mockReturnValue(content);

      mockUnifiedProcessor.processAllSections!.mockResolvedValue({
        sections: new Map(),
        globalSummary: {
          summary: 'Global AI summary',
          keyPoints: ['GP1'],
        },
        totalTokensUsed: 100,
      } as any);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });
      await stage.execute(ctx as PipelineContext);

      expect((content as any).summary).toEqual({
        summary: 'Global AI summary',
        keyPoints: ['GP1'],
        language: ctx.config!.translation.defaultLanguage,
      });
    });

    it('should handle processAllSections error gracefully', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      const error = new Error('AI processing failed');
      mockUnifiedProcessor.processAllSections!.mockRejectedValue(error);

      const ctx = makeContext({ unifiedProcessor: mockUnifiedProcessor as any });

      // Should not throw
      await stage.execute(ctx as PipelineContext);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        '통합 AI 처리 실패, 기존 방식으로 폴백',
        error
      );
    });
  });

  // ----------------------------------------------------------
  // Section summaries fallback tests (15-18)
  // ----------------------------------------------------------
  describe('processSectionSummaries fallback (via execute)', () => {
    let mockAI: jest.Mocked<Partial<AIProvider>>;

    beforeEach(() => {
      mockAI = {
        summarizeSections: jest.fn().mockResolvedValue([]),
      };
    });

    it('should skip when unifiedProcessor exists (mutual exclusion)', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      const mockUnifiedProcessor = {
        processAllSections: jest.fn().mockResolvedValue({
          sections: new Map(),
          globalSummary: undefined,
          totalTokensUsed: 0,
        }),
      };

      const ctx = makeContext({
        ai: mockAI as any,
        unifiedProcessor: mockUnifiedProcessor as any,
      });

      await stage.execute(ctx as PipelineContext);

      expect(mockAI.summarizeSections).not.toHaveBeenCalled();
    });

    it('should call ai.summarizeSections when no unifiedProcessor', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      mockAI.summarizeSections!.mockResolvedValue([
        { timestamp: 0, summary: 'Summary 0', keyPoints: ['KP0'] },
        { timestamp: 60, summary: 'Summary 1', keyPoints: ['KP1'] },
      ]);

      const ctx = makeContext({
        ai: mockAI as any,
        unifiedProcessor: undefined,
      });

      await stage.execute(ctx as PipelineContext);

      expect(mockAI.summarizeSections).toHaveBeenCalledWith(
        content.sections.map((s) => ({ timestamp: s.timestamp, subtitles: s.subtitles })),
        expect.objectContaining({
          language: ctx.config!.translation.defaultLanguage,
          maxSummaryLength: ctx.config!.summary.sectionMaxLength,
          maxKeyPoints: ctx.config!.summary.sectionKeyPoints,
        })
      );

      expect(content.sections[0].sectionSummary).toEqual({
        summary: 'Summary 0',
        keyPoints: ['KP0'],
      });
      expect(content.sections[1].sectionSummary).toEqual({
        summary: 'Summary 1',
        keyPoints: ['KP1'],
      });
    });

    it('should preserve chapter titles when useChapters is true', async () => {
      const content = makeBaseContent(1);
      // Set existing sectionSummary with a title
      content.sections[0].sectionSummary = { summary: 'Chapter Title' } as any;
      mockMergeWithChapters.mockReturnValue(content);

      mockAI.summarizeSections!.mockResolvedValue([
        { timestamp: 0, summary: 'New Summary', keyPoints: ['KP1'] },
      ]);

      const ctx = makeContext({
        ai: mockAI as any,
        unifiedProcessor: undefined,
        useChapters: true,
      });

      await stage.execute(ctx as PipelineContext);

      // sectionSummary should be overwritten
      expect(content.sections[0].sectionSummary).toEqual({
        summary: 'New Summary',
        keyPoints: ['KP1'],
      });
      // But chapterTitle should be preserved from existing summary
      expect((content.sections[0] as any).chapterTitle).toBe('Chapter Title');
    });

    it('should handle summarizeSections error gracefully', async () => {
      const content = makeBaseContent(2);
      mockMerge.mockReturnValue(content);

      const error = new Error('AI summarize failed');
      mockAI.summarizeSections!.mockRejectedValue(error);

      const ctx = makeContext({
        ai: mockAI as any,
        unifiedProcessor: undefined,
      });

      // Should not throw
      await stage.execute(ctx as PipelineContext);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('요약 생성 실패'),
        error
      );
    });
  });
});
