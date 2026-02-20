/**
 * OutputStage - Generates final output (PDF, MD, HTML, Brief)
 *
 * Extracted from Orchestrator.generateOutput / generateBriefOutput / generateStandardOutput.
 * Reads all data from PipelineContext and stores ConvertResult on context.result.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PipelineStage, PipelineContext } from '../types.js';
import { PDFGenerator } from '../../pdf-generator.js';
import { ConvertResult, ExecutiveBrief } from '../../../types/index.js';
import {
  ensureDir,
  getDateString,
  getTimestampString,
  applyFilenamePattern,
  getFileSize,
} from '../../../utils/file.js';

export class OutputStage implements PipelineStage {
  readonly name = 'output';

  async execute(context: PipelineContext): Promise<void> {
    const { options, config, videoId } = context;
    const metadata = context.metadata!;
    const content = context.content!;
    const chapters = context.chapters || [];
    const processedSegments = context.processedSegments || [];
    const summary = context.summary;
    const screenshots = context.screenshots || [];

    context.onProgress({ status: 'generating', currentStep: 'PDF 생성', progress: 80 });

    const outputDir = options.output || config.output.directory;
    await ensureDir(outputDir);

    const filename = applyFilenamePattern(config.output.filenamePattern, {
      date: getDateString(),
      timestamp: getTimestampString(),
      videoId: videoId,
      channel: metadata.channel,
      index: '001',
      title: metadata.title,
    });

    const format = options.format || config.output.format;
    const pdfGenerator = new PDFGenerator({
      ...config.pdf,
      imageQuality: config.screenshot.quality,
    });

    let result: ConvertResult;

    if (format === 'brief') {
      result = await this.generateBriefOutput(
        context,
        outputDir,
        filename,
        metadata,
        chapters,
        processedSegments,
        summary,
        pdfGenerator
      );
    } else {
      result = await this.generateStandardOutput(
        context,
        outputDir,
        filename,
        format,
        metadata,
        content,
        screenshots,
        pdfGenerator
      );
    }

    context.result = result;
  }

  private async generateBriefOutput(
    context: PipelineContext,
    outputDir: string,
    filename: string,
    metadata: NonNullable<PipelineContext['metadata']>,
    chapters: NonNullable<PipelineContext['chapters']>,
    processedSegments: NonNullable<PipelineContext['processedSegments']>,
    summary: PipelineContext['summary'],
    pdfGenerator: PDFGenerator
  ): Promise<ConvertResult> {
    context.onProgress({ currentStep: 'Executive Brief 생성', progress: 82 });

    let brief: ExecutiveBrief;
    if (context.ai && chapters.length > 0) {
      const summaryLang =
        context.config.summary.language || context.config.translation.defaultLanguage;
      brief = await context.ai.generateExecutiveBrief(metadata, chapters, processedSegments, {
        language: summaryLang,
      });
    } else {
      brief = {
        title: metadata.title,
        metadata: {
          channel: metadata.channel,
          duration: metadata.duration,
          videoType: metadata.videoType || 'unknown',
          uploadDate: metadata.uploadDate,
          videoId: metadata.id,
        },
        summary: summary?.summary || '요약을 생성할 수 없습니다.',
        keyTakeaways: summary?.keyPoints || [],
        chapterSummaries: chapters.map((c) => ({
          title: c.title,
          startTime: c.startTime,
          summary: '',
        })),
      };
    }

    const outputPath = path.join(outputDir, `${filename}_brief.pdf`);
    await pdfGenerator.generateBriefPDF(brief, outputPath);

    context.onProgress({ status: 'complete', currentStep: '완료', progress: 100 });

    const fileSize = await getFileSize(outputPath);
    return {
      success: true,
      outputPath,
      metadata,
      stats: {
        pages: 1,
        fileSize,
        duration: metadata.duration,
        screenshotCount: 0,
      },
    };
  }

  private async generateStandardOutput(
    context: PipelineContext,
    outputDir: string,
    filename: string,
    format: string,
    metadata: NonNullable<PipelineContext['metadata']>,
    content: NonNullable<PipelineContext['content']>,
    screenshots: NonNullable<PipelineContext['screenshots']>,
    pdfGenerator: PDFGenerator
  ): Promise<ConvertResult> {
    const extension = format === 'pdf' ? 'pdf' : format === 'md' ? 'md' : 'html';
    const outputPath = path.join(outputDir, `${filename}.${extension}`);

    if (format === 'pdf') {
      await pdfGenerator.generatePDF(content, outputPath);
    } else {
      // md, html: copy images
      const imagesDir = path.join(outputDir, 'images');
      await ensureDir(imagesDir);
      for (const section of content.sections) {
        const imgName = path.basename(section.screenshot.imagePath);
        const destPath = path.join(imagesDir, imgName);
        await fs.promises.copyFile(section.screenshot.imagePath, destPath);
      }

      if (format === 'md') {
        await pdfGenerator.generateMarkdown(content, outputPath);
      } else {
        await pdfGenerator.generateHTML(content, outputPath);
      }
    }

    context.onProgress({ status: 'complete', currentStep: '완료', progress: 100 });

    const fileSize = await getFileSize(outputPath);
    return {
      success: true,
      outputPath,
      metadata,
      stats: {
        pages: content.sections.length,
        fileSize,
        duration: metadata.duration,
        screenshotCount: screenshots.length,
      },
    };
  }
}
