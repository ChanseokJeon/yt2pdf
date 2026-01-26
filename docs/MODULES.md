# yt2pdf 모듈 상세 설계

> 각 모듈의 인터페이스, 구현 상세, 의존성을 정의합니다.

---

## 목차
1. [CLI 모듈](#1-cli-모듈)
2. [Core 모듈](#2-core-모듈)
3. [Provider 모듈](#3-provider-모듈)
4. [Template 모듈](#4-template-모듈)
5. [Utils 모듈](#5-utils-모듈)

---

## 1. CLI 모듈

### 1.1 `src/cli/index.ts` - CLI 진입점

**책임**: 명령줄 인터페이스 제공

```typescript
// 주요 명령어 구조
yt2pdf <url>                    # 기본 변환
yt2pdf convert <url> [options]  # 변환 (명시적)
yt2pdf config [action]          # 설정 관리
yt2pdf cache [action]           # 캐시 관리
yt2pdf setup                    # 의존성 설치
```

**구현 상세**:
```typescript
import { Command } from 'commander';
import { convertCommand } from './commands/convert';
import { configCommand } from './commands/config';
import { cacheCommand } from './commands/cache';
import { setupCommand } from './commands/setup';

const program = new Command();

program
  .name('yt2pdf')
  .description('YouTube 영상을 PDF로 변환')
  .version('1.0.0');

// 기본 명령어 (URL만 입력)
program
  .argument('[url]', 'YouTube URL')
  .option('-o, --output <path>', '출력 디렉토리')
  .option('-f, --format <type>', '출력 포맷', 'pdf')
  .option('-i, --interval <seconds>', '스크린샷 간격', '60')
  .option('-l, --layout <type>', 'PDF 레이아웃', 'vertical')
  .option('-t, --theme <name>', 'PDF 테마', 'default')
  .option('-q, --quality <level>', '스크린샷 품질', 'low')
  .option('--lang <code>', '자막 언어')
  .option('--no-cache', '캐시 사용 안함')
  .option('--verbose', '상세 로그')
  .action(convertCommand);

program.addCommand(configCommand);
program.addCommand(cacheCommand);
program.addCommand(setupCommand);

export { program };
```

### 1.2 `src/cli/commands/convert.ts` - 변환 명령어

**구현 상세**:
```typescript
import ora from 'ora';
import { SingleBar } from 'cli-progress';
import chalk from 'chalk';
import { Orchestrator } from '../../core/orchestrator';
import { ConfigManager } from '../../utils/config';
import { CostEstimator } from '../../core/cost-estimator';

export async function convertCommand(url: string, options: CLIOptions) {
  const spinner = ora('초기화 중...').start();

  try {
    // 1. 설정 로드
    const config = await ConfigManager.load(options);

    // 2. URL 유효성 검사
    if (!YouTubeProvider.isValidUrl(url)) {
      throw new Error('유효하지 않은 YouTube URL입니다.');
    }

    // 3. 메타데이터 가져오기
    spinner.text = '영상 정보 가져오는 중...';
    const youtube = new YouTubeProvider();
    const metadata = await youtube.getMetadata(url);

    // 4. 길이 제한 확인
    if (metadata.duration > config.processing.maxDuration) {
      const proceed = await confirmLongVideo(metadata.duration);
      if (!proceed) return;
    }

    // 5. 비용 추정 (Whisper 필요시)
    if (!metadata.availableCaptions.length) {
      const cost = CostEstimator.estimate(metadata.duration);
      const proceed = await confirmCost(cost);
      if (!proceed) return;
    }

    // 6. 변환 실행
    spinner.stop();
    const progressBar = createProgressBar();

    const orchestrator = new Orchestrator(config);
    orchestrator.onProgress((state) => {
      progressBar.update(state.progress, { step: state.currentStep });
    });

    const result = await orchestrator.process(url, options);

    // 7. 결과 출력
    progressBar.stop();
    printResult(result);

  } catch (error) {
    spinner.fail(chalk.red(error.message));
    process.exit(1);
  }
}

function createProgressBar(): SingleBar {
  return new SingleBar({
    format: '{bar} {percentage}% | {step}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
  });
}

function printResult(result: ConvertResult) {
  console.log(chalk.green('\n✓ 변환 완료!\n'));
  console.log(`  파일: ${result.outputPath}`);
  console.log(`  페이지: ${result.stats.pages}`);
  console.log(`  용량: ${formatBytes(result.stats.fileSize)}`);
  console.log(`  스크린샷: ${result.stats.screenshotCount}개`);
}
```

### 1.3 `src/cli/commands/config.ts` - 설정 명령어

```typescript
// yt2pdf config show     - 현재 설정 표시
// yt2pdf config init     - 설정 파일 생성
// yt2pdf config set <key> <value>  - 설정 변경
// yt2pdf config reset    - 기본값으로 초기화
```

### 1.4 `src/cli/commands/cache.ts` - 캐시 명령어

```typescript
// yt2pdf cache show      - 캐시 상태 표시
// yt2pdf cache clear     - 캐시 전체 삭제
// yt2pdf cache cleanup   - 만료된 항목만 삭제
```

### 1.5 `src/cli/commands/setup.ts` - 설치 명령어

```typescript
// yt2pdf setup           - 외부 의존성 설치 (ffmpeg, yt-dlp)
// yt2pdf setup --check   - 설치 상태 확인만
```

---

## 2. Core 모듈

### 2.1 `src/core/orchestrator.ts` - 파이프라인 조율

**책임**: 전체 변환 파이프라인 조율, 상태 관리, 에러 처리

**인터페이스**:
```typescript
interface OrchestratorOptions {
  config: Config;
  cache?: CacheManager;
  logger?: Logger;
}

interface ProcessOptions {
  url: string;
  output?: string;
  format?: OutputFormat;
}

class Orchestrator {
  constructor(options: OrchestratorOptions);

  // 메인 처리
  async process(options: ProcessOptions): Promise<ConvertResult>;

  // 플레이리스트 처리
  async processPlaylist(options: ProcessOptions): Promise<ConvertResult[]>;

  // 진행 상황 콜백
  onProgress(callback: ProgressCallback): void;

  // 체크포인트 (긴 영상용)
  async saveCheckpoint(): Promise<string>;
  async resumeFromCheckpoint(checkpointId: string): Promise<ConvertResult>;
}
```

**구현 상세**:
```typescript
import pLimit from 'p-limit';
import pRetry from 'p-retry';

class Orchestrator {
  private state: PipelineState;
  private progressCallbacks: ProgressCallback[] = [];
  private subtitleExtractor: SubtitleExtractor;
  private screenshotCapturer: ScreenshotCapturer;
  private pdfGenerator: PDFGenerator;
  private contentMerger: ContentMerger;

  constructor(private options: OrchestratorOptions) {
    this.initializeComponents();
  }

  async process(options: ProcessOptions): Promise<ConvertResult> {
    const { url } = options;

    try {
      // Phase 1: 메타데이터
      this.updateState({ status: 'fetching', currentStep: '영상 정보 가져오기' });
      const metadata = await this.fetchMetadata(url);

      // Phase 2: 병렬 처리 (자막 + 스크린샷)
      this.updateState({ status: 'processing', currentStep: '콘텐츠 추출' });
      const [subtitles, screenshots] = await Promise.all([
        this.extractSubtitles(metadata),
        this.captureScreenshots(metadata)
      ]);

      // Phase 3: 콘텐츠 병합
      const content = this.contentMerger.merge(metadata, subtitles, screenshots);

      // Phase 4: PDF 생성
      this.updateState({ status: 'generating', currentStep: 'PDF 생성' });
      const outputPath = await this.generateOutput(content, options);

      // Phase 5: 정리
      this.updateState({ status: 'complete', progress: 100 });
      await this.cleanup();

      return this.createResult(metadata, outputPath);

    } catch (error) {
      this.updateState({ status: 'error', error });
      throw error;
    }
  }

  private async extractSubtitles(metadata: VideoMetadata) {
    return pRetry(
      () => this.subtitleExtractor.extract(metadata.id),
      { retries: this.options.config.processing.retryCount }
    );
  }

  private async captureScreenshots(metadata: VideoMetadata) {
    const screenshots: Screenshot[] = [];
    const capturer = this.screenshotCapturer;

    let count = 0;
    const total = Math.ceil(metadata.duration / this.options.config.screenshot.interval);

    for await (const screenshot of capturer.captureStream(metadata.id)) {
      screenshots.push(screenshot);
      count++;
      this.emitProgress({
        type: 'screenshot:progress',
        current: count,
        total
      });
    }

    return screenshots;
  }

  private updateState(partial: Partial<PipelineState>) {
    this.state = { ...this.state, ...partial };
    this.progressCallbacks.forEach(cb => cb(this.state));
  }
}
```

### 2.2 `src/core/subtitle-extractor.ts` - 자막 추출

**책임**: YouTube 자막 추출, Whisper 폴백 처리

**인터페이스**:
```typescript
interface SubtitleExtractorOptions {
  youtube: YouTubeProvider;
  whisper: WhisperProvider;
  config: SubtitleConfig;
  cache?: CacheManager;
}

class SubtitleExtractor {
  constructor(options: SubtitleExtractorOptions);

  async extract(videoId: string, audioPath?: string): Promise<SubtitleResult>;
  async getAvailableLanguages(videoId: string): Promise<string[]>;
}
```

**구현 상세**:
```typescript
class SubtitleExtractor {
  constructor(private options: SubtitleExtractorOptions) {}

  async extract(videoId: string, audioPath?: string): Promise<SubtitleResult> {
    const { youtube, whisper, config, cache } = this.options;

    // 캐시 확인
    const cacheKey = `subtitle:${videoId}:${config.languages.join(',')}`;
    if (cache) {
      const cached = await cache.get<SubtitleResult>(cacheKey);
      if (cached) return cached;
    }

    // YouTube 자막 시도
    for (const lang of config.languages) {
      try {
        const segments = await youtube.getCaptions(videoId, lang);
        if (segments.length > 0) {
          const result: SubtitleResult = {
            source: 'youtube',
            language: lang,
            segments
          };
          await cache?.set(cacheKey, result);
          return result;
        }
      } catch (e) {
        // 다음 언어 시도
      }
    }

    // Whisper 폴백
    if (!audioPath) {
      audioPath = await youtube.downloadAudio(videoId, getTempPath());
    }

    const whisperResult = await whisper.transcribe(audioPath, {
      language: config.languages[0]
    });

    const result: SubtitleResult = {
      source: 'whisper',
      language: whisperResult.language,
      segments: whisperResult.segments
    };

    await cache?.set(cacheKey, result);
    return result;
  }
}
```

### 2.3 `src/core/screenshot-capturer.ts` - 스크린샷 캡처

**책임**: 영상에서 스크린샷 추출

**인터페이스**:
```typescript
interface ScreenshotCapturerOptions {
  ffmpeg: FFmpegWrapper;
  youtube: YouTubeProvider;
  config: ScreenshotConfig;
  tempDir: string;
}

class ScreenshotCapturer {
  constructor(options: ScreenshotCapturerOptions);

  // 스트리밍 캡처 (AsyncGenerator)
  async *captureStream(videoId: string): AsyncGenerator<Screenshot>;

  // 일괄 캡처
  async captureAll(videoPath: string): Promise<Screenshot[]>;

  // 특정 시점 캡처
  async captureAt(videoPath: string, timestamp: number): Promise<Screenshot>;
}
```

**구현 상세**:
```typescript
class ScreenshotCapturer {
  private qualityMap = {
    low: { width: 854, height: 480, format: 'worst[height>=480]' },
    medium: { width: 1280, height: 720, format: 'worst[height>=720]' },
    high: { width: 1920, height: 1080, format: 'best[height<=1080]' }
  };

  constructor(private options: ScreenshotCapturerOptions) {}

  async *captureStream(videoId: string): AsyncGenerator<Screenshot> {
    const { ffmpeg, youtube, config, tempDir } = this.options;
    const quality = this.qualityMap[config.quality];

    // 영상 다운로드 (스트리밍)
    const videoPath = await youtube.downloadVideo(videoId, tempDir, quality.format);
    const videoInfo = await ffmpeg.getVideoInfo(videoPath);

    const timestamps = this.generateTimestamps(videoInfo.duration, config.interval);

    for (const timestamp of timestamps) {
      const outputPath = path.join(tempDir, `screenshot_${timestamp}.jpg`);

      await ffmpeg.captureFrame(videoPath, timestamp, outputPath, config.quality);

      yield {
        timestamp,
        imagePath: outputPath,
        width: quality.width,
        height: quality.height
      };
    }
  }

  private generateTimestamps(duration: number, interval: number): number[] {
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += interval) {
      timestamps.push(t);
    }
    return timestamps;
  }
}
```

### 2.4 `src/core/pdf-generator.ts` - PDF 생성

**책임**: PDF/Markdown/HTML 문서 생성

**인터페이스**:
```typescript
interface PDFGeneratorOptions {
  config: PDFConfig;
  templateDir: string;
}

interface PDFContent {
  metadata: VideoMetadata;
  sections: PDFSection[];
}

interface PDFSection {
  timestamp: number;
  screenshot: Screenshot;
  subtitles: SubtitleSegment[];
}

class PDFGenerator {
  constructor(options: PDFGeneratorOptions);

  async generatePDF(content: PDFContent): Promise<Buffer>;
  async generateMarkdown(content: PDFContent): Promise<string>;
  async generateHTML(content: PDFContent): Promise<string>;

  // 테마 관리
  getAvailableThemes(): string[];
  loadTheme(name: string): Theme;
}
```

**구현 상세**:
```typescript
import PDFDocument from 'pdfkit';

class PDFGenerator {
  constructor(private options: PDFGeneratorOptions) {}

  async generatePDF(content: PDFContent): Promise<Buffer> {
    const { config } = this.options;
    const theme = this.loadTheme(config.theme);

    const doc = new PDFDocument({
      size: 'A4',
      margins: theme.margins,
      info: {
        Title: content.metadata.title,
        Author: content.metadata.channel,
        Subject: `YouTube: ${content.metadata.id}`,
      }
    });

    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));

    // 표지
    await this.renderCoverPage(doc, content.metadata, theme);

    // 목차 (옵션)
    if (config.includeToc) {
      await this.renderTableOfContents(doc, content.sections, theme);
    }

    // 본문
    for (const section of content.sections) {
      await this.renderSection(doc, section, config, theme);
    }

    doc.end();

    return new Promise(resolve => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async renderSection(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    config: PDFConfig,
    theme: Theme
  ) {
    if (config.layout === 'vertical') {
      // 스크린샷
      doc.image(section.screenshot.imagePath, {
        fit: [doc.page.width - theme.margins.left - theme.margins.right, 300],
        align: 'center'
      });

      // 타임스탬프
      const timestamp = formatTimestamp(section.timestamp);
      if (config.timestampLinks) {
        const youtubeUrl = `https://youtube.com/watch?v=${content.metadata.id}&t=${section.timestamp}`;
        doc.fillColor(theme.colors.link)
           .text(timestamp, { link: youtubeUrl });
      } else {
        doc.text(timestamp);
      }

      // 자막
      doc.fillColor(theme.colors.text);
      for (const sub of section.subtitles) {
        doc.text(sub.text);
      }

    } else {
      // horizontal 레이아웃
      // 좌측: 스크린샷, 우측: 자막
    }

    doc.addPage();
  }

  async generateMarkdown(content: PDFContent): Promise<string> {
    let md = `# ${content.metadata.title}\n\n`;
    md += `> 채널: ${content.metadata.channel}\n`;
    md += `> 원본: https://youtube.com/watch?v=${content.metadata.id}\n\n`;
    md += `---\n\n`;

    for (const section of content.sections) {
      const timestamp = formatTimestamp(section.timestamp);
      const link = `https://youtube.com/watch?v=${content.metadata.id}&t=${section.timestamp}`;

      md += `## [${timestamp}](${link})\n\n`;
      md += `![Screenshot](${section.screenshot.imagePath})\n\n`;

      for (const sub of section.subtitles) {
        md += `${sub.text}\n`;
      }
      md += `\n---\n\n`;
    }

    return md;
  }
}
```

### 2.5 `src/core/content-merger.ts` - 콘텐츠 병합

**책임**: 스크린샷과 자막을 타임스탬프 기준으로 병합

```typescript
class ContentMerger {
  merge(
    metadata: VideoMetadata,
    subtitles: SubtitleResult,
    screenshots: Screenshot[]
  ): PDFContent {
    const sections: PDFSection[] = [];

    for (const screenshot of screenshots) {
      // 해당 스크린샷 시점 전후의 자막 찾기
      const relevantSubtitles = subtitles.segments.filter(seg => {
        const startTime = screenshot.timestamp;
        const endTime = screenshot.timestamp + this.config.screenshot.interval;
        return seg.start >= startTime && seg.start < endTime;
      });

      sections.push({
        timestamp: screenshot.timestamp,
        screenshot,
        subtitles: relevantSubtitles
      });
    }

    return { metadata, sections };
  }
}
```

### 2.6 `src/core/cost-estimator.ts` - 비용 추정

```typescript
class CostEstimator {
  private static WHISPER_COST_PER_MINUTE = 0.006; // USD

  static estimate(durationSeconds: number): CostEstimate {
    const minutes = Math.ceil(durationSeconds / 60);
    const whisperCost = minutes * this.WHISPER_COST_PER_MINUTE;

    return {
      whisperCost,
      totalCost: whisperCost,
      currency: 'USD',
      breakdown: {
        whisper: { minutes, costPerMinute: this.WHISPER_COST_PER_MINUTE }
      }
    };
  }

  static formatCost(estimate: CostEstimate): string {
    return `$${estimate.totalCost.toFixed(2)}`;
  }
}
```

---

## 3. Provider 모듈

### 3.1 `src/providers/youtube.ts` - YouTube Provider

**책임**: YouTube API/yt-dlp 래핑

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class YouTubeProvider {
  private ytdlpPath: string;

  constructor(ytdlpPath?: string) {
    this.ytdlpPath = ytdlpPath || 'yt-dlp';
  }

  async getMetadata(url: string): Promise<VideoMetadata> {
    const { stdout } = await execAsync(
      `${this.ytdlpPath} --dump-json "${url}"`
    );
    const data = JSON.parse(stdout);

    return {
      id: data.id,
      title: data.title,
      description: data.description,
      duration: data.duration,
      thumbnail: data.thumbnail,
      channel: data.uploader,
      uploadDate: data.upload_date,
      viewCount: data.view_count,
      availableCaptions: this.parseCaptions(data.subtitles, data.automatic_captions)
    };
  }

  async getCaptions(videoId: string, langCode: string): Promise<SubtitleSegment[]> {
    const tempFile = path.join(os.tmpdir(), `${videoId}_${langCode}.vtt`);

    await execAsync(
      `${this.ytdlpPath} --write-sub --sub-lang ${langCode} ` +
      `--skip-download -o "${tempFile}" "https://youtube.com/watch?v=${videoId}"`
    );

    const vttContent = await fs.readFile(tempFile, 'utf-8');
    return this.parseVTT(vttContent);
  }

  async downloadVideo(
    videoId: string,
    outputDir: string,
    format: string
  ): Promise<string> {
    const outputPath = path.join(outputDir, `${videoId}.mp4`);

    await execAsync(
      `${this.ytdlpPath} -f "${format}" -o "${outputPath}" ` +
      `"https://youtube.com/watch?v=${videoId}"`
    );

    return outputPath;
  }

  async downloadAudio(videoId: string, outputDir: string): Promise<string> {
    const outputPath = path.join(outputDir, `${videoId}.mp3`);

    await execAsync(
      `${this.ytdlpPath} -x --audio-format mp3 -o "${outputPath}" ` +
      `"https://youtube.com/watch?v=${videoId}"`
    );

    return outputPath;
  }

  async getPlaylistVideos(url: string): Promise<VideoMetadata[]> {
    const { stdout } = await execAsync(
      `${this.ytdlpPath} --flat-playlist --dump-json "${url}"`
    );

    const videos = stdout.trim().split('\n').map(line => JSON.parse(line));
    return Promise.all(videos.map(v => this.getMetadata(v.url)));
  }

  static parseUrl(url: string): { type: 'video' | 'playlist'; id: string } {
    const videoMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const playlistMatch = url.match(/list=([a-zA-Z0-9_-]+)/);

    if (playlistMatch) {
      return { type: 'playlist', id: playlistMatch[1] };
    }
    if (videoMatch) {
      return { type: 'video', id: videoMatch[1] };
    }
    throw new Error('Invalid YouTube URL');
  }

  static isValidUrl(url: string): boolean {
    try {
      this.parseUrl(url);
      return true;
    } catch {
      return false;
    }
  }

  private parseVTT(content: string): SubtitleSegment[] {
    // VTT 파싱 로직
    const segments: SubtitleSegment[] = [];
    const lines = content.split('\n');
    // ... 파싱 구현
    return segments;
  }

  private parseCaptions(subtitles: any, autoCaptions: any): CaptionTrack[] {
    const tracks: CaptionTrack[] = [];

    // 수동 자막
    if (subtitles) {
      for (const [code, data] of Object.entries(subtitles)) {
        tracks.push({
          language: data[0]?.name || code,
          languageCode: code,
          isAutoGenerated: false
        });
      }
    }

    // 자동 자막
    if (autoCaptions) {
      for (const [code, data] of Object.entries(autoCaptions)) {
        tracks.push({
          language: data[0]?.name || code,
          languageCode: code,
          isAutoGenerated: true
        });
      }
    }

    return tracks;
  }
}
```

### 3.2 `src/providers/whisper.ts` - Whisper Provider

```typescript
import OpenAI from 'openai';
import * as fs from 'fs';

class WhisperProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audioPath: string, options?: WhisperOptions): Promise<WhisperResult> {
    const audioFile = fs.createReadStream(audioPath);

    const response = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: options?.language,
      prompt: options?.prompt,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    return {
      text: response.text,
      language: response.language,
      duration: response.duration,
      segments: response.segments.map(seg => ({
        start: seg.start,
        end: seg.end,
        text: seg.text
      }))
    };
  }

  estimateCost(durationSeconds: number): number {
    const minutes = Math.ceil(durationSeconds / 60);
    return minutes * 0.006; // $0.006/minute
  }
}
```

### 3.3 `src/providers/ffmpeg.ts` - FFmpeg Wrapper

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

class FFmpegWrapper {
  constructor(private ffmpegPath: string = 'ffmpeg') {}

  async captureFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string,
    quality: 'low' | 'medium' | 'high'
  ): Promise<void> {
    const scaleMap = {
      low: '854:480',
      medium: '1280:720',
      high: '1920:1080'
    };

    const scale = scaleMap[quality];
    const timeStr = this.formatTime(timestamp);

    await execAsync(
      `${this.ffmpegPath} -ss ${timeStr} -i "${videoPath}" ` +
      `-vframes 1 -vf scale=${scale} -q:v 2 "${outputPath}" -y`
    );
  }

  async extractAudio(
    videoPath: string,
    outputPath: string,
    format: string = 'mp3'
  ): Promise<void> {
    await execAsync(
      `${this.ffmpegPath} -i "${videoPath}" -vn -acodec libmp3lame ` +
      `-q:a 2 "${outputPath}" -y`
    );
  }

  async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`
    );

    const data = JSON.parse(stdout);
    const videoStream = data.streams.find(s => s.codec_type === 'video');

    return {
      duration: parseFloat(data.format.duration),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: eval(videoStream?.r_frame_rate || '30/1')
    };
  }

  static async checkInstallation(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version');
      return true;
    } catch {
      return false;
    }
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }
}
```

---

## 4. Template 모듈

### 4.1 `src/templates/pdf/default.ts` - 기본 테마

```typescript
export const defaultTheme: Theme = {
  name: 'default',
  margins: {
    top: 50,
    bottom: 50,
    left: 50,
    right: 50
  },
  fonts: {
    title: { name: 'Helvetica-Bold', size: 24 },
    heading: { name: 'Helvetica-Bold', size: 14 },
    body: { name: 'Helvetica', size: 11 },
    timestamp: { name: 'Helvetica', size: 10 }
  },
  colors: {
    primary: '#2563eb',
    text: '#1f2937',
    secondary: '#6b7280',
    link: '#2563eb',
    background: '#ffffff'
  },
  spacing: {
    sectionGap: 30,
    paragraphGap: 10,
    imageMargin: 15
  }
};
```

### 4.2 `src/templates/pdf/note.ts` - 노트 테마

```typescript
export const noteTheme: Theme = {
  name: 'note',
  margins: {
    top: 60,
    bottom: 60,
    left: 70,
    right: 120  // 메모 공간
  },
  // ... 학습 노트 스타일
};
```

---

## 5. Utils 모듈

### 5.1 `src/utils/config.ts` - 설정 관리

```typescript
import * as yaml from 'yaml';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

// 설정 스키마
const ConfigSchema = z.object({
  output: z.object({
    directory: z.string().default('./output'),
    format: z.enum(['pdf', 'md', 'html']).default('pdf'),
    filenamePattern: z.string().default('{date}_{index}_{title}')
  }),
  screenshot: z.object({
    interval: z.number().min(10).max(600).default(60),
    quality: z.enum(['low', 'medium', 'high']).default('low')
  }),
  subtitle: z.object({
    priority: z.enum(['youtube', 'whisper']).default('youtube'),
    languages: z.array(z.string()).default(['ko', 'en'])
  }),
  pdf: z.object({
    layout: z.enum(['vertical', 'horizontal']).default('vertical'),
    theme: z.string().default('default'),
    includeToc: z.boolean().default(true),
    timestampLinks: z.boolean().default(true),
    searchable: z.boolean().default(true)
  }),
  whisper: z.object({
    provider: z.enum(['openai', 'groq', 'local']).default('openai')
  }),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(7)
  }),
  processing: z.object({
    maxDuration: z.number().default(7200),
    parallel: z.boolean().default(true),
    retryCount: z.number().default(3)
  })
});

type Config = z.infer<typeof ConfigSchema>;

class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;

  static async load(cliOptions?: Partial<Config>): Promise<Config> {
    // 1. 기본값
    let config = ConfigSchema.parse({});

    // 2. 전역 설정 파일
    const globalPath = this.getGlobalConfigPath();
    if (await this.fileExists(globalPath)) {
      const globalConfig = await this.loadYaml(globalPath);
      config = this.merge(config, globalConfig);
    }

    // 3. 프로젝트 설정 파일
    const projectPath = this.getProjectConfigPath();
    if (await this.fileExists(projectPath)) {
      const projectConfig = await this.loadYaml(projectPath);
      config = this.merge(config, projectConfig);
    }

    // 4. CLI 옵션
    if (cliOptions) {
      config = this.merge(config, cliOptions);
    }

    // 5. 유효성 검사
    return ConfigSchema.parse(config);
  }

  static getProjectConfigPath(): string {
    return path.join(process.cwd(), 'yt2pdf.config.yaml');
  }

  static getGlobalConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.config', 'yt2pdf', 'config.yaml');
  }

  private static async loadYaml(filePath: string): Promise<Partial<Config>> {
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.parse(content);
  }

  private static merge(base: Config, override: Partial<Config>): Config {
    return { ...base, ...override };
  }

  private static async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

### 5.2 `src/utils/cache.ts` - 캐시 관리

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

class CacheManager {
  constructor(
    private cacheDir: string,
    private ttlDays: number
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  generateKey(url: string, options?: object): string {
    const data = JSON.stringify({ url, options });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const filePath = this.getFilePath(key);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      if (Date.now() > entry.expiresAt) {
        await this.delete(key);
        return null;
      }

      return entry.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlDays * 24 * 60 * 60 * 1000
    };

    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    await fs.unlink(filePath).catch(() => {});
  }

  async clear(): Promise<void> {
    const files = await fs.readdir(this.cacheDir);
    await Promise.all(
      files.map(f => fs.unlink(path.join(this.cacheDir, f)))
    );
  }

  async cleanup(): Promise<number> {
    let removed = 0;
    const files = await fs.readdir(this.cacheDir);

    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entry = JSON.parse(content);
        if (Date.now() > entry.expiresAt) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch {
        await fs.unlink(filePath);
        removed++;
      }
    }

    return removed;
  }

  async getStats(): Promise<{ size: number; entries: number }> {
    const files = await fs.readdir(this.cacheDir);
    let totalSize = 0;

    for (const file of files) {
      const stat = await fs.stat(path.join(this.cacheDir, file));
      totalSize += stat.size;
    }

    return { size: totalSize, entries: files.length };
  }

  private getFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }
}
```

### 5.3 `src/utils/logger.ts` - 로깅

```typescript
import chalk from 'chalk';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

class Logger {
  private levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };

  constructor(private level: LogLevel = 'error') {}

  error(message: string, error?: Error): void {
    console.error(chalk.red(`✖ ${message}`));
    if (error && this.shouldLog('debug')) {
      console.error(chalk.gray(error.stack));
    }
  }

  warn(message: string): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(`⚠ ${message}`));
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      console.log(chalk.blue(`ℹ ${message}`));
    }
  }

  debug(message: string, data?: object): void {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(`● ${message}`));
      if (data) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  success(message: string): void {
    console.log(chalk.green(`✓ ${message}`));
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.level];
  }
}

export const logger = new Logger();
```

---

*마지막 업데이트: 2025-01-26*
