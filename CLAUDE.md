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

### Tool rule
1. never use 'rm -rf' without confirmation.

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

## 기술 스택

- **언어**: Node.js / TypeScript
- **자막**: YouTube 자막 우선, OpenAI Whisper API 폴백
- **스크린샷**: FFmpeg (1분 간격, 480p)
- **설정**: YAML (yt2pdf.config.yaml)
- **사용 형태**: CLI + Claude Code Skill (/yt2pdf)

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
