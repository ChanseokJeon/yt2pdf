/**
 * 콘텐츠 병합기 - 스크린샷과 자막을 타임스탬프 기준으로 병합
 */

import { VideoMetadata, SubtitleResult, Screenshot, PDFContent, PDFSection, SubtitleSegment } from '../types/index.js';
import { ScreenshotConfig } from '../types/config.js';

export interface ContentMergerOptions {
  screenshotConfig: ScreenshotConfig;
}

export class ContentMerger {
  private screenshotInterval: number;

  constructor(options: ContentMergerOptions) {
    this.screenshotInterval = options.screenshotConfig.interval;
  }

  /**
   * 콘텐츠 병합
   */
  merge(
    metadata: VideoMetadata,
    subtitles: SubtitleResult,
    screenshots: Screenshot[]
  ): PDFContent {
    const sections: PDFSection[] = [];

    for (const screenshot of screenshots) {
      // 해당 스크린샷 시점의 자막 찾기
      const relevantSubtitles = this.findRelevantSubtitles(
        subtitles.segments,
        screenshot.timestamp,
        this.screenshotInterval
      );

      sections.push({
        timestamp: screenshot.timestamp,
        screenshot,
        subtitles: relevantSubtitles,
      });
    }

    return {
      metadata,
      sections,
    };
  }

  /**
   * 해당 시간대의 자막 찾기
   */
  private findRelevantSubtitles(
    segments: SubtitleSegment[],
    startTime: number,
    interval: number
  ): SubtitleSegment[] {
    const endTime = startTime + interval;

    return segments.filter((seg) => {
      // 자막이 해당 구간과 겹치는 경우
      return (
        (seg.start >= startTime && seg.start < endTime) || // 자막 시작이 구간 내
        (seg.end > startTime && seg.end <= endTime) || // 자막 끝이 구간 내
        (seg.start <= startTime && seg.end >= endTime) // 자막이 구간을 포함
      );
    });
  }

  /**
   * 자막 텍스트 결합 (중복 제거)
   */
  combineSubtitleText(subtitles: SubtitleSegment[]): string {
    const uniqueTexts: string[] = [];

    for (const sub of subtitles) {
      const text = sub.text.trim();
      if (text && !uniqueTexts.includes(text)) {
        uniqueTexts.push(text);
      }
    }

    return uniqueTexts.join(' ');
  }

  /**
   * 챕터/섹션으로 그룹화 (향후 확장용)
   */
  groupByChapter(
    sections: PDFSection[],
    chapterDuration: number = 300 // 5분 기본
  ): PDFSection[][] {
    const chapters: PDFSection[][] = [];
    let currentChapter: PDFSection[] = [];
    let chapterStart = 0;

    for (const section of sections) {
      if (section.timestamp >= chapterStart + chapterDuration && currentChapter.length > 0) {
        chapters.push(currentChapter);
        currentChapter = [];
        chapterStart = section.timestamp;
      }
      currentChapter.push(section);
    }

    if (currentChapter.length > 0) {
      chapters.push(currentChapter);
    }

    return chapters;
  }
}
