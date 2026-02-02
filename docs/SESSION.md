# yt2pdf 개발 세션 상태

> 이 파일은 Claude Code가 작업을 재개할 때 컨텍스트를 빠르게 파악하기 위한 파일입니다.

---

## 마지막 세션 정보

| 항목 | 값 |
|------|-----|
| **날짜** | 2026-02-02 |
| **세션 ID** | session-005 |
| **완료한 작업** | Web Service API + 클라우드 프로바이더 추상화 |
| **다음 작업** | 프로덕션 배포 준비 (JobStore 영속화, 인증, Dockerfile) |

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
- **클라우드**: AWS (S3/SQS), GCP (Storage/Pub/Sub), Local

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

## 최근 완료한 작업: Web Service API + 클라우드 추상화

### 커밋 정보
- **커밋**: `5bb2e82` (2026-02-02)
- **변경**: 58개 파일, +15,016줄
- **테스트**: 596개 테스트, 94%+ 커버리지

### 구현 내용

#### 1. REST API (Hono 프레임워크)
| Endpoint | 설명 |
|----------|------|
| `POST /api/v1/jobs` | Job 생성 (URL → 큐 등록) |
| `GET /api/v1/jobs/:id` | Job 상태 + 다운로드 URL |
| `DELETE /api/v1/jobs/:id` | Job 취소 |
| `GET /api/v1/jobs` | 사용자 Job 목록 |
| `POST /api/v1/analyze` | 영상 분석 (비용/시간 추정) |
| `GET /api/v1/health` | 헬스체크 (deep/shallow) |

#### 2. 클라우드 프로바이더 추상화
| Provider | Storage | Queue |
|----------|---------|-------|
| AWS | S3 | SQS |
| GCP | Cloud Storage | Pub/Sub |
| Local | 파일시스템 | 메모리 큐 |

#### 3. 보안 수정
- Command Injection → `execFileAsync` 배열 인자
- Path Traversal → `path.resolve` 검증
- NACK 버그 → in-flight 메시지 추적
- Singleton 경쟁 → Promise 기반 락
- 타이머 메모리 누수 → `clearTimeout` 적용

#### 4. 파일 구조
```
src/
├── api/           # REST API 서버
│   ├── server.ts  # 진입점 (graceful shutdown)
│   ├── app.ts     # 미들웨어 설정
│   ├── routes/    # jobs, analyze, health
│   ├── models/    # Job 모델 + Zod 스키마
│   └── store/     # In-memory JobStore
├── cloud/         # 클라우드 추상화
│   ├── interfaces.ts
│   ├── factory.ts
│   ├── aws/       # S3 + SQS
│   ├── gcp/       # Storage + Pub/Sub
│   └── local/     # 개발용
└── worker/        # 백그라운드 워커
    ├── processor.ts
    └── run.ts
```

---

## 다음 작업

### 프로덕션 배포 준비
1. **JobStore 영속화**: In-memory → Redis 또는 SQLite
2. **인증/인가**: API Key 또는 OAuth 추가
3. **Rate Limiting**: 요청 제한
4. **Dockerfile**: 컨테이너화
5. **CI/CD**: GitHub Actions 배포 파이프라인

### 추가 개선 고려사항
- 인용구 품질 개선
- 카테고리 태그 시각화
- 긴 영상 처리 최적화

---

## 이전 세션 기록

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
| 2026-02-02 | Web Service API + 클라우드 프로바이더 추상화 |
| 2026-01-30 | PDF 품질 개선 + AI 프롬프트 재설계 |
| 2025-01-29 | PDF 품질 개선 (폰트, 자막, 번역) |
| 2025-01-28 | AI 요약, 섹션 요약, 썸네일 추가 |
| 2025-01-27 | AI 기능 구현 (요약 + 번역) |
| 2025-01-26 | 200개 개선사항 적용 |
| 2025-01-26 | 초기 세션 생성, 설계 문서 완료 |

---

*마지막 업데이트: 2026-02-02*
