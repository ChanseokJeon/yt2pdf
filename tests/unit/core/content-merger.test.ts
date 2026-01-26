/**
 * 콘텐츠 병합기 테스트
 */

import { ContentMerger } from '../../../src/core/content-merger';
import { VideoMetadata, SubtitleResult, Screenshot, SubtitleSegment } from '../../../src/types';

describe('ContentMerger', () => {
  let merger: ContentMerger;

  beforeEach(() => {
    merger = new ContentMerger({
      screenshotConfig: { interval: 60, quality: 'low' },
    });
  });

  const mockMetadata: VideoMetadata = {
    id: 'test123',
    title: 'Test Video',
    description: '',
    duration: 300,
    thumbnail: '',
    channel: 'Test Channel',
    uploadDate: '20250101',
    viewCount: 0,
    availableCaptions: [],
  };

  const mockSubtitles: SubtitleResult = {
    source: 'youtube',
    language: 'ko',
    segments: [
      { start: 0, end: 10, text: 'Segment 1' },
      { start: 30, end: 40, text: 'Segment 2' },
      { start: 60, end: 70, text: 'Segment 3' },
      { start: 90, end: 100, text: 'Segment 4' },
      { start: 120, end: 130, text: 'Segment 5' },
    ],
  };

  const mockScreenshots: Screenshot[] = [
    { timestamp: 0, imagePath: '/tmp/0.jpg', width: 854, height: 480 },
    { timestamp: 60, imagePath: '/tmp/60.jpg', width: 854, height: 480 },
    { timestamp: 120, imagePath: '/tmp/120.jpg', width: 854, height: 480 },
  ];

  describe('merge', () => {
    it('should create sections for each screenshot', () => {
      const content = merger.merge(mockMetadata, mockSubtitles, mockScreenshots);

      expect(content.sections).toHaveLength(3);
      expect(content.metadata).toBe(mockMetadata);
    });

    it('should match subtitles to correct sections', () => {
      const content = merger.merge(mockMetadata, mockSubtitles, mockScreenshots);

      // 0-60초 구간
      expect(content.sections[0].subtitles).toHaveLength(2);
      expect(content.sections[0].subtitles[0].text).toBe('Segment 1');
      expect(content.sections[0].subtitles[1].text).toBe('Segment 2');

      // 60-120초 구간
      expect(content.sections[1].subtitles).toHaveLength(2);
      expect(content.sections[1].subtitles[0].text).toBe('Segment 3');

      // 120-180초 구간
      expect(content.sections[2].subtitles).toHaveLength(1);
      expect(content.sections[2].subtitles[0].text).toBe('Segment 5');
    });

    it('should include screenshot in each section', () => {
      const content = merger.merge(mockMetadata, mockSubtitles, mockScreenshots);

      content.sections.forEach((section, i) => {
        expect(section.screenshot).toBe(mockScreenshots[i]);
        expect(section.timestamp).toBe(mockScreenshots[i].timestamp);
      });
    });
  });

  describe('combineSubtitleText', () => {
    it('should combine subtitle texts', () => {
      const segments: SubtitleSegment[] = [
        { start: 0, end: 10, text: 'Hello' },
        { start: 10, end: 20, text: 'World' },
      ];

      const combined = merger.combineSubtitleText(segments);
      expect(combined).toBe('Hello World');
    });

    it('should remove duplicate texts', () => {
      const segments: SubtitleSegment[] = [
        { start: 0, end: 10, text: 'Hello' },
        { start: 10, end: 20, text: 'Hello' },
        { start: 20, end: 30, text: 'World' },
      ];

      const combined = merger.combineSubtitleText(segments);
      expect(combined).toBe('Hello World');
    });

    it('should trim whitespace', () => {
      const segments: SubtitleSegment[] = [
        { start: 0, end: 10, text: '  Hello  ' },
        { start: 10, end: 20, text: '  World  ' },
      ];

      const combined = merger.combineSubtitleText(segments);
      expect(combined).toBe('Hello World');
    });
  });

  describe('groupByChapter', () => {
    it('should group sections into chapters', () => {
      const content = merger.merge(mockMetadata, mockSubtitles, mockScreenshots);
      const chapters = merger.groupByChapter(content.sections, 120); // 2분 챕터

      expect(chapters.length).toBeGreaterThan(0);
    });
  });
});
