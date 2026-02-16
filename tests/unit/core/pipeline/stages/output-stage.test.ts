/**
 * OutputStage unit tests
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

// Mock file utils
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockGetDateString = jest.fn().mockReturnValue('2026-01-01');
const mockGetTimestampString = jest.fn().mockReturnValue('20260101_120000');
const mockApplyFilenamePattern = jest.fn().mockReturnValue('test-video');
const mockGetFileSize = jest.fn().mockResolvedValue(12345);
jest.mock('../../../../../src/utils/file.js', () => ({
  ensureDir: mockEnsureDir,
  getDateString: mockGetDateString,
  getTimestampString: mockGetTimestampString,
  applyFilenamePattern: mockApplyFilenamePattern,
  getFileSize: mockGetFileSize,
}));

// Mock PDFGenerator
const mockGeneratePDF = jest.fn().mockResolvedValue(undefined);
const mockGenerateBriefPDF = jest.fn().mockResolvedValue(undefined);
const mockGenerateMarkdown = jest.fn().mockResolvedValue(undefined);
const mockGenerateHTML = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../../src/core/pdf-generator.js', () => ({
  PDFGenerator: jest.fn().mockImplementation(() => ({
    generatePDF: mockGeneratePDF,
    generateBriefPDF: mockGenerateBriefPDF,
    generateMarkdown: mockGenerateMarkdown,
    generateHTML: mockGenerateHTML,
  })),
}));

// Mock fs.promises.copyFile
const mockCopyFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs', () => ({
  promises: { copyFile: mockCopyFile },
}));

// ============================================================
// Imports
// ============================================================

import { OutputStage } from '../../../../../src/core/pipeline/stages/output-stage.js';
import { PipelineContext } from '../../../../../src/core/pipeline/types.js';
import { ConfigSchema } from '../../../../../src/types/config.js';
import { AIProvider } from '../../../../../src/providers/ai.js';
import { PDFGenerator } from '../../../../../src/core/pdf-generator.js';
import {
  VideoMetadata,
  PDFContent,
  Chapter,
  SubtitleSegment,
  ContentSummary,
  Screenshot,
} from '../../../../../src/types/index.js';

describe('OutputStage', () => {
  let stage: OutputStage;
  let mockContext: Partial<PipelineContext>;
  let mockAI: jest.Mocked<Pick<AIProvider, 'generateExecutiveBrief'>>;
  let defaultMetadata: VideoMetadata;
  let defaultContent: PDFContent;
  let defaultChapters: Chapter[];
  let defaultSegments: SubtitleSegment[];
  let defaultSummary: ContentSummary;
  let defaultScreenshots: Screenshot[];

  beforeEach(() => {
    jest.clearAllMocks();

    stage = new OutputStage();

    mockAI = {
      generateExecutiveBrief: jest.fn(),
    } as any;

    const defaultConfig = ConfigSchema.parse({});

    defaultMetadata = {
      id: 'test-video-id',
      title: 'Test Video Title',
      description: 'Test description',
      duration: 600,
      thumbnail: 'https://example.com/thumb.jpg',
      channel: 'Test Channel',
      uploadDate: '2026-01-01',
      viewCount: 1000,
      availableCaptions: [],
      videoType: 'educational',
    };

    defaultContent = {
      metadata: defaultMetadata,
      sections: [
        {
          screenshot: { imagePath: '/tmp/screenshots/frame_001.jpg', timestamp: 60 },
          subtitles: [{ start: 0, end: 60, text: 'Section 1 text', index: 0 }],
        },
        {
          screenshot: { imagePath: '/tmp/screenshots/frame_002.jpg', timestamp: 120 },
          subtitles: [{ start: 60, end: 120, text: 'Section 2 text', index: 1 }],
        },
      ],
    };

    defaultChapters = [
      { title: 'Chapter 1', startTime: 0 },
      { title: 'Chapter 2', startTime: 300 },
    ];

    defaultSegments = [
      { start: 0, end: 5, text: 'First segment', index: 0 },
      { start: 5, end: 10, text: 'Second segment', index: 1 },
    ];

    defaultSummary = {
      summary: 'This is a test summary',
      keyPoints: ['Point 1', 'Point 2'],
      language: 'ko',
    };

    defaultScreenshots = [
      { imagePath: '/tmp/screenshots/frame_001.jpg', timestamp: 60 },
      { imagePath: '/tmp/screenshots/frame_002.jpg', timestamp: 120 },
    ];

    mockContext = {
      videoId: 'test-video-id',
      options: { url: 'https://youtube.com/watch?v=test' },
      config: defaultConfig,
      metadata: defaultMetadata,
      content: defaultContent,
      chapters: defaultChapters,
      processedSegments: defaultSegments,
      summary: defaultSummary,
      screenshots: defaultScreenshots,
      ai: mockAI as any,
      onProgress: jest.fn(),
      traceEnabled: false,
      traceSteps: [],
    };
  });

  describe('name property', () => {
    it('should be "output"', () => {
      expect(stage.name).toBe('output');
    });
  });

  describe('execute() - routing', () => {
    it('should route to brief output when format is "brief"', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateBriefPDF).toHaveBeenCalled();
      expect(mockGeneratePDF).not.toHaveBeenCalled();
    });

    it('should route to standard output when format is "pdf"', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockGeneratePDF).toHaveBeenCalled();
      expect(mockGenerateBriefPDF).not.toHaveBeenCalled();
    });

    it('should use options.output for outputDir when specified', async () => {
      mockContext.options = {
        url: 'https://youtube.com/watch?v=test',
        format: 'pdf',
        output: '/custom/output/dir',
      };

      await stage.execute(mockContext as PipelineContext);

      expect(mockEnsureDir).toHaveBeenCalledWith('/custom/output/dir');
    });

    it('should fall back to config.output.directory when options.output not set', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };
      mockContext.config!.output.directory = './default-output';

      await stage.execute(mockContext as PipelineContext);

      expect(mockEnsureDir).toHaveBeenCalledWith('./default-output');
    });

    it('should fall back to config.output.format when options.format not set', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test' };
      mockContext.config!.output.format = 'md';

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateMarkdown).toHaveBeenCalled();
      expect(mockGeneratePDF).not.toHaveBeenCalled();
    });

    it('should call applyFilenamePattern with correct values', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };
      mockContext.config!.output.filenamePattern = '{title}_{date}';

      await stage.execute(mockContext as PipelineContext);

      expect(mockApplyFilenamePattern).toHaveBeenCalledWith('{title}_{date}', {
        date: '2026-01-01',
        timestamp: '20260101_120000',
        videoId: 'test-video-id',
        channel: 'Test Channel',
        index: '001',
        title: 'Test Video Title',
      });
    });
  });

  describe('execute() - brief output', () => {
    beforeEach(() => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
    });

    it('should call ai.generateExecutiveBrief when AI and chapters available', async () => {
      const mockBrief = {
        title: 'AI Generated Brief',
        metadata: {
          channel: 'Test Channel',
          duration: 600,
          videoType: 'educational' as const,
          uploadDate: '2026-01-01',
          videoId: 'test-video-id',
        },
        summary: 'AI summary',
        keyTakeaways: ['Takeaway 1'],
        chapterSummaries: [{ title: 'Ch1', startTime: 0, summary: 'Summary 1' }],
      };
      mockAI.generateExecutiveBrief.mockResolvedValue(mockBrief);

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.generateExecutiveBrief).toHaveBeenCalledWith(
        defaultMetadata,
        defaultChapters,
        defaultSegments,
        { language: expect.any(String) }
      );
      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(mockBrief, expect.stringContaining('_brief.pdf'));
    });

    it('should use fallback brief when no AI provider', async () => {
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Video Title',
          summary: 'This is a test summary',
          keyTakeaways: ['Point 1', 'Point 2'],
        }),
        expect.stringContaining('_brief.pdf')
      );
    });

    it('should use fallback brief when no chapters', async () => {
      mockContext.chapters = [];

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.generateExecutiveBrief).not.toHaveBeenCalled();
      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Video Title',
          chapterSummaries: [],
        }),
        expect.stringContaining('_brief.pdf')
      );
    });

    it('should use fallback summary text when no summary provided', async () => {
      mockContext.ai = undefined;
      mockContext.summary = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: '요약을 생성할 수 없습니다.',
          keyTakeaways: [],
        }),
        expect.any(String)
      );
    });

    it('should use summary.language when set', async () => {
      mockContext.config!.summary.language = 'en';

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.generateExecutiveBrief).toHaveBeenCalledWith(
        defaultMetadata,
        defaultChapters,
        defaultSegments,
        { language: 'en' }
      );
    });

    it('should fall back to translation.defaultLanguage when summary.language not set', async () => {
      mockContext.config!.summary.language = undefined;
      mockContext.config!.translation.defaultLanguage = 'ja';

      await stage.execute(mockContext as PipelineContext);

      expect(mockAI.generateExecutiveBrief).toHaveBeenCalledWith(
        defaultMetadata,
        defaultChapters,
        defaultSegments,
        { language: 'ja' }
      );
    });

    it('should store result with screenshotCount 0', async () => {
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.result).toEqual(
        expect.objectContaining({
          success: true,
          stats: expect.objectContaining({
            pages: 1,
            screenshotCount: 0,
            fileSize: 12345,
            duration: 600,
          }),
        })
      );
    });
  });

  describe('execute() - standard output', () => {
    it('should generate PDF for pdf format', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockGeneratePDF).toHaveBeenCalledWith(defaultContent, expect.stringContaining('.pdf'));
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('should generate Markdown and copy images for md format', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'md' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateMarkdown).toHaveBeenCalledWith(defaultContent, expect.stringContaining('.md'));
      // Should copy images for each section
      expect(mockCopyFile).toHaveBeenCalledTimes(2);
      expect(mockEnsureDir).toHaveBeenCalledWith(expect.stringContaining('images'));
    });

    it('should generate HTML and copy images for html format', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'html' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateHTML).toHaveBeenCalledWith(defaultContent, expect.stringContaining('.html'));
      expect(mockCopyFile).toHaveBeenCalledTimes(2);
    });

    it('should use correct extension for each format', async () => {
      // PDF
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };
      await stage.execute(mockContext as PipelineContext);
      expect(mockGeneratePDF).toHaveBeenCalledWith(defaultContent, expect.stringMatching(/test-video\.pdf$/));

      jest.clearAllMocks();

      // MD
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'md' };
      await stage.execute(mockContext as PipelineContext);
      expect(mockGenerateMarkdown).toHaveBeenCalledWith(
        defaultContent,
        expect.stringMatching(/test-video\.md$/)
      );

      jest.clearAllMocks();

      // HTML
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'html' };
      await stage.execute(mockContext as PipelineContext);
      expect(mockGenerateHTML).toHaveBeenCalledWith(
        defaultContent,
        expect.stringMatching(/test-video\.html$/)
      );
    });

    it('should store result with correct stats', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.result).toEqual({
        success: true,
        outputPath: expect.stringContaining('test-video.pdf'),
        metadata: defaultMetadata,
        stats: {
          pages: 2, // content.sections.length
          fileSize: 12345,
          duration: 600,
          screenshotCount: 2, // screenshots.length
        },
      });
    });
  });

  describe('onProgress calls', () => {
    it('should call onProgress with status generating and progress 80', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        status: 'generating',
        currentStep: 'PDF 생성',
        progress: 80,
      });
    });

    it('should call onProgress with status complete and progress 100 after standard output', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        status: 'complete',
        currentStep: '완료',
        progress: 100,
      });
    });

    it('should call onProgress with Executive Brief step for brief format', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        currentStep: 'Executive Brief 생성',
        progress: 82,
      });
    });

    it('should call onProgress with complete after brief output', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.onProgress).toHaveBeenCalledWith({
        status: 'complete',
        currentStep: '완료',
        progress: 100,
      });
    });
  });

  describe('PDFGenerator instantiation', () => {
    it('should create PDFGenerator with config.pdf', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };

      await stage.execute(mockContext as PipelineContext);

      expect(PDFGenerator).toHaveBeenCalledWith(mockContext.config!.pdf);
    });
  });

  describe('edge cases', () => {
    it('should handle missing chapters gracefully (default to empty array)', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
      mockContext.chapters = undefined;
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterSummaries: [],
        }),
        expect.any(String)
      );
    });

    it('should handle missing screenshots gracefully (default to empty array)', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'pdf' };
      mockContext.screenshots = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.result).toEqual(
        expect.objectContaining({
          stats: expect.objectContaining({
            screenshotCount: 0,
          }),
        })
      );
    });

    it('should handle missing processedSegments gracefully', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
      mockContext.processedSegments = undefined;
      mockContext.ai = undefined;

      await stage.execute(mockContext as PipelineContext);

      expect(mockContext.result).toBeDefined();
      expect(mockContext.result!.success).toBe(true);
    });

    it('should use fallback videoType "unknown" when metadata.videoType is undefined', async () => {
      mockContext.options = { url: 'https://youtube.com/watch?v=test', format: 'brief' };
      mockContext.ai = undefined;
      const metadataNoType = { ...defaultMetadata, videoType: undefined };
      mockContext.metadata = metadataNoType as any;

      await stage.execute(mockContext as PipelineContext);

      expect(mockGenerateBriefPDF).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            videoType: 'unknown',
          }),
        }),
        expect.any(String)
      );
    });
  });
});
