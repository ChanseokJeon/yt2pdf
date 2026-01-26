/**
 * URL 유틸리티
 */

export type YouTubeUrlType = 'video' | 'playlist';

export interface ParsedYouTubeUrl {
  type: YouTubeUrlType;
  id: string;
}

/**
 * YouTube URL 파싱
 */
export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
  // 영상 ID 추출 패턴들
  const videoPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  // 플레이리스트 ID 추출 패턴
  const playlistPattern = /[?&]list=([a-zA-Z0-9_-]+)/;

  // 플레이리스트 체크
  const playlistMatch = url.match(playlistPattern);
  if (playlistMatch) {
    // 플레이리스트 URL에 비디오 ID도 있는지 확인
    for (const pattern of videoPatterns) {
      const videoMatch = url.match(pattern);
      if (videoMatch) {
        // 플레이리스트의 특정 비디오인 경우에도 플레이리스트로 처리
        return { type: 'playlist', id: playlistMatch[1] };
      }
    }
    return { type: 'playlist', id: playlistMatch[1] };
  }

  // 단일 비디오 체크
  for (const pattern of videoPatterns) {
    const match = url.match(pattern);
    if (match) {
      return { type: 'video', id: match[1] };
    }
  }

  throw new Error(`유효하지 않은 YouTube URL입니다: ${url}`);
}

/**
 * YouTube URL 유효성 검사
 */
export function isValidYouTubeUrl(url: string): boolean {
  try {
    parseYouTubeUrl(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * YouTube 비디오 URL 생성
 */
export function buildVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * YouTube 타임스탬프 URL 생성
 */
export function buildTimestampUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}`;
}

/**
 * YouTube 플레이리스트 URL 생성
 */
export function buildPlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}
