/**
 * 콘텐츠 병합기 - 스크린샷과 자막을 타임스탬프 기준으로 병합
 */

import { VideoMetadata, SubtitleResult, Screenshot, PDFContent, PDFSection, SubtitleSegment, Chapter } from '../types/index.js';
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
   * 콘텐츠 병합 (interval 기준)
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

      // 자막이 충분한 섹션만 추가 (빈 페이지 방지)
      // 조건: 단어 수 5개 이상 또는 구간 대비 음성 비율 10% 이상
      const totalText = relevantSubtitles.map(s => s.text).join(' ');
      const wordCount = totalText.split(/\s+/).filter(w => w.length > 0).length;
      const speechDuration = relevantSubtitles.reduce((sum, s) => sum + (s.end - s.start), 0);
      const durationRatio = this.screenshotInterval > 0 ? speechDuration / this.screenshotInterval : 0;

      if (wordCount >= 5 || durationRatio >= 0.1) {
        sections.push({
          timestamp: screenshot.timestamp,
          screenshot,
          subtitles: relevantSubtitles,
        });
      }
    }

    return {
      metadata,
      sections,
    };
  }

  /**
   * 챕터 기준 콘텐츠 병합
   */
  mergeWithChapters(
    metadata: VideoMetadata,
    subtitles: SubtitleResult,
    screenshots: Screenshot[],
    chapters: Chapter[]
  ): PDFContent {
    const sections: PDFSection[] = [];

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const screenshot = screenshots[i];

      if (!screenshot) continue;

      // 해당 챕터 구간의 자막 찾기
      const chapterSubtitles = this.findSubtitlesInRange(
        subtitles.segments,
        chapter.startTime,
        chapter.endTime
      );

      // 자막이 충분한 섹션만 추가 (빈 페이지 방지)
      // 조건: 단어 수 5개 이상 또는 챕터 구간 대비 음성 비율 10% 이상
      const totalText = chapterSubtitles.map(s => s.text).join(' ');
      const wordCount = totalText.split(/\s+/).filter(w => w.length > 0).length;
      const chapterDuration = chapter.endTime - chapter.startTime;
      const speechDuration = chapterSubtitles.reduce((sum, s) => sum + (s.end - s.start), 0);
      const durationRatio = chapterDuration > 0 ? speechDuration / chapterDuration : 0;

      if (wordCount >= 5 || durationRatio >= 0.1) {
        sections.push({
          timestamp: chapter.startTime,
          screenshot,
          subtitles: chapterSubtitles,
          // 챕터 제목을 sectionSummary에 임시 저장 (나중에 AI 요약으로 대체)
          sectionSummary: {
            summary: chapter.title,
            keyPoints: [],
          },
        });
      }
    }

    return {
      metadata,
      sections,
    };
  }

  /**
   * 특정 시간 범위의 자막 찾기
   * - 중복 방지를 위해 자막 시작 시간 기준으로 구간 판단
   */
  private findSubtitlesInRange(
    segments: SubtitleSegment[],
    startTime: number,
    endTime: number
  ): SubtitleSegment[] {
    return segments.filter((seg) => {
      // 자막의 시작 시간이 구간 내에 있는 경우만 포함 (중복 방지)
      return seg.start >= startTime && seg.start < endTime;
    });
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
