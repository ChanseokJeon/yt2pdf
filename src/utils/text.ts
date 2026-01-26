/**
 * 텍스트 처리 유틸리티
 */

/**
 * HTML 엔티티 디코딩
 */
export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#x60;': '`',
    '&#x3D;': '=',
  };

  let result = text;

  // Named entities
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // Numeric entities (decimal)
  result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));

  // Numeric entities (hex)
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return result;
}

/**
 * 연속 중복 라인 제거
 * YouTube 자동 자막에서 겹치는 부분 제거
 */
export function deduplicateSubtitles(texts: string[]): string[] {
  if (texts.length === 0) return [];

  const result: string[] = [];
  let lastText = '';

  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    // 완전히 동일한 경우 스킵
    if (trimmed === lastText) continue;

    // 이전 텍스트가 현재 텍스트의 시작 부분인 경우 (점진적 자막)
    // 예: "Hello" -> "Hello world" -> 마지막 것만 유지
    if (lastText && trimmed.startsWith(lastText)) {
      // 이전 것을 현재로 교체
      result.pop();
    }
    // 현재 텍스트가 이전 텍스트의 시작 부분인 경우 스킵
    else if (lastText && lastText.startsWith(trimmed)) {
      continue;
    }

    result.push(trimmed);
    lastText = trimmed;
  }

  return result;
}

/**
 * 자막 텍스트 정리
 * - HTML 엔티티 디코딩
 * - 중복 제거
 * - 공백 정리
 */
export function cleanSubtitleText(text: string): string {
  let cleaned = decodeHtmlEntities(text);

  // VTT 태그 제거
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // 연속 공백 정리
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}
