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

  // AND 조건 충족: 단어 15개 이상 + 음성 비율 20% 이상
  const mockSubtitles: SubtitleResult = {
    source: 'youtube',
    language: 'ko',
    segments: [
      // Section 0 (0-60s): 30s speech, ~20 words
      { start: 0, end: 15, text: 'This is the first segment of the video with many words to fill the content requirement' },
      { start: 30, end: 45, text: 'And this is the second segment here with additional words for testing purposes today' },
      // Section 1 (60-120s): 30s speech, ~20 words
      { start: 60, end: 75, text: 'Now we are in the third segment text with extra content to meet the threshold requirement' },
      { start: 90, end: 105, text: 'The fourth segment continues the story and adds more words to ensure proper filtering' },
      // Section 2 (120-180s): 30s speech, ~20 words
      { start: 120, end: 135, text: 'Finally the fifth segment wraps it up nicely with enough words to pass the filter' },
      { start: 150, end: 165, text: 'And here is a sixth segment to make sure we have enough content for the last section' },
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

      // 0-60초 구간 (2개 세그먼트)
      expect(content.sections[0].subtitles).toHaveLength(2);
      expect(content.sections[0].subtitles[0].text).toContain('first segment');
      expect(content.sections[0].subtitles[1].text).toContain('second segment');

      // 60-120초 구간 (2개 세그먼트)
      expect(content.sections[1].subtitles).toHaveLength(2);
      expect(content.sections[1].subtitles[0].text).toContain('third segment');
      expect(content.sections[1].subtitles[1].text).toContain('fourth segment');

      // 120-180초 구간 (2개 세그먼트)
      expect(content.sections[2].subtitles).toHaveLength(2);
      expect(content.sections[2].subtitles[0].text).toContain('fifth segment');
      expect(content.sections[2].subtitles[1].text).toContain('sixth segment');
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
