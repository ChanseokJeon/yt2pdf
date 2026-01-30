# 파일명 및 저장 정책

> yt2pdf 출력 파일의 명명 규칙과 폴더 구조 정책 문서

**작성일**: 2026-01-27
**적용 버전**: v0.2.0+

---

## 목차

1. [개요](#개요)
2. [파일명 패턴](#파일명-패턴)
3. [폴더 구조](#폴더-구조)
4. [설정 방법](#설정-방법)
5. [파일명 정리 규칙](#파일명-정리-규칙)
6. [실제 예시](#실제-예시)
7. [설정 우선순위](#설정-우선순위)
8. [사용 예시](#사용-예시)

---

## 개요

yt2pdf는 YouTube 영상을 처리할 때 생성되는 파일들을 체계적으로 관리하기 위해 파일명 패턴과 폴더 구조 정책을 제공합니다.

### 주요 특징

- **유연한 패턴**: 다양한 변수를 조합하여 파일명 생성
- **자동 정리**: 특수문자 제거, 공백 치환으로 안전한 파일명 생성
- **출력 포맷 지원**: PDF, Markdown, HTML, Executive Brief
- **계층적 폴더 구조**: 날짜, 채널, 영상 ID별로 자동 정렬 가능
- **캐시 관리**: 별도의 캐시 디렉토리로 임시 파일 격리

---

## 파일명 패턴

### 지원 변수

| 변수 | 설명 | 예시 | 형식 |
|------|------|------|------|
| `{date}` | 파일 생성 날짜 (YYYYMMDD) | `20260127` | 8자 고정 |
| `{timestamp}` | 파일 생성 시간 (YYYYMMDD_HHMMSS) | `20260127_143052` | 15자 고정 |
| `{videoId}` | YouTube 영상 고유 ID | `dQw4w9WgXcQ` | 11자 고정 |
| `{channel}` | 채널명 (영상 메타데이터) | `AI_Engineer` | 가변 |
| `{index}` | 순서 번호 (플레이리스트 용) | `001` | 3자 고정 |
| `{title}` | 영상 제목 | `Building_AI_Apps` | 가변 (정제됨) |

### 기본 패턴

```yaml
# yt2pdf.config.yaml의 기본값
output:
  filenamePattern: "{timestamp}_{title}"
```

**기본값의 특징**:
- `{timestamp}`으로 시간 기반 고유성 보장
- `{title}`로 파일 내용을 쉽게 파악 가능
- 플레이리스트에서도 각 영상별로 고유한 파일명 생성

### 권장 패턴

| 용도 | 패턴 | 예시 | 장점 |
|------|------|------|------|
| **일반 사용 (기본)** | `{timestamp}_{title}` | `20260127_143052_Building_AI_Apps` | 시간 기반 정렬 + 제목 파악 |
| **영상 ID 추적** | `{date}_{videoId}` | `20260127_dQw4w9WgXcQ` | 영상 재다운로드 시 식별 용이 |
| **채널별 정리** | `{channel}_{timestamp}` | `AI_Engineer_20260127_143052` | 채널별로 묶여서 정렬됨 |
| **날짜 기반** | `{date}_{videoId}_{title}` | `20260127_dQw4w9WgXcQ_Building_AI_Apps` | 모든 정보 포함 |
| **플레이리스트용** | `{index}_{title}` | `001_Introduction`, `002_Main_Content` | 순서대로 정렬 |

### 커스텀 패턴 사용

패턴에 고정 텍스트도 포함할 수 있습니다:

```yaml
# 예 1: 날짜별 폴더 구조
filenamePattern: "{date}/{title}"

# 예 2: 채널별 정리 + 날짜
filenamePattern: "{channel}/{date}_{title}"

# 예 3: 상세 정보 포함
filenamePattern: "yt2pdf_{timestamp}_{videoId}_{title}"

# 예 4: 단순 제목만
filenamePattern: "{title}"
```

---

## 폴더 구조

### 기본 출력 구조

```
output/                              # 기본 출력 디렉토리
├── 20260127_143052_Video_Title.pdf  # PDF 출력
├── 20260127_143052_Video_Title.md   # Markdown 출력
├── 20260127_143052_Video_Title.html # HTML 출력
├── 20260127_143052_Video_Title_brief.pdf  # Executive Brief
└── images/                          # Markdown/HTML용 이미지
    ├── screenshot_0001.jpg
    ├── screenshot_0002.jpg
    └── ...
```

### 채널별 폴더 구조 (권장)

패턴: `{channel}/{timestamp}_{title}`

```
output/
├── AI_Engineer/
│   ├── 20260127_143052_Building_AI_Apps.pdf
│   ├── 20260127_143052_Building_AI_Apps.md
│   ├── 20260127_143052_Building_AI_Apps_brief.pdf
│   └── images/
│       ├── screenshot_0001.jpg
│       └── ...
├── Tech_Talks/
│   ├── 20260126_101530_Python_Tips.pdf
│   └── ...
└── Educational_Content/
    └── ...
```

### 날짜별 폴더 구조

패턴: `{date}/{videoId}_{title}`

```
output/
├── 20260127/
│   ├── dQw4w9WgXcQ_Building_AI_Apps.pdf
│   └── ...
├── 20260126/
│   ├── xyz123abc456_Python_Tips.pdf
│   └── ...
└── 20260125/
    └── ...
```

### 임시 파일 구조 (처리 중)

```
/tmp/
└── yt2pdf-<random>/          # 처리 중 임시 디렉토리
    ├── video.mp4             # 다운로드 영상
    ├── audio.mp3             # 오디오 (Whisper API용)
    ├── screenshot_0000.jpg   # 캡처한 스크린샷
    ├── screenshot_0001.jpg
    └── ...
```

**임시 파일 특징**:
- 처리 완료 후 자동 삭제
- 무작위 suffix로 동시 작업 충돌 방지
- OS의 `/tmp` 또는 `%TEMP%` 디렉토리 사용

### 캐시 디렉토리 구조

```
~/.cache/yt2pdf/                # 전역 캐시 디렉토리
├── subtitles/
│   ├── ko_<videoId>.json       # 한국어 자막 캐시
│   ├── en_<videoId>.json       # 영어 자막 캐시
│   └── ...
├── metadata/
│   ├── <videoId>.json          # 영상 메타데이터
│   └── ...
└── videos/
    ├── <videoId>.mp4           # 다운로드 영상 캐시
    └── ...
```

**캐시 특징**:
- 설정: `cache.enabled: true/false`
- TTL (유지 기간): 기본 7일 (`cache.ttl: 7`)
- `~/.cache/yt2pdf` 또는 Windows 해당 위치 자동 생성

---

## 설정 방법

### 1. 설정 파일 (yt2pdf.config.yaml)

프로젝트 루트에 `yt2pdf.config.yaml` 파일을 생성하여 설정합니다.

```yaml
output:
  directory: ./output                      # 출력 디렉토리
  format: pdf                              # 출력 포맷: pdf, md, html, brief
  filenamePattern: "{timestamp}_{title}"   # 파일명 패턴
```

### 2. 전역 설정 파일

사용자 홈 디렉토리에 전역 설정을 적용할 수 있습니다.

```bash
# 전역 설정 파일 위치
~/.config/yt2pdf/config.yaml
```

```yaml
output:
  directory: ~/Documents/yt2pdf-output
  format: pdf
  filenamePattern: "{channel}/{date}_{title}"
```

### 3. CLI 옵션

실행할 때마다 임시로 설정을 덮어쓸 수 있습니다.

```bash
# 출력 디렉토리 지정
yt2pdf <URL> -o ./my-output

# 출력 포맷 지정
yt2pdf <URL> -f md

# 전체 예시
yt2pdf "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  -o ./my-videos \
  -f pdf
```

### 4. 환경 변수

일부 설정은 환경 변수로도 지정 가능합니다 (.env 파일):

```bash
# .env 파일
YT2PDF_OUTPUT_DIR=./my-output
YT2PDF_OUTPUT_FORMAT=pdf
YT2PDF_FILENAME_PATTERN={timestamp}_{title}
```

---

## 파일명 정리 규칙

### 자동 정리 프로세스

yt2pdf는 모든 파일명을 다음 규칙에 따라 자동으로 정리합니다:

#### 1. 특수문자 제거

다음 문자들은 자동으로 제거됩니다 (파일 시스템 호환성):

```
< > : " / \ | ? *
```

**예시**:
```
입력:  Building "AI" Apps: A Guide to <Creating> Modern Solutions
정제:  Building_AI_Apps_A_Guide_to_Creating_Modern_Solutions
```

#### 2. 공백을 언더스코어로 치환

모든 공백(1개 이상)은 단일 언더스코어(`_`)로 변환됩니다.

```
입력:  My   Video   Title     (공백 여러 개)
정제:  My_Video_Title         (언더스코어로 통일)
```

#### 3. 최대 길이 제한

정제 후 최대 200자로 잘립니다 (파일명 길이 제한):

```
입력:  This is a very long video title that explains
       the comprehensive guide to machine learning
       and deep neural networks in production...
정제:  This_is_a_very_long_video_title_that_explains_the_comprehensive... (200자)
```

### 정제 코드

```typescript
// src/utils/file.ts의 sanitizeFilename 함수
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '')    // 특수문자 제거
    .replace(/\s+/g, '_')             // 공백 → 언더스코어
    .substring(0, 200);               // 최대 200자
}
```

### 실제 예시

| 원본 제목 | 정제된 파일명 |
|----------|----------|
| `Building "AI" Apps` | `Building_AI_Apps` |
| `Python 3.11: What's New?` | `Python_3.11_Whats_New` |
| `C++ for Beginners (2024)` | `C_for_Beginners_2024` |
| `The Future of Web <3` | `The_Future_of_Web_3` |
| `JavaScript: The Good Parts™` | `JavaScript_The_Good_Parts` |

---

## 실제 예시

### 예시 1: 단일 영상 처리

```bash
# 명령어
yt2pdf "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 설정
# yt2pdf.config.yaml
output:
  directory: ./output
  filenamePattern: "{timestamp}_{title}"

# 생성 파일
output/
├── 20260127_143052_Never_Gonna_Give_You_Up.pdf
├── 20260127_143052_Never_Gonna_Give_You_Up.md
├── 20260127_143052_Never_Gonna_Give_You_Up_brief.pdf
└── images/
    ├── screenshot_0001.jpg
    └── screenshot_0002.jpg
```

### 예시 2: 채널별 정리

```bash
# 명령어
yt2pdf "https://www.youtube.com/watch?v=xyz123abc456"

# 설정
# yt2pdf.config.yaml
output:
  directory: ./content
  filenamePattern: "{channel}/{date}_{timestamp}_{title}"

# 생성 파일
content/
└── Tech_Talks/
    ├── 20260127_20260127_143052_Advanced_Python_Tips.pdf
    ├── 20260127_20260127_143052_Advanced_Python_Tips.md
    └── images/
        └── screenshot_*.jpg
```

### 예시 3: 플레이리스트 처리

```bash
# 명령어
yt2pdf "https://www.youtube.com/playlist?list=PLxxx"

# 설정
# yt2pdf.config.yaml
output:
  directory: ./courses
  filenamePattern: "{index}_{title}"

# 생성 파일 (순서대로 정렬)
courses/
├── 001_Introduction_to_Python.pdf
├── 002_Variables_and_Data_Types.pdf
├── 003_Control_Flow_Statements.pdf
├── 004_Functions_and_Modules.pdf
└── 005_Object_Oriented_Programming.pdf
```

### 예시 4: 영상 ID 기반 추적

```bash
# 명령어
yt2pdf "https://www.youtube.com/watch?v=abc123xyz456"

# 설정
# yt2pdf.config.yaml
output:
  directory: ./archive
  filenamePattern: "{date}_{videoId}_{title}"

# 생성 파일
archive/
├── 20260127_abc123xyz456_How_to_Learn_TypeScript.pdf
├── 20260127_abc123xyz456_How_to_Learn_TypeScript.md
└── images/
    └── screenshot_*.jpg

# 같은 영상을 재다운로드해도 videoId로 식별 가능
# 이전 파일을 덮어쓰거나 버전 관리에 사용 가능
```

---

## 설정 우선순위

yt2pdf는 다음 우선순위에 따라 설정을 로드합니다:

### 우선순위 순서 (높음 → 낮음)

1. **CLI 옵션** (최우선)
   ```bash
   yt2pdf <URL> -o ./custom-output -f html
   ```

2. **프로젝트 설정** (./yt2pdf.config.yaml)
   ```yaml
   # 프로젝트 루트의 설정 파일
   output:
     directory: ./output
     filenamePattern: "{timestamp}_{title}"
   ```

3. **전역 설정** (~/.config/yt2pdf/config.yaml)
   ```yaml
   # 사용자 홈 디렉토리의 전역 설정
   output:
     directory: ~/Documents/yt2pdf
   ```

4. **기본값** (코드의 기본값)
   ```
   directory: ./output
   format: pdf
   filenamePattern: {timestamp}_{title}
   ```

### 설정 로드 플로우

```
시작
  ↓
기본값 로드
  ↓
전역 설정 존재? → 병합
  ↓
프로젝트 설정 존재? → 병합
  ↓
CLI 옵션 존재? → 병합
  ↓
유효성 검사
  ↓
최종 설정 사용
```

### 우선순위 예시

```bash
# 시나리오: CLI, 프로젝트 설정, 전역 설정 모두 지정

# 1. 전역 설정 (~/.config/yt2pdf/config.yaml)
output:
  directory: ~/Documents/yt2pdf
  filenamePattern: "{channel}/{title}"

# 2. 프로젝트 설정 (./yt2pdf.config.yaml)
output:
  directory: ./output
  format: html

# 3. CLI 옵션
yt2pdf <URL> -o ./my-videos

# 최종 결과:
# - directory: ./my-videos       (CLI 옵션 우선)
# - format: html                 (프로젝트 설정)
# - filenamePattern: "{channel}/{title}"  (전역 설정)
```

---

## 사용 예시

### 예시 1: 일반적인 사용

```bash
# 기본 설정으로 PDF 생성
yt2pdf "https://www.youtube.com/watch?v=..."
# → ./output/20260127_143052_Video_Title.pdf

# Markdown으로 생성
yt2pdf "https://www.youtube.com/watch?v=..." -f md
# → ./output/20260127_143052_Video_Title.md

# 커스텀 디렉토리에 생성
yt2pdf "https://www.youtube.com/watch?v=..." -o ~/My-Videos
# → ~/My-Videos/20260127_143052_Video_Title.pdf
```

### 예시 2: 블로그 기사 자동 생성

```bash
# 설정 파일 (yt2pdf.config.yaml)
output:
  directory: ./blog-sources
  format: md
  filenamePattern: "{date}_{videoId}_{title}"

# 실행
yt2pdf "https://www.youtube.com/watch?v=abc123"
# → ./blog-sources/20260127_abc123_Article_Title.md

# 같은 영상 재처리 시 파일명 동일 (내용 업데이트)
yt2pdf "https://www.youtube.com/watch?v=abc123"
# → ./blog-sources/20260127_abc123_Article_Title.md (덮어쓰기)
```

### 예시 3: 대규모 아카이브

```bash
# 설정 파일 (yt2pdf.config.yaml)
output:
  directory: /archive/video-content
  format: pdf
  filenamePattern: "{channel}/{date}/{title}"

# 디렉토리 구조
/archive/video-content/
├── AI_Engineer/
│   ├── 20260127/
│   │   ├── Building_AI_Apps.pdf
│   │   └── Images/
│   │       └── screenshot_*.jpg
│   ├── 20260126/
│   │   ├── Advanced_Prompt_Engineering.pdf
│   │   └── Images/
│   └── 20260125/
├── Data_Science/
│   ├── 20260127/
│   └── ...
└── Web_Development/
    └── ...
```

### 예시 4: 수동 파일명 지정

```bash
# 커스텀 패턴으로 간단한 파일명
# yt2pdf.config.yaml
output:
  directory: ./downloads
  filenamePattern: "{title}"

# 실행
yt2pdf "https://www.youtube.com/watch?v=..."
# → ./downloads/My_Tutorial.pdf

# 하지만 같은 제목 여러 개 처리 시 덮어쓰기 주의!
```

### 예시 5: Executive Brief 생성

```bash
# Brief 포맷은 요약된 PDF 생성
yt2pdf "https://www.youtube.com/watch?v=..." -f brief
# → ./output/20260127_143052_Video_Title_brief.pdf

# 설정
# yt2pdf.config.yaml
output:
  filenamePattern: "{timestamp}_{title}"

# 생성 파일
output/
├── 20260127_143052_Video_Title.pdf        # 전체 PDF
├── 20260127_143052_Video_Title_brief.pdf  # 요약 Brief
└── 20260127_143052_Video_Title.md         # Markdown
```

---

## 주의 사항

### 파일명 중복 방지

같은 파일명이 여러 번 생성될 수 있는 경우:

```bash
# 문제: 같은 제목으로 여러 영상 처리
yt2pdf <URL1> -f "{title}"  # Video_Title.pdf
yt2pdf <URL2> -f "{title}"  # Video_Title.pdf (덮어쓰기!)

# 해결: timestamp 포함
yt2pdf <URL1> -f "{timestamp}_{title}"  # 20260127_143052_Video_Title.pdf
yt2pdf <URL2> -f "{timestamp}_{title}"  # 20260127_143100_Video_Title.pdf
```

### 매우 긴 제목 처리

200자 제한에 의해 긴 제목이 잘릴 수 있습니다:

```
입력 제목: The Complete Guide to Machine Learning and Deep Learning...
           ...with Real-World Applications in Production Systems
정제 후: The_Complete_Guide_to_Machine_Learning_and_Deep_Learning_with_... (200자)
```

### 특수문자가 많은 제목

```
입력:  HTML & CSS | The Fundamentals (2024)
정제:  HTML__CSS_The_Fundamentals_2024_  (특수문자 제거, 공백 정리)
```

### 경로 분리자 사용

패턴에 경로 분리자(`/`)를 포함하면 자동으로 폴더가 생성됩니다:

```yaml
filenamePattern: "{channel}/{date}/{title}"

# 결과:
output/
└── Channel_Name/
    └── 20260127/
        └── Video_Title.pdf
```

---

## 파일 확장자

각 포맷별 생성 파일:

| 포맷 | 확장자 | 설명 |
|------|--------|------|
| `pdf` | `.pdf` | 완전한 PDF (이미지, 자막, 메타데이터) |
| `md` | `.md` | Markdown 형식 (이미지 참조 포함) |
| `html` | `.html` | HTML 형식 (독립 실행 가능) |
| `brief` | `_brief.pdf` | Executive Brief (요약 PDF) |

### Brief 파일명 규칙

Brief는 항상 `_brief` suffix가 붙습니다:

```
패턴: {timestamp}_{title}
일반 파일: 20260127_143052_Video_Title.pdf
Brief 파일: 20260127_143052_Video_Title_brief.pdf
```

---

## 캐시 파일명

### 자막 캐시

```
~/.cache/yt2pdf/subtitles/
├── ko_dQw4w9WgXcQ.json    # 한국어 자막 캐시
├── en_dQw4w9WgXcQ.json    # 영어 자막 캐시
└── ...
```

### 메타데이터 캐시

```
~/.cache/yt2pdf/metadata/
├── dQw4w9WgXcQ.json       # 영상 메타데이터 (제목, 채널 등)
└── ...
```

### 영상 캐시

```
~/.cache/yt2pdf/videos/
├── dQw4w9WgXcQ.mp4        # 다운로드 영상 (재사용 용)
└── ...
```

---

## 업그레이드 및 마이그레이션

### 설정 포맷 변경 시

새로운 패턴으로 변경하면 새 파일부터 새 패턴이 적용됩니다:

```yaml
# 기존 설정
output:
  filenamePattern: "{timestamp}_{title}"

# 변경 후
output:
  filenamePattern: "{channel}/{date}_{title}"

# 기존 파일: 20260126_Old_Title.pdf (변경 안 됨)
# 새 파일: AI_Engineer/20260127_New_Title.pdf (새 패턴)
```

### 파일 마이그레이션 스크립트

구성 변경 후 기존 파일을 재정렬하려면:

```bash
# 예시: 기존 파일을 채널별 폴더로 이동
# (직접 작성 필요)

# 또는 재처리:
yt2pdf <old-video-url> -o ./new-location
```

---

## 참고 자료

### 관련 파일

- **설정 타입**: `src/types/config.ts` - OutputConfig 타입 정의
- **파일 유틸**: `src/utils/file.ts` - sanitizeFilename, applyFilenamePattern 함수
- **설정 관리자**: `src/utils/config.ts` - ConfigManager 클래스
- **오케스트레이터**: `src/core/orchestrator.ts` - 실제 파일 생성 로직 (line 382-389)

### 코드 예시

```typescript
// 패턴 적용 예시 (src/core/orchestrator.ts)
const filename = applyFilenamePattern(this.config.output.filenamePattern, {
  date: getDateString(),              // YYYYMMDD
  timestamp: getTimestampString(),    // YYYYMMDD_HHMMSS
  videoId: videoId,                   // 11자 YouTube ID
  channel: metadata.channel,          // 채널명
  index: '001',                       // 3자 인덱스
  title: metadata.title,              // 영상 제목
});
```

---

## 버전 히스토리

| 버전 | 날짜 | 변경 사항 |
|------|------|----------|
| v1.0 | 2026-01-27 | 초기 정책 문서 작성 |

---

## 전체 경로 정책

### 경로 유형 요약

| 유형 | 기본 경로 | 설정 방법 | 코드 위치 |
|------|----------|----------|----------|
| 출력 | `./output/` | config, CLI `-o` | `orchestrator.ts:378` |
| 캐시 | `~/.cache/yt2pdf/` | 생성자 param | `cache.ts:28` |
| 프로젝트 설정 | `./yt2pdf.config.yaml` | 고정 | `config.ts:78` |
| 전역 설정 | `~/.config/yt2pdf/config.yaml` | 고정 | `config.ts:86` |
| 임시 파일 | `/tmp/yt2pdf-{random}/` | 시스템 | `file.ts:13` |
| 폰트 | `./assets/fonts/` | 자동 탐색 | `pdf-generator.ts:50-64` |
| 스크린샷 | `{tempDir}/screenshot_*.jpg` | 자동 | `screenshot-capturer.ts:59` |
| 영상/오디오 | `{tempDir}/{videoId}.mp4` | 자동 | `youtube.ts:174` |

---

## 설정 파일 경로

### 프로젝트 설정
```
{현재 디렉토리}/yt2pdf.config.yaml
```
- 프로젝트별 설정
- `process.cwd()` 기준
- 전역 설정보다 우선

### 전역 설정
```
~/.config/yt2pdf/config.yaml
```
- 사용자 전체 기본 설정
- `$HOME` 또는 `$USERPROFILE` 기준
- 기본값보다 우선

### 환경 변수 (.env)
```
{현재 디렉토리}/.env
```

| 변수 | 용도 | 기본값 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API (Whisper/GPT) | 필수 |
| `YT_DLP_PATH` | yt-dlp 바이너리 경로 | `yt-dlp` (PATH) |
| `FFMPEG_PATH` | ffmpeg 바이너리 경로 | `ffmpeg` (PATH) |

---

## 캐시 경로

### 기본 위치
```
~/.cache/yt2pdf/
```

### 캐시 파일 구조
```
~/.cache/yt2pdf/
├── {md5-hash}.json          # 자막 캐시
├── metadata:{videoId}.json  # 메타데이터 캐시
└── subtitle:{videoId}:{lang}.json  # 자막 언어별 캐시
```

### 캐시 키 생성
- MD5 해시: `crypto.createHash('md5').update(JSON.stringify({url, options})).digest('hex')`
- 기본 TTL: 7일 (설정 가능)

### 캐시 관리 CLI
```bash
yt2pdf cache status    # 캐시 상태 확인
yt2pdf cache clear     # 전체 캐시 삭제
yt2pdf cache cleanup   # 만료된 캐시 정리
```

---

## 임시 파일 경로

### 기본 위치
```
{os.tmpdir()}/yt2pdf-{timestamp}/
```

**플랫폼별 기본값:**
- macOS: `/private/var/folders/.../yt2pdf-*/` 또는 `/tmp/yt2pdf-*/`
- Linux: `/tmp/yt2pdf-*/`
- Windows: `%TEMP%\yt2pdf-*\`

### 임시 파일 구조
```
/tmp/yt2pdf-kvhg3l2/
├── {videoId}.mp4           # 다운로드 영상
├── {videoId}.mp3           # 오디오 (Whisper용)
├── {videoId}.vtt           # 자막 파일
├── screenshot_0000.jpg     # 스크린샷
├── screenshot_0001.jpg
└── ...
```

### 정리 정책
- 캐시 비활성화 시: 처리 완료 후 자동 삭제
- 캐시 활성화 시: 유지 (수동 정리 필요)

---

## 폰트 경로

### 탐색 순서
1. `{process.cwd()}/assets/fonts/` (프로젝트 루트)
2. `{__dirname}/../../assets/fonts/` (dist 기준)
3. `{__dirname}/../../../assets/fonts/` (폴백)

### 필요 폰트 파일
```
assets/fonts/
├── NotoSansKR-Regular.ttf   # 본문
└── NotoSansKR-Bold.ttf      # 제목
```

### 폰트 없을 때
- Helvetica 폴백 사용
- 한글 렌더링 불가 (경고 출력)

---

## 스크린샷 경로

### 저장 위치
```
{tempDir}/screenshot_{index:04d}.jpg
```

### 인덱싱
- 4자리 0-패딩: `0000`, `0001`, `0002`...
- 챕터 기준: 챕터 시작 시점
- interval 기준: 설정된 간격 (기본 60초)

### 썸네일
- 첫 번째 프레임: YouTube 썸네일 사용
- 경로: `{tempDir}/screenshot_0000.jpg`

---

## 출력 이미지 경로

### MD/HTML 포맷
```
{outputDir}/
├── {filename}.md           # 또는 .html
└── images/
    ├── screenshot_0000.jpg
    ├── screenshot_0001.jpg
    └── ...
```

### PDF 포맷
- 이미지 내장 (별도 폴더 없음)

---

## 외부 도구 경로

### yt-dlp
```typescript
// youtube.ts:20
const ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
```

### ffmpeg
```typescript
// ffmpeg.ts
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
```

### 설정 예시 (.env)
```bash
# 커스텀 바이너리 경로
YT_DLP_PATH=/usr/local/bin/yt-dlp
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
```

---

## 경로 우선순위

### 설정 파일
```
CLI 옵션 > 프로젝트 설정 > 전역 설정 > 기본값
```

### 폰트 탐색
```
프로젝트 assets > dist 상대 > 폴백
```

### 외부 도구
```
환경변수 > 시스템 PATH
```

---

## 크로스 플랫폼 호환성

| 항목 | macOS/Linux | Windows |
|------|-------------|---------|
| 홈 디렉토리 | `$HOME` | `%USERPROFILE%` |
| 임시 디렉토리 | `/tmp` | `%TEMP%` |
| 경로 구분자 | `/` | `\` (자동 처리) |
| 설정 디렉토리 | `~/.config/` | `%APPDATA%\` |

**참고**: 모든 경로는 `path.join()` 사용으로 자동 처리됨

---

## FAQ

### Q: 같은 영상을 여러 번 처리해도 파일명이 다른가요?

**A**: `{timestamp}` 변수를 사용하면 매번 다른 파일명이 생성됩니다. 같은 파일명으로 덮어쓰려면 `{videoId}`를 사용하세요.

### Q: 파일명이 너무 길어서 잘렸어요

**A**: 최대 200자 제한입니다. 더 짧은 패턴을 사용하거나 제목이 짧은 영상을 처리하세요.

### Q: 특수문자가 많은 제목은 어떻게 되나요?

**A**: 자동으로 제거됩니다. 특수문자 없는 안전한 파일명이 생성됩니다.

### Q: 캐시는 어디에 저장되나요?

**A**: `~/.cache/yt2pdf/` 디렉토리에 저장됩니다 (Linux/Mac의 XDG 표준).

### Q: 출력 디렉토리를 자동으로 생성하나요?

**A**: 네, 없으면 자동으로 생성됩니다.

### Q: 플레이리스트 처리 시 파일명을 어떻게 지정하나요?

**A**: `{index}_{title}` 패턴을 사용하면 001, 002, 003... 순서로 파일명이 생성됩니다.

---

**문서 완성일**: 2026-01-27
**담당자**: yt2pdf 개발팀
**최종 검토**: -
