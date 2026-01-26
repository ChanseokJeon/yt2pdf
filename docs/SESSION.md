# yt2pdf 개발 세션 상태

> 이 파일은 Claude Code가 작업을 재개할 때 컨텍스트를 빠르게 파악하기 위한 파일입니다.

---

## 마지막 세션 정보

| 항목 | 값 |
|------|-----|
| **날짜** | 2025-01-26 |
| **세션 ID** | session-001 |
| **완료한 작업** | 설계 문서 작성 (SPEC, ARCHITECTURE, MODULES, PROGRESS) |
| **다음 작업** | Phase 0.5 - package.json 생성 |

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

### 문서 구조
```
docs/
├── ARCHITECTURE.md   # 전체 아키텍처, 데이터 흐름
├── MODULES.md        # 각 모듈 상세 설계, 인터페이스
├── PROGRESS.md       # 마일스톤별 태스크 상태
└── SESSION.md        # 세션 상태 (이 파일)
```

---

## 현재 Phase: 0 (프로젝트 초기화)

### 완료된 태스크
- [x] 0.1 스펙 문서 작성 → `SPEC.md`
- [x] 0.2 아키텍처 설계 → `docs/ARCHITECTURE.md`
- [x] 0.3 모듈 상세 설계 → `docs/MODULES.md`
- [x] 0.4 진행 관리 문서 → `docs/PROGRESS.md`

### 다음 태스크
- [ ] 0.5 package.json 생성
- [ ] 0.6 tsconfig.json 설정
- [ ] 0.7 ESLint/Prettier 설정
- [ ] 0.8 디렉토리 구조 생성
- [ ] 0.9 .env.example 생성
- [ ] 0.10 기본 설정 파일 생성

---

## 빠른 참조

### 의존성 패키지 (package.json에 추가할 것)

**Production**:
```
commander, ora, cli-progress, chalk, inquirer, yaml, dotenv,
pdfkit, puppeteer, marked, openai, p-limit, p-retry, winston, zod
```

**Dev**:
```
typescript, @types/node, jest, ts-jest, @types/jest,
eslint, @typescript-eslint/*, prettier, tsx, rimraf
```

### 디렉토리 구조 (생성할 것)
```
src/
├── cli/commands/
├── cli/ui/
├── core/
├── providers/
├── templates/pdf/
├── utils/
└── types/
bin/
templates/themes/
scripts/
tests/unit/
tests/integration/
tests/e2e/
tests/fixtures/
```

### CLI 명령어 구조
```bash
yt2pdf <url> [options]          # 기본 변환
yt2pdf config [show|init|set]   # 설정 관리
yt2pdf cache [show|clear]       # 캐시 관리
yt2pdf setup                    # 의존성 설치
```

---

## 재개 명령어

작업을 재개할 때 Claude에게 전달할 프롬프트:

```
docs/SESSION.md와 docs/PROGRESS.md를 읽고 다음 태스크를 이어서 진행해줘.
```

또는 특정 태스크를 지정:

```
docs/PROGRESS.md의 태스크 0.5 (package.json 생성)를 진행해줘.
```

---

## 주의사항

1. **외부 의존성**: ffmpeg, yt-dlp는 별도 설치 필요
2. **API 키**: OpenAI API 키 필요 (Whisper 사용 시)
3. **테스트**: 실제 YouTube URL로 테스트 시 API 호출 발생

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2025-01-26 | 초기 세션 생성, 설계 문서 완료 |

---

*마지막 업데이트: 2025-01-26*
