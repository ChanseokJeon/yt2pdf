# YouTube to PDF (yt2pdf) 기술 스펙 문서

## 1. 프로젝트 개요

### 1.1 목적
YouTube 영상의 자막과 스크린샷을 추출하여 학습/참고용 PDF 문서로 변환하는 CLI 도구

### 1.2 사용 형태
- **CLI 도구**: `yt2pdf <URL> [options]`
- **Claude Code Skill**: `/yt2pdf <URL>`

### 1.3 기술 스택
- **언어**: Node.js / TypeScript
- **설정 파일**: YAML (`yt2pdf.config.yaml`)
- **배포**: GitHub 전용 (npx 또는 clone)

---

## 2. 핵심 기능

### 2.1 자막 추출
| 항목 | 상세 |
|------|------|
| **우선순위** | YouTube 자막 → OpenAI Whisper API |
| **지원 언어** | 한국어, 영어 |
| **폴백** | YouTube 자막 없을 시 Whisper로 자동 생성 |

### 2.2 스크린샷 캡처
| 항목 | 상세 |
|------|------|
| **캡처 방식** | 일정 간격 자동 캡처 |
| **기본 간격** | 1분 (사용자 설정 가능) |
| **화질** | 480p (용량 우선) |

### 2.3 PDF 생성
| 항목 | 상세 |
|------|------|
| **레이아웃** | 사용자 선택 가능 (스크린샷+하단자막, 좌우분할 등) |
| **테마** | 복수 테마 중 선택 가능 |
| **목차** | 타임스탬프 기반 TOC 자동 생성 |
| **타임스탬프 링크** | PDF 내 타임스탬프 클릭 시 YouTube 해당 시점으로 이동 |
| **검색 가능** | 텍스트 검색 가능한 PDF |

### 2.4 출력 포맷
- PDF (기본)
- Markdown
- HTML

### 2.5 플레이리스트 지원
- 플레이리스트 URL 입력 시 각 영상별 개별 PDF 생성
- 파일명: `YYYYMMDD_순번_영상제목.pdf`

---

## 3. CLI 인터페이스

### 3.1 기본 사용법
```bash
yt2pdf <YouTube-URL> [options]
```

### 3.2 주요 옵션
```bash
Options:
  -o, --output <path>      출력 디렉토리 (기본: ./output)
  -f, --format <type>      출력 포맷: pdf, md, html (기본: pdf)
  -i, --interval <sec>     스크린샷 간격 (초) (기본: 60)
  -l, --layout <type>      PDF 레이아웃: vertical, horizontal (기본: vertical)
  -t, --theme <name>       PDF 테마 선택
  -q, --quality <level>    스크린샷 품질: low, medium, high (기본: low)
  --lang <code>            자막 언어: ko, en (기본: 자동감지)
  --no-cache               캐시 사용 안함
  --verbose                상세 로그 출력
  -h, --help               도움말 표시
  -v, --version            버전 표시
```

### 3.3 사용 예시
```bash
# 기본 사용
yt2pdf https://youtube.com/watch?v=xxxxx

# 옵션과 함께
yt2pdf https://youtube.com/watch?v=xxxxx -o ./docs -f md -i 30

# 플레이리스트
yt2pdf https://youtube.com/playlist?list=xxxxx
```

---

## 4. Claude Code Skill

### 4.1 사용법
```
/yt2pdf <YouTube-URL>
```

### 4.2 지원 옵션
- URL (필수)
- 출력 경로 (선택)

### 4.3 결과 표시
변환 완료 후 요약 정보 출력:
- 생성된 파일 경로
- 페이지 수
- 파일 용량

---

## 5. 설정 파일

### 5.1 파일 위치
- 프로젝트: `./yt2pdf.config.yaml`
- 전역: `~/.config/yt2pdf/config.yaml`

### 5.2 설정 예시
```yaml
# yt2pdf.config.yaml

output:
  directory: ./output
  format: pdf
  filename_pattern: "{date}_{index}_{title}"

screenshot:
  interval: 60          # 초
  quality: low          # low(480p), medium(720p), high(1080p)

subtitle:
  priority: youtube     # youtube, whisper
  languages:
    - ko
    - en

pdf:
  layout: vertical      # vertical, horizontal
  theme: default        # default, note, minimal
  include_toc: true
  timestamp_links: true
  searchable: true

whisper:
  provider: openai      # openai, groq, local
  # API 키는 .env 또는 환경변수에서 로드

cache:
  enabled: true
  ttl: 7                # 일

processing:
  max_duration: 7200    # 초 (2시간)
  parallel: true
  retry_count: 3
```

---

## 6. API 키 관리

### 6.1 우선순위
1. `.env` 파일
2. 시스템 환경변수

### 6.2 필요한 API 키
```env
# .env
OPENAI_API_KEY=sk-xxx        # Whisper API용 (자막 없을 때)
```

---

## 7. 의존성

### 7.1 외부 의존성
| 도구 | 용도 | 설치 방법 |
|------|------|----------|
| ffmpeg | 영상 처리, 스크린샷 추출 | 자동 설치 스크립트 |
| yt-dlp | YouTube 다운로드 | npm 의존성 |

### 7.2 자동 설치
```bash
yt2pdf setup    # 필요한 외부 의존성 자동 설치
```

---

## 8. 아키텍처

### 8.1 처리 파이프라인
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   URL 입력   │ -> │  메타데이터   │ -> │  병렬 처리   │ -> │  PDF 생성   │
│             │    │    추출      │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                            │
                         ┌──────────────────┼──────────────────┐
                         ▼                  ▼                  ▼
                   ┌──────────┐      ┌──────────┐      ┌──────────┐
                   │ 영상 다운 │      │ 자막 추출 │      │스크린샷  │
                   │ (스트리밍)│      │          │      │  캡처    │
                   └──────────┘      └──────────┘      └──────────┘
```

### 8.2 성능 최적화
- **병렬 처리**: 자막 추출과 스크린샷 캡처를 병렬로 수행
- **스트리밍**: 다운로드하면서 동시에 처리 시작
- **캐시**: 동일 영상 재변환 시 캐시 활용

### 8.3 디렉토리 구조
```
yt2pdf/
├── src/
│   ├── cli/              # CLI 관련
│   │   ├── index.ts
│   │   └── commands/
│   ├── core/             # 핵심 로직
│   │   ├── downloader.ts
│   │   ├── subtitle.ts
│   │   ├── screenshot.ts
│   │   └── pdf-generator.ts
│   ├── providers/        # 외부 서비스 연동
│   │   ├── youtube.ts
│   │   └── whisper.ts
│   ├── utils/
│   │   ├── config.ts
│   │   ├── cache.ts
│   │   └── logger.ts
│   └── types/
│       └── index.ts
├── templates/            # PDF 테마 템플릿
│   ├── default/
│   ├── note/
│   └── minimal/
├── scripts/
│   └── setup.sh          # 의존성 설치 스크립트
├── tests/
├── docs/
├── .env.example
├── yt2pdf.config.yaml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 9. 에러 처리

### 9.1 재시도 정책
- 실패 시 최대 3회 자동 재시도
- 재시도 간격: 지수 백오프 (1초, 2초, 4초)

### 9.2 주요 에러 케이스
| 에러 | 처리 방식 |
|------|----------|
| YouTube 자막 없음 | Whisper로 폴백 |
| 영상 비공개/삭제됨 | 에러 메시지 출력 후 다음 영상 처리 |
| API 키 없음/유효하지 않음 | 설정 안내 메시지 출력 |
| 네트워크 오류 | 재시도 후 실패 시 에러 메시지 |
| 2시간 초과 영상 | 경고 표시 후 사용자 확인 요청 |

---

## 10. 비용 관리

### 10.1 예상 비용 표시
변환 전 예상 API 비용 표시:
```
예상 비용:
- Whisper API: ~$0.12 (30분 영상 기준)
계속하시겠습니까? (Y/n)
```

### 10.2 비용 계산 기준
- OpenAI Whisper: $0.006/분

---

## 11. 오프라인 지원

### 11.1 지원 범위
| 기능 | 온라인 | 오프라인 |
|------|--------|----------|
| YouTube 자막 있는 영상 | ✅ | ✅ (캐시된 경우) |
| YouTube 자막 없는 영상 | ✅ (Whisper) | ❌ |

### 11.2 캐시 관리
- 기본 캐시 유지 기간: 7일
- 캐시 위치: `~/.cache/yt2pdf/`
- 수동 정리: `yt2pdf cache clear`

---

## 12. 개발 마일스톤

### Phase 1: MVP (핵심 기능)
- [ ] 프로젝트 초기 설정 (TypeScript, ESLint, Prettier)
- [ ] YouTube 메타데이터 추출
- [ ] YouTube 자막 추출
- [ ] 일정 간격 스크린샷 캡처
- [ ] 기본 PDF 생성 (자막 + 스크린샷)
- [ ] CLI 기본 명령어

### Phase 2: Whisper 통합
- [ ] OpenAI Whisper API 연동
- [ ] 자막 없는 영상 처리
- [ ] 예상 비용 표시 기능

### Phase 3: 고급 기능
- [ ] 플레이리스트 지원
- [ ] 다양한 PDF 레이아웃/테마
- [ ] 타임스탬프 링크
- [ ] Markdown/HTML 출력
- [ ] 캐시 시스템

### Phase 4: Claude Code Skill
- [ ] Skill 프롬프트 작성
- [ ] 통합 테스트

### Phase 5: 문서화 및 배포
- [ ] 상세 README 작성
- [ ] API 문서
- [ ] 예제 및 튜토리얼
- [ ] GitHub 릴리즈

---

## 13. 테스트 전략

### 13.1 테스트 종류
- **Unit Test**: 각 모듈별 단위 테스트
- **Integration Test**: 파이프라인 통합 테스트
- **E2E Test**: 실제 YouTube 영상으로 전체 플로우 테스트

### 13.2 테스트 도구
- Jest
- ts-jest

### 13.3 커버리지 목표
- 전체 커버리지: 80% 이상

---

## 14. 문서화

### 14.1 제공 문서
- README.md: 빠른 시작 가이드
- INSTALL.md: 상세 설치 가이드
- CONFIG.md: 설정 옵션 상세 설명
- API.md: 프로그래밍 방식 사용법
- TROUBLESHOOTING.md: 문제 해결 가이드

### 14.2 CLI 도움말
- `yt2pdf --help`: 전체 명령어 도움말
- `yt2pdf <command> --help`: 개별 명령어 도움말

---

## 15. 우려사항 및 대응

### 15.1 처리 시간
| 우려 | 대응 |
|------|------|
| 긴 영상 처리 시간 | 병렬 처리 + 스트리밍으로 최적화 |
| 진행 상황 파악 어려움 | 프로그레스 바로 실시간 표시 |
| 중간 실패 시 처음부터 | 체크포인트 저장으로 이어서 처리 |

### 15.2 YouTube 정책 변경
- yt-dlp 정기 업데이트로 대응
- 영상 다운로드 실패 시 대안 경로 안내

---

## 16. 버전 정보

- **문서 버전**: 1.0.0
- **작성일**: 2025-01-26
- **작성자**: Claude (인터뷰 기반)

---

## 부록 A: PDF 레이아웃 예시

### Vertical (기본)
```
┌─────────────────────────┐
│                         │
│      [스크린샷]          │
│                         │
├─────────────────────────┤
│ 00:01:00                │
│ 자막 텍스트가 여기에     │
│ 표시됩니다.              │
└─────────────────────────┘
```

### Horizontal (좌우 분할)
```
┌────────────┬────────────┐
│            │ 00:01:00   │
│ [스크린샷]  │ 자막 텍스트│
│            │ 가 여기에  │
│            │ 표시됩니다. │
└────────────┴────────────┘
```

---

## 부록 B: Claude Code Skill 프롬프트

```markdown
# /yt2pdf

YouTube 영상을 PDF로 변환합니다.

## 사용법
/yt2pdf <YouTube-URL>

## 예시
/yt2pdf https://youtube.com/watch?v=xxxxx

## 동작
1. YouTube URL에서 영상 정보 추출
2. 자막 추출 (없으면 Whisper로 생성)
3. 1분 간격 스크린샷 캡처
4. PDF 문서 생성

## 출력
- 파일 경로
- 페이지 수
- 파일 용량
```
