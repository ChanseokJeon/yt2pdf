/**
 * 시간 관련 유틸리티
 */

/**
 * 초를 HH:MM:SS 또는 MM:SS 형식으로 변환
 * @param seconds - 변환할 초
 * @returns 포맷된 타임스탬프 문자열
 * @example
 * formatTimestamp(65) // "01:05"
 * formatTimestamp(3665) // "01:01:05"
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * HH:MM:SS 또는 MM:SS 형식을 초로 변환
 * @param timestamp - 파싱할 타임스탬프 문자열
 * @returns 변환된 초
 * @throws {Error} 잘못된 형식의 타임스탬프
 * @example
 * parseTimestamp("01:05") // 65
 * parseTimestamp("01:01:05") // 3665
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map((p) => parseInt(p, 10));

  if (parts.some(isNaN)) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }

  if (parts.length === 2) {
    // MM:SS
    const [m, s] = parts;
    return m * 60 + s;
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }

  throw new Error(`Invalid timestamp format: ${timestamp}`);
}

/**
 * 두 타임스탬프 사이의 지속 시간 계산 (초 단위)
 * @param start - 시작 초
 * @param end - 종료 초
 * @returns 지속 시간 (초)
 * @throws {Error} 종료 시간이 시작 시간보다 이른 경우
 * @example
 * getDuration(0, 65) // 65
 */
export function getDuration(start: number, end: number): number {
  if (end < start) {
    throw new Error(`End time (${end}) cannot be before start time (${start})`);
  }
  return end - start;
}

/**
 * 초를 사람이 읽기 쉬운 형식으로 변환
 * @param seconds - 변환할 초
 * @returns 포맷된 문자열 (예: "1시간 5분", "3분 20초")
 * @example
 * formatDuration(65) // "1분 5초"
 * formatDuration(3665) // "1시간 1분 5초"
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (h > 0) {
    parts.push(`${h}시간`);
    // Include minutes and seconds when there are hours
    if (m > 0) {
      parts.push(`${m}분`);
    }
    if (s > 0 || m === 0) {
      parts.push(`${s}초`);
    }
  } else if (m > 0) {
    parts.push(`${m}분`);
    // Include seconds when there are minutes
    parts.push(`${s}초`);
  } else {
    parts.push(`${s}초`);
  }

  return parts.join(' ');
}

/**
 * 타임스탬프 유효성 검사
 * @param timestamp - 검사할 타임스탬프 문자열
 * @returns 유효하면 true
 */
export function isValidTimestamp(timestamp: string): boolean {
  try {
    parseTimestamp(timestamp);
    return true;
  } catch {
    return false;
  }
}
