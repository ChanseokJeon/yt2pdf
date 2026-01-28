# PDF 품질 개선 스펙 문서

> 작성일: 2026-01-29
> 버전: 1.0

---

## 개요

PDF 변환 품질 관련 4가지 이슈를 해결하기 위한 기술 스펙 문서.

---

## 이슈 목록

| # | 이슈 | 심각도 | 근본 원인 |
|---|------|--------|----------|
| 1 | 원문+번역 혼재 | High | 번역 실패시 영어 원문 폴백 정책 |
| 2 | 빈 페이지 다수 | Medium | OR 조건으로 텍스트 없는 섹션 포함 |
| 3 | 쓰레기 텍스트 | Medium | 의미없는 한글 조합 미감지 |
| 4 | 폰트 렌더링 오류 | High | PDFKit 폰트 폴백 + 확장 문자 미필터링 |

---

## 이슈 1: 원문+번역 혼재

### 현상
- 한국어 PDF에 영어 원문이 그대로 노출
- 예: "So I actually don't have one unfortunately..."

### 근본 원인
번역 실패시 **2개의 폴백 경로**가 영어 원문을 반환:

```typescript
// 경로 1: ai.ts:391 - 초기 파싱 실패
let translatedText = translatedTexts.get(j) || original.text;

// 경로 2: ai.ts:429 - 재시도 실패
translatedText = original.text;
```

### 해결 방안

**옵션 A (권장)**: 번역 실패시 해당 세그먼트 생략
```typescript
// 경로 1 수정
let translatedText = translatedTexts.get(j);
if (!translatedText) {
  continue; // 해당 세그먼트 건너뛰기
}

// 경로 2 수정
if (retryKoreanRatio < 0.5) {
  continue; // 해당 세그먼트 건너뛰기
}
```

**옵션 B**: 번역 실패 표시
```typescript
translatedText = `[번역 불가: ${original.text.slice(0, 30)}...]`;
```

### 수정 파일
- `src/providers/ai.ts`: translate() 메서드 (lines 391, 429)

### 검증 기준
- PDF에 영어 원문이 직접 노출되지 않을 것
- 번역 실패 세그먼트는 생략되거나 표시될 것

---

## 이슈 2: 빈 페이지 다수

### 현상
- Page 5, 6, 9, 10, 13, 14, 17, 18 등 거의 빈 페이지

### 근본 원인
OR 조건으로 텍스트 없는 섹션도 포함:

```typescript
// content-merger.ts:44
if (wordCount >= 5 || durationRatio >= 0.1) {
  // 0 words + 15% duration → 포함됨 (빈 페이지!)
}
```

### 해결 방안
OR → AND 조건으로 변경:

```typescript
// 수정 후: 둘 다 만족해야 포함
if (wordCount >= 5 && durationRatio >= 0.1) {
  sections.push({ ... });
}
```

### 수정 파일
- `src/core/content-merger.ts`: merge() (line 44), mergeWithChapters() (line 91)

### 검증 기준
- 빈 페이지(텍스트 5단어 미만)가 없을 것

---

## 이슈 3: 쓰레기 텍스트

### 현상
- 의미없는 한글 조합: "굉b 궡궢_궂 굄x 굟b"
- YouTube 자동자막 또는 AI 번역 오류

### 근본 원인
- 유효한 유니코드 한글이지만 의미없는 조합
- 현재 sanitizeText()는 확장 한글만 필터링

### 해결 방안
쓰레기 텍스트 감지 함수 추가:

```typescript
/**
 * 쓰레기 텍스트 감지
 * - 한글+ASCII 비정상 혼합
 * - 의미없는 기호 반복
 */
function isGarbageText(text: string): boolean {
  // 패턴 1: 한글 사이에 랜덤 ASCII (굉b, 굄x 등)
  const mixedPattern = /[가-힣][a-z`_]{1,3}[가-힣]/i;

  // 패턴 2: 의미없는 기호 반복
  const symbolPattern = /[`_\\㏖]{2,}/;

  // 패턴 3: 자음/모음만 반복 (ㅁ` uob 등)
  const jamoPattern = /[ㄱ-ㅎㅏ-ㅣ]{2,}[`_\s]/;

  return mixedPattern.test(text) || symbolPattern.test(text) || jamoPattern.test(text);
}
```

적용 위치:
1. `ai.ts`: translate() - 번역 결과 검증
2. `text.ts`: deduplicateSubtitles() - 자막 처리

### 수정 파일
- `src/utils/text.ts`: isGarbageText() 추가 + deduplicateSubtitles() 수정
- `src/providers/ai.ts`: translate() 결과 검증 추가

### 검증 기준
- 한글+ASCII 비정상 혼합 텍스트가 제거될 것

---

## 이슈 4: 폰트 렌더링 오류

### 현상
- 헤더: "ħi얼얹 괿r얺 e Ĩ re: ! i궔괽ing 얼n AItn얼i"
- HTML은 정상, PDF만 깨짐

### 근본 원인
1. PDFKit 폰트 폴백 오류 (확장 라틴 문자)
2. 일부 한글 코드포인트 렌더링 실패
3. 혼합 스크립트 처리 문제

### 해결 방안

**1. 확장 라틴 문자 필터링 강화:**
```typescript
function normalizeTextForPDF(text: string): string {
  // 기존 필터링...

  // 추가: 확장 라틴 문자 → 기본 ASCII로 변환 또는 제거
  normalized = normalized
    .replace(/ħ/g, 'h')
    .replace(/Ĩ/g, 'I')
    .replace(/[\u0100-\u024F]/g, ''); // Latin Extended 제거

  return normalized;
}
```

**2. 문제 있는 한글 코드포인트 필터링:**
```typescript
// 렌더링 문제 있는 희귀 한글 음절 제거
// 괿(U+AD3F), 궔(U+AD54) 등 - 필요시 확장
normalized = normalized.replace(/[괿궔]/g, '');
```

### 수정 파일
- `src/core/pdf-generator.ts`: normalizeTextForPDF() 강화

### 검증 기준
- PDF 헤더/본문에 깨진 문자가 없을 것
- 확장 라틴 문자가 정상 렌더링되거나 대체될 것

---

## 구현 순서

1. `src/utils/text.ts` - isGarbageText() 함수 추가
2. `src/providers/ai.ts` - 번역 폴백 정책 수정 + 쓰레기 감지
3. `src/core/content-merger.ts` - OR → AND 조건 변경
4. `src/core/pdf-generator.ts` - 폰트 필터링 강화
5. 테스트 실행 및 E2E 검증

---

## 테스트 계획

### 단위 테스트
- [ ] isGarbageText() 테스트 케이스 추가
- [ ] 번역 폴백 동작 테스트
- [ ] 빈 섹션 필터링 테스트

### E2E 테스트
- [ ] 샘플 YouTube URL로 PDF 변환
- [ ] 4가지 이슈 모두 해결 확인
- [ ] 기존 기능 regression 없음 확인

### 검증용 샘플 URL
```
https://www.youtube.com/watch?v=MGzymaYBiss
```
> 영어 영상, 한국어 번역 테스트용

---

## 롤백 계획

문제 발생시 git revert로 이전 커밋으로 복구:
```bash
git revert HEAD
```

---

*문서 끝*
