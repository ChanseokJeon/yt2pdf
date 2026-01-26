# yt2pdf 아키텍처 상세 설계

## 1. 시스템 개요

### 1.1 전체 아키텍처
```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Entry Points                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────┐  │
│  │    CLI      │    │ Claude Code │    │   Programmatic API          │  │
│  │  (bin/cli)  │    │   Skill     │    │   (import { convert })      │  │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┬───────────────┘  │
│         │                  │                         │                   │
│         └──────────────────┼─────────────────────────┘                   │
│                            ▼                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                         Core Engine                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Orchestrator                              │    │
│  │  - Pipeline coordination                                         │    │
│  │  - Progress tracking                                             │    │
│  │  - Error handling & retry                                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                            │                                             │
│         ┌──────────────────┼──────────────────┐                         │
│         ▼                  ▼                  ▼                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │  Subtitle   │    │ Screenshot  │    │    PDF      │                  │
│  │  Extractor  │    │  Capturer   │    │  Generator  │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
│         │                  │                  │                          │
├─────────┼──────────────────┼──────────────────┼──────────────────────────┤
│         ▼                  ▼                  ▼                          │
│                        Providers                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │  YouTube    │    │   FFmpeg    │    │   PDFKit    │                  │
│  │  Provider   │    │   Wrapper   │    │   /Puppeteer│                  │
│  └─────────────┘    └─────────────┘    └─────────────┘                  │
│  ┌─────────────┐                                                        │
│  │  Whisper    │                                                        │
│  │  Provider   │                                                        │
│  └─────────────┘                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                         Infrastructure                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │
│  │   Config    │    │    Cache    │    │   Logger    │    │  Utils   │ │
│  │   Manager   │    │   Manager   │    │             │    │          │ │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 데이터 흐름
```
YouTube URL
    │
    ▼
┌─────────────────┐
│ URL Parser      │ ─── 단일 영상 / 플레이리스트 판별
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Metadata Fetch  │ ─── 영상 정보 (제목, 길이, 썸네일 등)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cost Estimator  │ ─── Whisper 필요 시 예상 비용 계산
└────────┬────────┘
         │
         ▼ (병렬 실행)
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────────┐
│Caption│ │Screenshot │
│Extract│ │Capture    │
└───┬───┘ └─────┬─────┘
    │           │
    ▼           ▼
┌─────────────────┐
│ Content Merger  │ ─── 타임스탬프 기준 자막-스크린샷 매칭
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PDF Generator   │ ─── 레이아웃 적용, PDF/MD/HTML 생성
└────────┬────────┘
         │
         ▼
    Output File
```

---

## 2. 모듈 상세 설계

### 2.1 Entry Points

#### 2.1.1 CLI Module (`src/cli/`)
```typescript
// src/cli/index.ts
interface CLIOptions {
  output?: string;
  format?: 'pdf' | 'md' | 'html';
  interval?: number;
  layout?: 'vertical' | 'horizontal';
  theme?: string;
  quality?: 'low' | 'medium' | 'high';
  lang?: string;
  noCache?: boolean;
  verbose?: boolean;
}

// 책임:
// - 명령줄 인자 파싱 (commander.js)
// - 옵션 유효성 검사
// - Orchestrator 호출
// - 진행 상황 표시 (ora, cli-progress)
// - 에러 메시지 포맷팅
```

#### 2.1.2 Programmatic API (`src/index.ts`)
```typescript
// src/index.ts
export interface ConvertOptions {
  url: string;
  output?: string;
  format?: OutputFormat;
  screenshot?: ScreenshotOptions;
  subtitle?: SubtitleOptions;
  pdf?: PDFOptions;
}

export interface ConvertResult {
  success: boolean;
  outputPath: string;
  metadata: VideoMetadata;
  stats: {
    pages: number;
    fileSize: number;
    duration: number;
    screenshotCount: number;
  };
}

export async function convert(options: ConvertOptions): Promise<ConvertResult>;
export async function convertPlaylist(options: ConvertOptions): Promise<ConvertResult[]>;
```

---

### 2.2 Core Engine

#### 2.2.1 Orchestrator (`src/core/orchestrator.ts`)
```typescript
// 파이프라인 조율 및 상태 관리

interface PipelineState {
  status: 'idle' | 'fetching' | 'processing' | 'generating' | 'complete' | 'error';
  progress: number;  // 0-100
  currentStep: string;
  error?: Error;
}

class Orchestrator {
  private state: PipelineState;
  private config: Config;
  private cache: CacheManager;

  // 메인 처리 파이프라인
  async process(url: string, options: ConvertOptions): Promise<ConvertResult> {
    // 1. URL 파싱 및 유효성 검사
    // 2. 메타데이터 가져오기
    // 3. 비용 추정 (필요시)
    // 4. 병렬 처리 시작 (자막 + 스크린샷)
    // 5. 콘텐츠 병합
    // 6. PDF 생성
    // 7. 정리 및 결과 반환
  }

  // 체크포인트 저장/복원 (긴 영상 처리 중단 대비)
  async saveCheckpoint(): Promise<void>;
  async restoreCheckpoint(id: string): Promise<void>;

  // 진행 상황 콜백
  onProgress(callback: (state: PipelineState) => void): void;
}
```

#### 2.2.2 Subtitle Extractor (`src/core/subtitle-extractor.ts`)
```typescript
interface SubtitleSegment {
  start: number;      // 시작 시간 (초)
  end: number;        // 종료 시간 (초)
  text: string;       // 자막 텍스트
}

interface SubtitleResult {
  source: 'youtube' | 'whisper';
  language: string;
  segments: SubtitleSegment[];
}

class SubtitleExtractor {
  constructor(
    private youtubeProvider: YouTubeProvider,
    private whisperProvider: WhisperProvider,
    private config: SubtitleConfig
  ) {}

  async extract(videoId: string, audioPath?: string): Promise<SubtitleResult> {
    // 1. YouTube 자막 시도
    // 2. 실패 시 Whisper 폴백
  }

  // YouTube 자막 우선순위: 수동 자막 > 자동 생성 자막
  private async tryYouTube(videoId: string): Promise<SubtitleResult | null>;

  // Whisper API 호출
  private async useWhisper(audioPath: string): Promise<SubtitleResult>;
}
```

#### 2.2.3 Screenshot Capturer (`src/core/screenshot-capturer.ts`)
```typescript
interface Screenshot {
  timestamp: number;    // 초
  imagePath: string;    // 임시 파일 경로
  width: number;
  height: number;
}

interface CaptureOptions {
  interval: number;     // 캡처 간격 (초)
  quality: 'low' | 'medium' | 'high';
  startTime?: number;
  endTime?: number;
}

class ScreenshotCapturer {
  constructor(
    private ffmpeg: FFmpegWrapper,
    private config: ScreenshotConfig
  ) {}

  // 스트리밍 방식으로 캡처 (영상 다운로드 중에도 처리 가능)
  async *captureStream(
    videoSource: string | ReadableStream,
    options: CaptureOptions
  ): AsyncGenerator<Screenshot>;

  // 일괄 캡처
  async captureAll(
    videoPath: string,
    options: CaptureOptions
  ): Promise<Screenshot[]>;
}
```

#### 2.2.4 PDF Generator (`src/core/pdf-generator.ts`)
```typescript
interface PDFContent {
  metadata: VideoMetadata;
  sections: PDFSection[];
}

interface PDFSection {
  timestamp: number;
  screenshot: Screenshot;
  subtitle: SubtitleSegment[];
}

interface PDFOptions {
  layout: 'vertical' | 'horizontal';
  theme: string;
  includeToc: boolean;
  timestampLinks: boolean;
  searchable: boolean;
}

class PDFGenerator {
  constructor(private templateEngine: TemplateEngine) {}

  async generate(content: PDFContent, options: PDFOptions): Promise<Buffer>;
  async generateMarkdown(content: PDFContent): Promise<string>;
  async generateHTML(content: PDFContent, options: PDFOptions): Promise<string>;

  // 테마 로드
  private loadTheme(themeName: string): Theme;
}
```

---

### 2.3 Providers

#### 2.3.1 YouTube Provider (`src/providers/youtube.ts`)
```typescript
interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  duration: number;       // 초
  thumbnail: string;
  channel: string;
  uploadDate: string;
  viewCount: number;
  availableCaptions: CaptionTrack[];
}

interface CaptionTrack {
  language: string;
  languageCode: string;
  isAutoGenerated: boolean;
}

class YouTubeProvider {
  // yt-dlp 래퍼

  async getMetadata(url: string): Promise<VideoMetadata>;
  async getPlaylistVideos(url: string): Promise<VideoMetadata[]>;
  async downloadAudio(videoId: string, outputPath: string): Promise<string>;
  async downloadVideo(videoId: string, outputPath: string, quality: string): Promise<string>;
  async getCaptions(videoId: string, langCode: string): Promise<SubtitleSegment[]>;

  // URL 유틸리티
  static parseUrl(url: string): { type: 'video' | 'playlist'; id: string };
  static isValidUrl(url: string): boolean;
}
```

#### 2.3.2 Whisper Provider (`src/providers/whisper.ts`)
```typescript
interface WhisperOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
}

interface WhisperResult {
  text: string;
  segments: SubtitleSegment[];
  language: string;
  duration: number;
}

class WhisperProvider {
  constructor(private apiKey: string) {}

  async transcribe(audioPath: string, options?: WhisperOptions): Promise<WhisperResult>;

  // 비용 추정
  estimateCost(durationSeconds: number): number;

  // 오디오 전처리 (필요시)
  private async preprocessAudio(inputPath: string): Promise<string>;
}
```

#### 2.3.3 FFmpeg Wrapper (`src/providers/ffmpeg.ts`)
```typescript
class FFmpegWrapper {
  constructor(private ffmpegPath: string) {}

  // 스크린샷 캡처
  async captureFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string,
    quality: string
  ): Promise<void>;

  // 오디오 추출
  async extractAudio(
    videoPath: string,
    outputPath: string,
    format?: string
  ): Promise<void>;

  // 영상 정보
  async getVideoInfo(videoPath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    fps: number;
  }>;

  // ffmpeg 설치 확인
  static async checkInstallation(): Promise<boolean>;
  static async install(): Promise<void>;
}
```

---

### 2.4 Infrastructure

#### 2.4.1 Config Manager (`src/utils/config.ts`)
```typescript
interface Config {
  output: {
    directory: string;
    format: 'pdf' | 'md' | 'html';
    filenamePattern: string;
  };
  screenshot: {
    interval: number;
    quality: 'low' | 'medium' | 'high';
  };
  subtitle: {
    priority: 'youtube' | 'whisper';
    languages: string[];
  };
  pdf: {
    layout: 'vertical' | 'horizontal';
    theme: string;
    includeToc: boolean;
    timestampLinks: boolean;
    searchable: boolean;
  };
  whisper: {
    provider: 'openai' | 'groq' | 'local';
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
  processing: {
    maxDuration: number;
    parallel: boolean;
    retryCount: number;
  };
}

class ConfigManager {
  private config: Config;

  // 설정 로드 우선순위: CLI 옵션 > 프로젝트 설정 > 전역 설정 > 기본값
  async load(cliOptions?: Partial<Config>): Promise<Config>;

  // 설정 파일 경로
  static getProjectConfigPath(): string;
  static getGlobalConfigPath(): string;

  // 설정 유효성 검사
  validate(config: Config): ValidationResult;
}
```

#### 2.4.2 Cache Manager (`src/utils/cache.ts`)
```typescript
interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
}

class CacheManager {
  constructor(private cacheDir: string, private ttlDays: number) {}

  // 캐시 키 생성 (URL 기반)
  generateKey(url: string, options?: object): string;

  // 캐시 CRUD
  async get<T>(key: string): Promise<T | null>;
  async set<T>(key: string, value: T): Promise<void>;
  async has(key: string): Promise<boolean>;
  async delete(key: string): Promise<void>;

  // 캐시 관리
  async clear(): Promise<void>;
  async cleanup(): Promise<void>;  // 만료된 항목 정리
  async getStats(): Promise<{ size: number; entries: number }>;
}
```

#### 2.4.3 Logger (`src/utils/logger.ts`)
```typescript
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

class Logger {
  constructor(private level: LogLevel) {}

  error(message: string, error?: Error): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string, data?: object): void;

  // 진행 상황 표시
  progress(current: number, total: number, message?: string): void;

  // 파일 로깅 (옵션)
  setLogFile(path: string): void;
}
```

---

## 3. 파일 구조 (최종)

```
yt2pdf/
├── src/
│   ├── cli/
│   │   ├── index.ts              # CLI 진입점
│   │   ├── commands/
│   │   │   ├── convert.ts        # 변환 명령어
│   │   │   ├── config.ts         # 설정 명령어
│   │   │   ├── cache.ts          # 캐시 관리 명령어
│   │   │   └── setup.ts          # 의존성 설치 명령어
│   │   └── ui/
│   │       ├── progress.ts       # 프로그레스 바
│   │       └── prompts.ts        # 대화형 프롬프트
│   │
│   ├── core/
│   │   ├── orchestrator.ts       # 파이프라인 조율
│   │   ├── subtitle-extractor.ts # 자막 추출
│   │   ├── screenshot-capturer.ts# 스크린샷 캡처
│   │   ├── pdf-generator.ts      # PDF 생성
│   │   ├── content-merger.ts     # 콘텐츠 병합
│   │   └── cost-estimator.ts     # 비용 추정
│   │
│   ├── providers/
│   │   ├── youtube.ts            # YouTube/yt-dlp
│   │   ├── whisper.ts            # OpenAI Whisper
│   │   └── ffmpeg.ts             # FFmpeg 래퍼
│   │
│   ├── templates/
│   │   ├── pdf/
│   │   │   ├── default.ts        # 기본 테마
│   │   │   ├── note.ts           # 노트 테마
│   │   │   └── minimal.ts        # 미니멀 테마
│   │   ├── markdown.ts           # MD 템플릿
│   │   └── html.ts               # HTML 템플릿
│   │
│   ├── utils/
│   │   ├── config.ts             # 설정 관리
│   │   ├── cache.ts              # 캐시 관리
│   │   ├── logger.ts             # 로깅
│   │   ├── file.ts               # 파일 유틸리티
│   │   └── url.ts                # URL 유틸리티
│   │
│   ├── types/
│   │   ├── index.ts              # 공통 타입
│   │   ├── config.ts             # 설정 타입
│   │   ├── video.ts              # 영상 관련 타입
│   │   └── output.ts             # 출력 관련 타입
│   │
│   └── index.ts                  # 라이브러리 진입점
│
├── bin/
│   └── yt2pdf.ts                 # CLI 실행 파일
│
├── templates/
│   └── themes/                   # PDF 테마 에셋
│       ├── default/
│       ├── note/
│       └── minimal/
│
├── scripts/
│   ├── setup.sh                  # Unix 의존성 설치
│   └── setup.ps1                 # Windows 의존성 설치
│
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   ├── providers/
│   │   └── utils/
│   ├── integration/
│   │   └── pipeline.test.ts
│   ├── e2e/
│   │   └── convert.test.ts
│   └── fixtures/
│       ├── sample-video.mp4
│       └── sample-captions.vtt
│
├── docs/
│   ├── ARCHITECTURE.md           # 이 문서
│   ├── MODULES.md                # 모듈 상세
│   ├── PROGRESS.md               # 진행 상태
│   └── API.md                    # API 문서
│
├── .env.example
├── yt2pdf.config.yaml
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.js
├── .prettierrc
├── CLAUDE.md
├── SPEC.md
└── README.md
```

---

## 4. 의존성 패키지

### 4.1 Production Dependencies
```json
{
  "commander": "^11.0.0",           // CLI 파싱
  "ora": "^7.0.0",                  // 스피너
  "cli-progress": "^3.12.0",        // 프로그레스 바
  "chalk": "^5.3.0",                // 터미널 색상
  "inquirer": "^9.2.0",             // 대화형 프롬프트
  "yaml": "^2.3.0",                 // YAML 파싱
  "dotenv": "^16.3.0",              // 환경변수
  "pdfkit": "^0.14.0",              // PDF 생성
  "puppeteer": "^21.0.0",           // HTML to PDF (대안)
  "marked": "^9.0.0",               // Markdown 파싱
  "openai": "^4.0.0",               // Whisper API
  "p-limit": "^4.0.0",              // 동시성 제한
  "p-retry": "^6.0.0",              // 재시도 로직
  "winston": "^3.10.0",             // 로깅 (옵션)
  "zod": "^3.22.0"                  // 스키마 검증
}
```

### 4.2 Dev Dependencies
```json
{
  "typescript": "^5.2.0",
  "@types/node": "^20.0.0",
  "jest": "^29.0.0",
  "ts-jest": "^29.0.0",
  "@types/jest": "^29.0.0",
  "eslint": "^8.50.0",
  "@typescript-eslint/eslint-plugin": "^6.0.0",
  "@typescript-eslint/parser": "^6.0.0",
  "prettier": "^3.0.0",
  "tsx": "^3.14.0",                 // TS 실행
  "rimraf": "^5.0.0"               // 크로스 플랫폼 rm
}
```

### 4.3 External Dependencies
- **yt-dlp**: YouTube 다운로드 (Python, 별도 설치)
- **ffmpeg**: 영상/오디오 처리 (별도 설치)

---

## 5. 에러 코드 정의

```typescript
enum ErrorCode {
  // URL 관련 (1xx)
  INVALID_URL = 100,
  VIDEO_NOT_FOUND = 101,
  VIDEO_PRIVATE = 102,
  PLAYLIST_EMPTY = 103,

  // 자막 관련 (2xx)
  NO_CAPTIONS_AVAILABLE = 200,
  WHISPER_API_ERROR = 201,
  CAPTION_PARSE_ERROR = 202,

  // 스크린샷 관련 (3xx)
  FFMPEG_NOT_INSTALLED = 300,
  SCREENSHOT_FAILED = 301,
  VIDEO_DOWNLOAD_FAILED = 302,

  // PDF 관련 (4xx)
  PDF_GENERATION_FAILED = 400,
  TEMPLATE_NOT_FOUND = 401,

  // 설정 관련 (5xx)
  CONFIG_INVALID = 500,
  API_KEY_MISSING = 501,

  // 시스템 관련 (9xx)
  DISK_FULL = 900,
  NETWORK_ERROR = 901,
  TIMEOUT = 902,
}
```

---

## 6. 이벤트 및 훅

### 6.1 Pipeline Events
```typescript
type PipelineEvent =
  | { type: 'start'; videoId: string }
  | { type: 'metadata'; data: VideoMetadata }
  | { type: 'subtitle:start' }
  | { type: 'subtitle:progress'; progress: number }
  | { type: 'subtitle:complete'; source: string }
  | { type: 'screenshot:start' }
  | { type: 'screenshot:progress'; current: number; total: number }
  | { type: 'screenshot:complete'; count: number }
  | { type: 'pdf:start' }
  | { type: 'pdf:complete'; path: string }
  | { type: 'complete'; result: ConvertResult }
  | { type: 'error'; error: Error; code: ErrorCode };
```

---

*마지막 업데이트: 2025-01-26*
