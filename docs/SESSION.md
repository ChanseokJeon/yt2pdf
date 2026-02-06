# yt2pdf 개발 세션 상태

> 이 파일은 Claude Code가 작업을 재개할 때 컨텍스트를 빠르게 파악하기 위한 파일입니다.

---

## 마지막 세션 정보

| 항목 | 값 |
|------|-----|
| **날짜** | 2026-02-06 |
| **세션 ID** | session-008 |
| **완료한 작업** | 리팩토링 Phase 0 완료 (테스트 인프라 구축) |
| **다음 작업** | Phase 1: PDF Generator 유틸리티 추출 |

---

## 프로젝트 컨텍스트

### 프로젝트 목적
YouTube 영상의 자막과 스크린샷을 추출하여 PDF로 변환하는 CLI + Web Service

### 핵심 기술 결정
- **언어**: Node.js / TypeScript
- **자막**: YouTube 자막 우선, Whisper API 폴백
- **스크린샷**: FFmpeg, 1분 간격, 480p
- **설정**: YAML
- **사용 형태**: CLI + Claude Code Skill + **Web API**
- **AI 기능**: OpenAI GPT (요약, 번역)
- **API 프레임워크**: Hono
- **배포**: Cloud Run (동기 처리) + GCS (Signed URL, 7일 만료)

### 문서 구조
```
docs/
├── ARCHITECTURE.md         # 전체 아키텍처, 데이터 흐름
├── MODULES.md              # 각 모듈 상세 설계, 인터페이스
├── PROGRESS.md             # 마일스톤별 태스크 상태
├── SESSION.md              # 세션 상태 (이 파일)
├── WEB-API-ARCHITECTURE.md # Web API 시스템 아키텍처
├── ISSUE_REVIEW_REPORT.md  # 보안/안정성 리뷰
└── JOBSTORE_PERSISTENCE.md # Redis/SQLite 마이그레이션 가이드
```

---

## 최근 완료한 작업: 리팩토링 Phase 0 (테스트 인프라 구축)

### 커밋 정보
- **최근 커밋**: `0103a92` (2026-02-06)
- **변경**: 6-layer 검증 전략 인프라 완료
- **상태**: Working tree clean (모든 변경 커밋됨)

### 구현 내용

#### 1. PDFKit Mock (0.1)
- `tests/__mocks__/pdfkit.ts`: 전체 PDFKit API mock
- `tests/__mocks__/pdfkit.test.ts`: 48개 mock 동작 테스트
- Call tracking 지원 (assertions 용)

#### 2. 공유 테스트 픽스처 (0.2)
- `tests/fixtures/video-metadata.ts`: 8개 비디오 메타데이터 변형
- `tests/fixtures/subtitles.ts`: 9개 자막 세트 (한/영)
- `tests/fixtures/chapters.ts`: 13개 챕터 구조
- `tests/helpers/mock-factory.ts`: 20+ 팩토리 함수

#### 3. 시각적 회귀 테스트 설정 (0.4)
- `tests/visual/capture-baseline.ts`: PDF to PNG 변환
- `tests/visual/visual-regression.test.ts`: 이미지 비교 테스트
- jest-image-snapshot, pdf2pic 설치

#### 4. 6-Layer 검증 스크립트
- `npm run test:char`: 특성화 테스트
- `npm run test:golden`: 골든 마스터 테스트
- `npm run test:contract`: 계약 테스트
- `npm run test:visual`: 시각적 회귀 테스트
- `npm run depcruise:validate`: 의존성 검증
- `npm run verify:all`: 전체 검증

### 테스트 현황
- **전체 테스트**: 693개 통과
- **빌드**: 0 에러
- **린트**: 0 에러

---

## 다음 작업 (session-009)

### 리팩토링 Phase 1: PDF Generator 유틸리티 추출
> **계획 문서**: `.omc/plans/refactoring-plan.md`

1. **텍스트 정규화 모듈 (1.1)**
   - `src/utils/text-normalizer.ts` 생성
   - `normalizeTextForPDF()`, `sanitizeForAI()` 추출
   - 90%+ 테스트 커버리지

2. **이미지 유틸리티 모듈 (1.2)**
   - `src/utils/image.ts` 생성
   - `downloadImageToBuffer()`, 폰트 경로 유틸리티 추출
   - 90%+ 테스트 커버리지

3. **언어 유틸리티 통합 (1.3)**
   - `src/utils/language.ts` 생성
   - `getLanguageName()`, `LANGUAGE_MAP` 통합
   - 중복 제거

4. **formatTimestamp 이동 (1.4)**
   - `src/utils/time.ts` 생성
   - `formatTimestamp()`, `parseTimestamp()` 구현
   - 하위 호환성 유지

### 검증 방법
```bash
npm run verify:all  # 전체 6-layer 검증
```

### 블로커 (별도 해결 필요)
- **YouTube IP Blocking**: Cloud Run 배포에 Residential Proxy 필요 ($6/월)

---

## 이전 세션 기록

### session-008 (2026-02-06): 리팩토링 Phase 0 완료
- 6-layer 검증 전략 인프라 구축
- PDFKit mock, 테스트 픽스처, 시각적 회귀 테스트 설정
- 693개 테스트 통과, 빌드/린트 0 에러

### session-007 (2026-02-06): Token 최적화 + ESLint 정리
- translatedText 필드 제거로 토큰 최적화
- ESLint 627개 에러 → 0개로 정리
- RALPLAN으로 리팩토링 계획 수립

### session-006 (2026-02-04): Cloud Run + GCS 배포
- Cloud Run + GCS 배포 설계 및 구현
- 빌드 및 기본 배포 테스트

### session-005 (2026-02-02): Web Service API + 클라우드 추상화
- REST API (Hono 프레임워크) 구현
- AWS/GCP/Local 클라우드 프로바이더 추상화
- 596개 테스트, 94%+ 커버리지

### session-004 (2026-01-30): PDF 품질 개선
- PDF 중복 콘텐츠 문제 해결
- AI 프롬프트 재설계 (TASK A/B/C 분리)
- 157개 테스트 통과

---

## 빠른 참조

### CLI 사용 방법

```bash
# 환경변수 설정
export OPENAI_API_KEY=sk-...

# 요약 + 번역 활성화
yt2pdf https://youtube.com/watch?v=... --summary --translate

# 영어로 번역
yt2pdf https://youtube.com/watch?v=... --translate --target-lang en
```

### Web API 사용 방법

```bash
# 서버 시작
npm run api:start

# Job 생성
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=..."}'

# Job 상태 확인
curl http://localhost:3000/api/v1/jobs/{jobId}
```

### 설정 파일 경로
- 프로젝트: `./yt2pdf.config.yaml`
- 전역: `~/.config/yt2pdf/config.yaml`

### 클라우드 프로바이더 설정
```bash
# AWS
export CLOUD_PROVIDER=aws
export AWS_REGION=us-east-1

# GCP
export CLOUD_PROVIDER=gcp
export GCP_PROJECT_ID=your-project

# Local (기본값)
export CLOUD_PROVIDER=local
```

---

## 주의사항

1. **API 키 필수**: AI 기능 사용시 OPENAI_API_KEY 필요
2. **비용 발생**: GPT-4o-mini API 호출시 비용 발생
3. **외부 의존성**: ffmpeg, yt-dlp는 별도 설치 필요
4. **JobStore**: 현재 In-memory (프로덕션 전 Redis 전환 필요)

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-02-06 | 리팩토링 Phase 0 완료 - 테스트 인프라 구축 (session-008) |
| 2026-02-06 | Token 최적화 + ESLint 정리 + 리팩토링 계획 수립 (session-007) |
| 2026-02-04 | Cloud Run + GCS 배포 설계 및 구현 |
| 2026-02-02 | Web Service API + 클라우드 프로바이더 추상화 |
| 2026-01-30 | PDF 품질 개선 + AI 프롬프트 재설계 |
| 2025-01-29 | PDF 품질 개선 (폰트, 자막, 번역) |
| 2025-01-28 | AI 요약, 섹션 요약, 썸네일 추가 |
| 2025-01-27 | AI 기능 구현 (요약 + 번역) |
| 2025-01-26 | 200개 개선사항 적용 |
| 2025-01-26 | 초기 세션 생성, 설계 문서 완료 |

---

*마지막 업데이트: 2026-02-06*
