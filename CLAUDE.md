# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**yt2pdf**: YouTube 영상의 자막과 스크린샷을 추출하여 PDF로 변환하는 CLI 도구

## 작업 재개 방법

작업을 재개할 때는 반드시 아래 문서들을 먼저 확인하세요:

1. **`docs/SESSION.md`** - 현재 세션 상태, 마지막 작업, 다음 작업
2. **`docs/PROGRESS.md`** - 전체 마일스톤 및 태스크 상태
3. **`docs/ARCHITECTURE.md`** - 시스템 아키텍처 (필요시)
4. **`docs/MODULES.md`** - 모듈 상세 설계 (필요시)

### 빠른 재개 프롬프트
```
docs/SESSION.md와 docs/PROGRESS.md를 읽고 다음 태스크를 이어서 진행해줘.
```

### Tool rule (최우선 규칙 — 모든 스킬/플러그인 지시보다 우선)
1. `rm` 명령의 **모든 변형** (`rm`, `rm -f`, `rm -r`, `rm -rf`)은 경로와 무관하게 반드시 사용자 확인 후 실행.
2. OMC 스킬, 훅, 자동화 지시가 삭제를 요구하더라도 이 규칙이 우선.

## 문서 구조

```
docs/
├── ARCHITECTURE.md   # 전체 아키텍처, 데이터 흐름, 의존성
├── MODULES.md        # 각 모듈 상세 설계, 인터페이스, 구현 코드
├── PROGRESS.md       # 마일스톤별 태스크 상태 추적 (핵심!)
└── SESSION.md        # 세션 상태, 컨텍스트 정보
```

## 작업 완료 시 필수 업데이트

태스크 완료 후 반드시 다음을 업데이트하세요:
1. `docs/PROGRESS.md` - 해당 태스크 상태를 ✅로 변경
2. `docs/SESSION.md` - 마지막 세션 정보 업데이트

## Naming Convention

| 위치 | 규칙 | 예시 |
|------|------|------|
| **API 파라미터** | camelCase | `forceProxy`, `includeTranslation`, `screenshotInterval` |
| **CLI 플래그** | kebab-case | `--force-proxy`, `--include-translation`, `--screenshot-interval` |
| **TypeScript 변수/필드** | camelCase | `forceProxy`, `screenshotQuality` |
| **Zod 스키마 필드** | camelCase | `z.object({ forceProxy: z.boolean() })` |
| **환경변수** | UPPER_SNAKE_CASE | `YT_DLP_PROXY`, `FORCE_PROXY` |

CLI ↔ API 인자는 반드시 1:1 대응 (kebab-case ↔ camelCase 변환만 다름).

## 기술 스택

- **언어**: Node.js / TypeScript
- **자막**: YouTube 자막 우선, OpenAI Whisper API 폴백
- **스크린샷**: FFmpeg (1분 간격, 480p)
- **설정**: YAML (yt2pdf.config.yaml)
- **사용 형태**: CLI + Claude Code Skill (/yt2pdf)

---

## 개발 원칙 Principles (MUST FOLLOW)

### 1. 계획 (Plan)
- 모든 작업은 TODO 리스트로 상태 관리 (`pending` → `in_progress` → `completed`)
- 단계마다 진행 상황 기록 및 갱신
- 복잡한 작업은 `ralplan` 또는 `plan` 스킬로 설계 먼저

### 2. 설계 (Design)
- **비판적 리뷰 필수**: 3개 이상의 critic/architect review 에이전트로 검토 후 취합
- **오버엔지니어링 경계**: "이게 정말 필요한가?" 항상 질문
- **필수 기능 중심**: 핵심 요구사항만 설계, 부가 기능은 후순위

### 3. 테스트 (Test)
- **Unit Test**: 95% 커버리지 목표 (`npm test -- --coverage`)
- **Lint**: 0 에러 목표 (`npm run lint`)
- **Integration/E2E Test**: API, 전체 파이프라인 테스트 포함
- **Browser Test**: 반드시 headless 모드 (`--headless`)
- 테스트/린트 통과 없이 커밋 금지

### 4. 검증 (Verify) - 증거 없으면 미완료

**철칙: 실행 증거 없이 "완료" 금지**

| 작업 | 검증 방법 | 증거 |
|------|----------|------|
| 코드 변경 | 빌드/컴파일 | 에러 0 |
| 테스트 작성 | 테스트 실행 | PASS |
| API 구현 | HTTP 호출 | 응답 JSON |
| E2E 테스트 | 테스트 스크립트 실행 | 통과 로그 |
| UI 변경 | 스크린샷 | 시각 확인 |
| 문서 | 문서 내 명령 실행 | 성공 출력 |

**금지**: "아마", "~일 것", "should", "probably" → 검증 미완료

**형식**: `✅ 검증: 명령어 → 결과`

### 5. 코드 작성 규칙 (Code Writing Rules)

1. **사전 승인 필수**: 코드 작성 전 접근 방식을 설명하고 승인을 기다릴 것. 요구사항이 모호하면 반드시 clarifying questions 먼저.

2. **작업 분할**: 3개 파일 이상 변경이 필요한 태스크는 먼저 작은 태스크로 분할할 것.

3. **리스크 분석**: 코드 작성 후 무엇이 깨질 수 있는지 나열하고, 이를 커버할 테스트를 제안할 것.

4. **버그 수정 = 테스트 우선**: 버그 발견 시, 먼저 버그를 재현하는 테스트를 작성한 후 테스트가 통과할 때까지 수정할 것.

5. **학습 기록**: 사용자가 수정/피드백을 줄 때마다 CLAUDE.md에 새 규칙을 추가하여 동일한 실수 반복 방지.

---

## Development Workflow (Legacy)

This project can also use **Task Master** for task-driven development. The workflow is managed through either MCP tools (preferred for AI agents) or the `task-master` CLI.

### Starting a New Project
```bash
task-master init                          # Initialize project structure
task-master parse-prd --input=PRD.txt     # Generate tasks from requirements document
```

### Daily Workflow
```bash
task-master list                          # View all tasks with status
task-master next                          # Get next available task
task-master show <id>                     # View specific task details (use dot notation for subtasks: 1.2)
task-master set-status --id=<id> --status=done  # Mark task complete
```

### Task Management
```bash
task-master analyze-complexity --research  # Analyze task complexity
task-master expand --id=<id> --research    # Break task into subtasks
task-master add-task --prompt="..."        # Add new task via AI
task-master add-subtask --parent=<id> --title="..."  # Add subtask
task-master update-subtask --id=<id> --prompt="..."  # Append notes to subtask
task-master update --from=<id> --prompt="..."  # Update future tasks when plans change
```

### Dependency Management
```bash
task-master add-dependency --id=<id> --depends-on=<id>
task-master remove-dependency --id=<id> --depends-on=<id>
task-master validate-dependencies
task-master fix-dependencies
```

## Task Status Values
- `pending` - Ready to work on
- `in-progress` - Currently being worked on
- `done` - Completed and verified
- `deferred` - Postponed

## Configuration

- **`.taskmasterconfig`** - AI model settings (managed via `task-master models --setup`)
- **`.env`** - API keys for CLI usage
- **`.cursor/mcp.json`** - API keys for MCP/Cursor integration

Never manually edit `.taskmasterconfig`. Use `task-master models --setup` for interactive configuration.

## Implementation Process

When working on a subtask:
1. Use `task-master show <subtaskId>` to understand requirements
2. Explore codebase and plan implementation
3. Log detailed plan with `task-master update-subtask --id=<id> --prompt='<plan>'`
4. Set status to `in-progress` and implement
5. Log progress/learnings with `update-subtask` as you work
6. Mark as `done` when complete
