/**
 * URL 유틸리티 테스트
 */

import {
  parseYouTubeUrl,
  isValidYouTubeUrl,
  buildVideoUrl,
  buildTimestampUrl,
  buildPlaylistUrl,
} from '../../../src/utils/url';

describe('URL Utils', () => {
  describe('parseYouTubeUrl', () => {
    it('should parse standard video URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.type).toBe('video');
      expect(result.id).toBe('dQw4w9WgXcQ');
    });

    it('should parse short video URL (youtu.be)', () => {
      const result = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(result.type).toBe('video');
      expect(result.id).toBe('dQw4w9WgXcQ');
    });

    it('should parse embed URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result.type).toBe('video');
      expect(result.id).toBe('dQw4w9WgXcQ');
    });

    it('should parse playlist URL', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(result.type).toBe('playlist');
      expect(result.id).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should parse video URL with playlist (treat as playlist)', () => {
      const result = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(result.type).toBe('playlist');
      expect(result.id).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should throw error for invalid URL', () => {
      expect(() => parseYouTubeUrl('https://example.com')).toThrow();
      expect(() => parseYouTubeUrl('not a url')).toThrow();
    });
  });

  describe('isValidYouTubeUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidYouTubeUrl('https://example.com')).toBe(false);
      expect(isValidYouTubeUrl('invalid')).toBe(false);
    });
  });

  describe('buildVideoUrl', () => {
    it('should build correct video URL', () => {
      const url = buildVideoUrl('dQw4w9WgXcQ');
      expect(url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });

  describe('buildTimestampUrl', () => {
    it('should build correct timestamp URL', () => {
      const url = buildTimestampUrl('dQw4w9WgXcQ', 120);
      expect(url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120');
    });

    it('should floor seconds', () => {
      const url = buildTimestampUrl('dQw4w9WgXcQ', 120.5);
      expect(url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120');
    });
  });

  describe('buildPlaylistUrl', () => {
    it('should build correct playlist URL', () => {
      const url = buildPlaylistUrl('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(url).toBe('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });
  });
});
