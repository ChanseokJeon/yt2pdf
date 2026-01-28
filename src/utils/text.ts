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
 * 연속 중복 라인 제거 및 병합
 * YouTube 자동 자막에서 겹치는 부분을 제거하고 자연스럽게 병합
 */
export function deduplicateSubtitles(texts: string[]): string[] {
  if (texts.length === 0) return [];

  // 1단계: 빈 문자열 및 공백만 있는 항목 제거
  const filtered = texts.map(t => t.trim()).filter(t => t.length > 0);
  if (filtered.length === 0) return [];

  // 2단계: 롤링 자막 병합
  const rollingMerged = mergeRollingSubtitles(filtered);

  // 3단계: 완전 동일 중복 제거 (Set 사용하되 순서 유지)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const text of rollingMerged) {
    if (!seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }
  }

  // 4단계: 포함 관계 제거 (짧은 문장이 긴 문장에 포함된 경우)
  const nonContained: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    const current = unique[i];
    let isContained = false;

    // 다른 문장에 완전히 포함되어 있는지 확인
    for (let j = 0; j < unique.length; j++) {
      if (i !== j && unique[j].includes(current) && unique[j].length > current.length) {
        isContained = true;
        break;
      }
    }

    if (!isContained) {
      nonContained.push(current);
    }
  }

  // 5단계: 반복 패턴 제거 (같은 단어/구가 3번 이상 반복되면 1번만 유지)
  const result: string[] = [];
  for (const text of nonContained) {
    const cleaned = removeExcessiveRepetition(text);
    if (cleaned.length > 0) {
      result.push(cleaned);
    }
  }

  return result;
}

/**
 * YouTube 롤링 자막 병합
 * 자막 끝부분이 다음 자막 시작부분과 겹치는 패턴을 감지하여 병합
 */
function mergeRollingSubtitles(texts: string[]): string[] {
  if (texts.length <= 1) return texts;

  const merged: string[] = [];
  let current = texts[0];

  for (let i = 1; i < texts.length; i++) {
    const next = texts[i];
    const overlap = findWordOverlap(current, next);

    if (overlap.overlapLength > 1 || overlap.overlapText.length >= 10) {
      // 겹치는 부분 제거 후 병합
      const uniquePart = next.substring(overlap.overlapText.length).trim();
      if (uniquePart.length > 0) {
        current = `${current} ${uniquePart}`.trim();
      }
    } else {
      // 겹침 없음, 현재 저장하고 새로 시작
      if (current.trim().length > 0) {
        merged.push(current.trim());
      }
      current = next;
    }
  }

  // 마지막 항목 추가
  if (current.trim().length > 0) {
    merged.push(current.trim());
  }

  return merged;
}

/**
 * 두 텍스트의 suffix-prefix 겹침 찾기
 */
function findWordOverlap(text1: string, text2: string): { overlapText: string; overlapLength: number } {
  const words1 = text1.split(/\s+/).filter(w => w.length > 0);
  const words2 = text2.split(/\s+/).filter(w => w.length > 0);

  // 최대 겹침 단어 수 (YouTube 롤링 자막 패턴 대응 - 더 넓은 범위 검사)
  const maxOverlap = Math.min(words1.length, words2.length - 1, 15);

  for (let n = maxOverlap; n > 0; n--) {
    const suffix = words1.slice(-n).join(' ').toLowerCase();
    const prefix = words2.slice(0, n).join(' ').toLowerCase();

    if (suffix === prefix) {
      return {
        overlapText: words2.slice(0, n).join(' '),
        overlapLength: n,
      };
    }
  }

  return { overlapText: '', overlapLength: 0 };
}

/**
 * 과도한 반복 패턴 제거
 * 예: "네, 네, 네, 네, 네" -> "네"
 */
function removeExcessiveRepetition(text: string): string {
  // 반복 패턴 감지: 같은 문자/단어가 3번 이상 연속으로 나타나면 제거
  // 패턴: (단어/문자)(구분자)(같은 단어/문자) 반복
  const repeatPattern = /(.{1,20}?)(?:,\s*|\s+)\1(?:(?:,\s*|\s+)\1){2,}/g;
  let cleaned = text.replace(repeatPattern, '$1');

  // "네, 네, 네" 같은 짧은 반복 제거
  const shortRepeatPattern = /(\S{1,5})(?:,\s*|\s+)(?:\1(?:,\s*|\s+)){2,}\1?/g;
  cleaned = cleaned.replace(shortRepeatPattern, '$1');

  // 연속 공백 정리
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
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

/**
 * 텍스트가 주로 한글인지 확인
 */
export function isKoreanDominant(text: string): boolean {
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const totalChars = text.replace(/[\s\d\W]/g, '').length;
  return totalChars > 0 && koreanChars / totalChars > 0.3;
}

/**
 * 혼재된 언어 텍스트 정리
 * 번역된 텍스트에서 원문이 함께 포함된 경우 처리
 */
export function cleanMixedLanguageText(text: string, targetLang: string = 'ko'): string {
  if (targetLang !== 'ko') return text;

  // 한글 비율 계산
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const totalChars = text.replace(/[\s\d\W]/g, '').length;
  const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;

  // 70% 이상 한글이면 그대로 반환
  if (koreanRatio >= 0.7) return text;

  // 30% 미만 한글이면 (거의 영어) 그대로 반환 (번역 실패 케이스)
  if (koreanRatio < 0.3) return text;

  // 30-70% 혼재: 한글 문장만 추출 시도
  // 패턴: 한글로 시작하는 문장 또는 한글이 주인 부분
  const koreanSentences = text.match(/[가-힣][가-힣\s,.!?'"()0-9]*[가-힣.!?]/g);
  if (koreanSentences && koreanSentences.length > 0) {
    const extracted = koreanSentences.join(' ').trim();
    // 추출된 텍스트가 원본의 30% 이상이면 사용
    if (extracted.length > text.length * 0.3) {
      return extracted;
    }
  }

  // 기존 방식: 한글 부분만 추출
  const koreanPart = text.match(/[\uAC00-\uD7AF\s,.!?'"()0-9]+/g);
  if (koreanPart) {
    const koreanText = koreanPart.join('').trim();
    if (koreanText.length > 0 && isKoreanDominant(koreanText)) {
      return koreanText;
    }
  }

  return text;
}
