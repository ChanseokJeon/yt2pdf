/**
 * 텍스트 정규화 유틸리티
 *
 * PDF 렌더링과 AI 프롬프트에 안전한 텍스트 정규화 함수 제공
 */

/**
 * 텍스트를 PDF 렌더링에 안전한 형태로 정규화
 *
 * - NFC 정규화 (한글 조합형 → 완성형)
 * - 제어 문자 제거
 * - 특수 유니코드 문자 필터링
 * - PDFKit 렌더링 호환성 보장
 *
 * @param text - 정규화할 텍스트
 * @returns PDF 렌더링에 안전한 정규화된 텍스트
 */
export function normalizeTextForPDF(text: string): string {
  if (!text) return text;

  // 1. NFC 정규화 (한글 조합형 → 완성형)
  // NFD 형태의 한글(ㅎㅏㄴㄱㅡㄹ)을 NFC 형태(한글)로 변환
  let normalized = text.normalize('NFC');

  // 2. 제어 문자 제거 (탭, 줄바꿈은 유지)
  // eslint-disable-next-line no-control-regex
  normalized = normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. 유니코드 대체 문자(Replacement Character) 제거
  normalized = normalized.replace(/\uFFFD/g, '');

  // 4. Zero-width 문자 제거 (ZWJ, ZWNJ, ZWSP 등)
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 5. 한글 확장 문자 제거 (PDFKit에서 렌더링 실패하는 문자들)
  // - D7B0-D7FF: 한글 자모 확장-B
  // - A960-A97F: 한글 자모 확장-A
  normalized = normalized.replace(/[\uD7B0-\uD7FF\uA960-\uA97F]/g, '');

  // 6. Private Use Area 문자 제거
  normalized = normalized.replace(/[\uE000-\uF8FF]/g, '');

  // 7. 확장 라틴 문자 처리 (PDFKit 폰트 폴백 문제 방지)
  // 일반적인 확장 라틴을 기본 ASCII로 변환
  const latinMap: Record<string, string> = {
    ħ: 'h',
    Ħ: 'H',
    ı: 'i',
    İ: 'I',
    Ĩ: 'I',
    ĩ: 'i',
    ł: 'l',
    Ł: 'L',
    ñ: 'n',
    Ñ: 'N',
    ø: 'o',
    Ø: 'O',
    ß: 'ss',
    þ: 'th',
    Þ: 'Th',
    đ: 'd',
    Đ: 'D',
  };
  for (const [from, to] of Object.entries(latinMap)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to);
  }

  // 7.5. Symbol/Arrow replacements for font compatibility
  const symbolMap: Record<string, string> = {
    '→': '->',
    '←': '<-',
    '↔': '<->',
    '⇒': '=>',
    '⇐': '<=',
    '⇔': '<=>',
    '•': '-',
    '·': '-',
    '…': '...',
    '–': '-',
    '—': '-',
    '「': '"',
    '」': '"',
    '『': '"',
    '』': '"',
    '♪': '[music]',
    '♫': '[music]',
    '🎵': '[music]',
    '🎶': '[music]',
  };
  for (const [from, to] of Object.entries(symbolMap)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to);
  }

  // 8. 나머지 확장 라틴 문자 제거 (Latin Extended-A, B)
  normalized = normalized.replace(/[\u0100-\u024F]/g, '');

  // 9. 쓰레기 한글 패턴 제거 (한글+ASCII 비정상 혼합)
  normalized = normalized.replace(/[가-힣][a-z`_]{1,3}[가-힣]/gi, '');

  return normalized;
}

/**
 * AI 프롬프트용 텍스트 정제
 *
 * AI 응답 텍스트에서 이상한 유니코드 문자 제거
 * - 표준 한글 음절(AC00-D7AF)만 허용
 * - 희귀 한글 확장 문자(걻걼걽걾 등) 제거
 * - ASCII와 한글이 비정상적으로 섞인 패턴 감지 및 제거
 *
 * 허용할 문자 범위:
 * - 기본 라틴 문자, 숫자, 공백, 구두점 (0020-007E)
 * - 표준 한글 음절 (AC00-D7AF) - 가~힣
 * - 한글 자모 (1100-11FF, 3130-318F) - ㄱ~ㅎ, ㅏ~ㅣ 등
 * - CJK 통합 한자 (4E00-9FFF) - 가끔 포함될 수 있음
 * - 일반 구두점, 괄호, 따옴표 등
 *
 * 제거할 문자:
 * - 호환 한글 자모 확장 (3200-321E) - 괄호로 둘러싸인 한글
 * - 한글 확장-A (A960-A97F)
 * - 한글 확장-B (D7B0-D7FF) - 걻걼걽걾 같은 이상한 문자들
 *
 * @param text - 정제할 텍스트
 * @returns 정제된 텍스트
 */
export function sanitizeForAI(text: string): string {
  if (!text) return text;

  const sanitized = text.replace(/[\uD7B0-\uD7FF\uA960-\uA97F\u3200-\u321E]/g, '');

  // 연속된 이상한 패턴 제거 (예: "89:;", "이IJKLM" 같은 깨진 텍스트)
  // ASCII와 한글이 비정상적으로 섞인 패턴 감지
  const cleanedOfGarbage = sanitized
    // 숫자+구두점이 단어 중간에 나타나는 패턴 (예: "89:;")
    .replace(/[\uAC00-\uD7AF][\d:;]+[\uAC00-\uD7AF]/g, (match) => {
      // 의미 있는 패턴(시간 표기 등)이 아니면 한글만 유지
      const hangul = match.replace(/[\d:;]+/g, '');
      return hangul;
    })
    // 연속된 의미 없는 문자 시퀀스 제거
    .replace(/[A-Z]{4,}[가-힣]/g, (match) => {
      // "IJKLM이" 같은 패턴 - 마지막 한글만 유지
      const lastHangul = match.match(/[가-힣]+$/);
      return lastHangul ? lastHangul[0] : '';
    });

  return cleanedOfGarbage;
}

/**
 * 통합 텍스트 정규화 함수
 *
 * PDF 렌더링과 AI 프롬프트 모두에 안전한 텍스트 정규화
 * normalizeTextForPDF + sanitizeForAI 순차 적용
 *
 * @param text - 정규화할 텍스트
 * @returns 완전히 정규화된 텍스트
 */
export function sanitizeAndNormalize(text: string): string {
  if (!text) return text;

  // 1. PDF용 정규화 먼저 적용
  let normalized = normalizeTextForPDF(text);

  // 2. AI용 정제 추가 적용
  normalized = sanitizeForAI(normalized);

  return normalized;
}
