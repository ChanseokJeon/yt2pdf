# yt2pdf 개발 세션 상태

> 이 파일은 Claude Code가 작업을 재개할 때 컨텍스트를 빠르게 파악하기 위한 파일입니다.

---

## 마지막 세션 정보

| 항목 | 값 |
|------|-----|
| **날짜** | 2026-01-30 |
| **세션 ID** | session-004 |
| **완료한 작업** | PDF 품질 개선 + AI 프롬프트 재설계 |
| **다음 작업** | 추가 영상으로 PDF 품질 검증 |

---

## 프로젝트 컨텍스트

### 프로젝트 목적
YouTube 영상의 자막과 스크린샷을 추출하여 PDF로 변환하는 CLI 도구

### 핵심 기술 결정
- **언어**: Node.js / TypeScript
- **자막**: YouTube 자막 우선, Whisper API 폴백
- **스크린샷**: FFmpeg, 1분 간격, 480p
- **설정**: YAML
- **사용 형태**: CLI + Claude Code Skill
- **AI 기능**: OpenAI GPT (요약, 번역)

### 문서 구조
```
docs/
├── ARCHITECTURE.md   # 전체 아키텍처, 데이터 흐름
├── MODULES.md        # 각 모듈 상세 설계, 인터페이스
├── PROGRESS.md       # 마일스톤별 태스크 상태
└── SESSION.md        # 세션 상태 (이 파일)
```

---

## 최근 완료한 작업: PDF 품질 개선 + AI 프롬프트 재설계

### 해결한 문제들

1. **PDF 중복 콘텐츠 문제** (커밋: 9637781)
   - AI 향상 콘텐츠와 원본 자막이 함께 표시되던 문제
   - `hasEnhancedContent` 조건 체크로 해결

2. **PDF 표지 정렬 문제** (커밋: 6e6c767)
   - URL이 "원본:" 레이블과 겹치던 문제
   - `continued: true` + `align: center` 충돌 제거로 해결

3. **중복 oneLiner 섹션 제거** (커밋: 06e4054)
   - 페이지 하단에 다른 스타일로 표시되던 문제 해결

4. **AI 프롬프트 재설계** (커밋: 77dec52)
   - TASK A (번역) / TASK B (팩트 추출) / TASK C (인용구) 분리
   - 카테고리 태그: [METRIC], [TOOL], [TECHNIQUE], [DEFINITION], [INSIGHT]
   - 번역문과 주요정보 간 의미론적 중복 문제 해결
   - 인용구 필수 추출 규칙 추가

### 생성된 도구
- `scripts/verify-ai-output.ts` - AI 캐시 출력 검증 도구
  - 태그 분포 확인
  - 번역 중복률 계산
  - 인용구 추출 확인

### 테스트 상태
- 157개 테스트 모두 통과 (100%)

### AI 출력 품질 (검증 결과)
- 불릿 태그 적용률: 100%
- 태그 분포: INSIGHT(9), METRIC(5), TOOL(4), TECHNIQUE(3), DEFINITION(1)
- 인용구 추출: 섹션당 1개씩 11개 추출

---

## 다음 작업

1. **다양한 영상으로 PDF 품질 검증**
   - 다른 유형의 영상으로 테스트 (강연, 튜토리얼, 인터뷰 등)
   - AI 추출 품질 일관성 확인

2. **추가 개선 고려사항**
   - 인용구 품질 개선 (더 임팩트 있는 문장 선택)
   - 카테고리 태그 시각화 (PDF에서 태그별 색상 구분)
   - 긴 영상 처리 최적화

---

## 빠른 참조

### AI 기능 사용 방법

```bash
# 환경변수 설정
export OPENAI_API_KEY=sk-...

# 요약 + 번역 활성화
yt2pdf https://youtube.com/watch?v=... --summary --translate

# 영어로 번역
yt2pdf https://youtube.com/watch?v=... --translate --target-lang en
```

### 설정 파일 경로
- 프로젝트: `./yt2pdf.config.yaml`
- 전역: `~/.config/yt2pdf/config.yaml`

---

## 주의사항

1. **API 키 필수**: AI 기능 사용시 OPENAI_API_KEY 필요
2. **비용 발생**: GPT-4o-mini API 호출시 비용 발생
3. **외부 의존성**: ffmpeg, yt-dlp는 별도 설치 필요

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-01-30 | PDF 품질 개선 + AI 프롬프트 재설계 |
| 2025-01-29 | PDF 품질 개선 (폰트, 자막, 번역) |
| 2025-01-28 | AI 요약, 섹션 요약, 썸네일 추가 |
| 2025-01-27 | AI 기능 구현 (요약 + 번역) |
| 2025-01-26 | 200개 개선사항 적용 |
| 2025-01-26 | 초기 세션 생성, 설계 문서 완료 |

---

*마지막 업데이트: 2026-01-30*
