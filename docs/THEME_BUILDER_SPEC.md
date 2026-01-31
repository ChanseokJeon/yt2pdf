# Theme Builder 스펙 문서

> 버전: 1.0.0
> 작성일: 2025-01-31
> 상태: 구현 예정

## 1. 개요

### 목적
URL, 이미지 파일, 또는 프리셋 이름에서 자동으로 PDF 테마를 생성하는 기능

### 범위
- **포함**: 색상 추출, WCAG 대비율 보정, CLI 통합
- **제외**: 폰트 감지, 레이아웃 추론 (YAGNI)

### 핵심 지표
- 코드 커버리지: 90% 이상
- E2E 테스트: 통과
- 파일 크기: ~200줄

---

## 2. 입력/출력

### 입력 형식

| 타입 | 예시 | 감지 방법 |
|------|------|----------|
| URL | `https://stripe.com` | `http://` 또는 `https://` 시작 |
| 이미지 | `./logo.png` | 파일 존재 + 이미지 확장자 |
| 프리셋 | `dark`, `sepia` | 위 조건 불충족 시 |

### 출력 형식

```typescript
interface Theme {
  name: string;
  margins: { top: number; bottom: number; left: number; right: number };
  fonts: {
    title: { name: string; size: number };
    heading: { name: string; size: number };
    body: { name: string; size: number };
    timestamp: { name: string; size: number };
  };
  colors: {
    primary: string;
    text: string;
    secondary: string;
    link: string;
    background: string;
  };
  spacing: {
    sectionGap: number;
    paragraphGap: number;
    imageMargin: number;
  };
}
```

---

## 3. 데이터 흐름

```
INPUT (source string)
       │
       ▼
┌──────────────────┐
│ detectSourceType │ → 'url' | 'image' | 'preset'
└────────┬─────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐ ┌────────┐ ┌─────────┐
│ URL   │ │ Image  │ │ Preset  │
│Puppeteer│ │Vibrant │ │ 하드코딩 │
└───┬───┘ └───┬────┘ └────┬────┘
    │         │           │
    └─────────┼───────────┘
              ▼
     ┌────────────────┐
     │ ColorPalette   │
     │ (raw colors)   │
     └───────┬────────┘
             ▼
     ┌────────────────┐
     │ ensureContrast │ WCAG 4.5:1 보정
     └───────┬────────┘
             ▼
     ┌────────────────┐
     │ paletteToTheme │ 기본 fonts/margins 적용
     └───────┬────────┘
             ▼
        Theme 객체
```

---

## 4. API 설계

### Public API

```typescript
/**
 * 소스에서 테마 빌드
 * @param source - URL, 이미지 경로, 또는 프리셋 이름
 * @param options - 빌드 옵션
 * @returns Promise<Theme>
 */
export async function buildTheme(
  source: string,
  options?: ThemeBuilderOptions
): Promise<Theme>;
```

### Types

```typescript
export type ThemeSource =
  | { type: 'url'; value: string }
  | { type: 'image'; value: string }
  | { type: 'preset'; value: string };

export interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  link: string;
}

export interface ThemeBuilderOptions {
  name?: string;      // 테마 이름 (기본: extracted-{timestamp})
  timeout?: number;   // URL 타임아웃 ms (기본: 10000)
}
```

---

## 5. 내장 프리셋

| 프리셋 | primary | background | text | 용도 |
|--------|---------|------------|------|------|
| `light` | #2563eb | #ffffff | #1f2937 | 기본 밝은 테마 |
| `dark` | #60a5fa | #1f2937 | #f9fafb | 다크 모드 |
| `sepia` | #92400e | #fef3c7 | #451a03 | 독서/인쇄용 |
| `forest` | #059669 | #ecfdf5 | #064e3b | 자연/친환경 |

---

## 6. WCAG 대비율 보정

### 요구사항
- 텍스트/배경: 최소 4.5:1 (WCAG AA)
- 링크/배경: 최소 4.5:1 (WCAG AA)

### 알고리즘

```typescript
function ensureContrast(palette: ColorPalette): ColorPalette {
  // 1. 배경 명도 계산
  const bgLuminance = chroma(palette.background).luminance();

  // 2. 텍스트: 배경과 4.5:1 이상 보장
  const text = bgLuminance > 0.5 ? '#1f2937' : '#f9fafb';

  // 3. 링크: 대비율 부족시 명도 조정
  let link = palette.link;
  while (chroma.contrast(link, palette.background) < 4.5) {
    // 배경이 밝으면 링크를 어둡게, 어두우면 밝게
    link = adjustLuminance(link, bgLuminance > 0.5 ? -0.1 : 0.1);
  }

  return { ...palette, text, link };
}
```

---

## 7. 에러 처리

| 에러 상황 | 처리 | 로그 레벨 |
|----------|------|----------|
| URL 타임아웃 | 기본 테마 반환 | WARN |
| URL 접근 불가 | 기본 테마 반환 | WARN |
| 이미지 파일 없음 | 기본 테마 반환 | WARN |
| 이미지 형식 미지원 | 기본 테마 반환 | WARN |
| 색상 추출 실패 | 기본 테마 반환 | WARN |
| 알 수 없는 프리셋 | 기본 테마 반환 | WARN |

**원칙**: 테마 추출 실패가 전체 변환을 중단시키면 안 됨

---

## 8. CLI 통합

### 새 옵션

```
--theme-from <source>  URL, 이미지, 또는 프리셋에서 테마 추출
```

### 사용 예시

```bash
# 프리셋 사용
yt2pdf https://www.youtube.com/watch?v=MGzymaYBiss --theme-from dark

# minimal-neon 프리셋 (Layout6 기반)
yt2pdf https://www.youtube.com/watch?v=MGzymaYBiss --theme-from minimal-neon

# 이미지에서 추출
yt2pdf https://www.youtube.com/watch?v=MGzymaYBiss --theme-from ./brand-logo.png

# URL에서 추출
yt2pdf https://www.youtube.com/watch?v=MGzymaYBiss --theme-from https://stripe.com

# 조합
yt2pdf https://www.youtube.com/watch?v=MGzymaYBiss --theme-from sepia --layout horizontal
```

### 우선순위

`--theme-from` > `--theme` > config 파일 > 기본값

---

## 9. 의존성

### 신규 추가

```json
{
  "node-vibrant": "^3.2.1-alpha.1",
  "chroma-js": "^2.4.2"
}
```

### 개발 의존성

```json
{
  "@types/chroma-js": "^2.4.0"
}
```

### 기존 사용

- `puppeteer`: URL CSS 추출용 (이미 설치됨)

---

## 10. 파일 구조

```
src/
├── core/
│   ├── pdf-generator.ts    # Theme 인터페이스 export
│   └── theme-builder.ts    # 신규 (~200줄)
├── cli/
│   ├── index.ts            # --theme-from 옵션 추가
│   └── commands/
│       └── convert.ts      # buildTheme 호출 통합
└── types/
    └── config.ts           # ThemeBuilderOptions 타입 추가

tests/
├── unit/
│   └── theme-builder.test.ts   # 단위 테스트
└── e2e/
    └── theme-builder.e2e.test.ts  # E2E 테스트
```

---

## 11. 테스트 계획

### 단위 테스트 (90% 커버리지 목표)

| 테스트 케이스 | 설명 |
|--------------|------|
| `detectSourceType` | URL/이미지/프리셋 감지 |
| `extractFromImage` | 이미지 색상 추출 |
| `getPreset` | 프리셋 반환/폴백 |
| `ensureContrast` | WCAG 대비율 보정 |
| `paletteToTheme` | 팔레트→테마 변환 |
| `buildTheme` | 통합 테스트 |

### E2E 테스트

| 시나리오 | 검증 항목 |
|----------|----------|
| 프리셋 테마 적용 | PDF 생성 성공, 색상 적용 확인 |
| 이미지 테마 추출 | 색상 추출 + PDF 생성 |
| 에러 폴백 | 잘못된 입력 → 기본 테마로 PDF 생성 |

---

## 12. 구현 일정

| 단계 | 작업 | 예상 시간 |
|------|------|----------|
| 1 | 의존성 설치 | 2분 |
| 2 | theme-builder.ts 구현 | 20분 |
| 3 | CLI 통합 | 10분 |
| 4 | 단위 테스트 작성 | 20분 |
| 5 | E2E 테스트 작성 | 15분 |
| 6 | 커버리지 90% 달성 | 10분 |
| **Total** | | **~80분** |

---

## 13. 향후 확장 (YAGNI - 현재 범위 외)

- [ ] 폰트 감지 (WhatFontIs API)
- [ ] 커스텀 마진/스페이싱 추출
- [ ] 테마 저장/내보내기 (JSON)
- [ ] 테마 미리보기 CLI 명령어
- [ ] 그라디언트/그림자 지원

---

## 14. 참고 자료

- [node-vibrant GitHub](https://github.com/Vibrant-Colors/node-vibrant)
- [chroma.js Documentation](https://gka.github.io/chroma.js/)
- [WCAG 2.1 Contrast Requirements](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [Puppeteer CSS Extraction](https://pptr.dev/)
