# yt2pdf

YouTube 영상의 자막과 스크린샷을 추출하여 PDF로 변환하는 CLI 도구

[![Test](https://img.shields.io/badge/tests-87%20passed-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-98%25-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-blue)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## 기능

- YouTube 자막 추출 (자동 자막 포함)
- 자막이 없는 영상은 OpenAI Whisper API로 자동 생성
- 일정 간격으로 스크린샷 자동 캡처
- PDF, Markdown, HTML 출력 지원
- 플레이리스트 일괄 변환
- 타임스탬프 클릭 시 YouTube 해당 시점으로 이동

## 설치

### 사전 요구사항

- Node.js 18+
- ffmpeg
- yt-dlp

### 의존성 설치

```bash
# 저장소 클론
git clone https://github.com/ChanseokJeon/yt2pdf.git
cd yt2pdf

# 의존성 설치 (ffmpeg, yt-dlp 자동 설치)
npm run setup

# 또는 npm 패키지만 설치
npm install
```

### 외부 도구 수동 설치

```bash
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
sudo apt install ffmpeg
pip3 install yt-dlp

# Windows
# https://ffmpeg.org/download.html
# https://github.com/yt-dlp/yt-dlp#installation
```

## 사용법

### 기본 사용

```bash
# 단일 영상 변환
yt2pdf https://youtube.com/watch?v=xxxxx

# 플레이리스트 변환
yt2pdf https://youtube.com/playlist?list=xxxxx
```

### 옵션

```bash
yt2pdf <YouTube-URL> [options]

Options:
  -o, --output <path>      출력 디렉토리 (기본: ./output)
  -f, --format <type>      출력 포맷: pdf, md, html (기본: pdf)
  -i, --interval <sec>     스크린샷 간격 (초) (기본: 60)
  -l, --layout <type>      PDF 레이아웃: vertical, horizontal
  -t, --theme <name>       PDF 테마: default, note, minimal
  -q, --quality <level>    스크린샷 품질: low, medium, high
  --lang <code>            자막 언어: ko, en
  --no-cache               캐시 사용 안함
  --verbose                상세 로그 출력
  -h, --help               도움말
  -v, --version            버전
```

### 예시

```bash
# Markdown 출력
yt2pdf https://youtube.com/watch?v=xxxxx -f md

# 고화질 스크린샷, 30초 간격
yt2pdf https://youtube.com/watch?v=xxxxx -q high -i 30

# 한국어 자막 우선
yt2pdf https://youtube.com/watch?v=xxxxx --lang ko

# 특정 디렉토리에 저장
yt2pdf https://youtube.com/watch?v=xxxxx -o ./docs
```

## 설정

### 설정 파일 생성

```bash
# 프로젝트 설정
yt2pdf config init

# 전역 설정
yt2pdf config init --global
```

### 설정 파일 예시 (yt2pdf.config.yaml)

```yaml
output:
  directory: ./output
  format: pdf
  filenamePattern: "{date}_{index}_{title}"

screenshot:
  interval: 60
  quality: low    # low(480p), medium(720p), high(1080p)

subtitle:
  priority: youtube
  languages:
    - ko
    - en

pdf:
  layout: vertical
  theme: default
  includeToc: true
  timestampLinks: true

whisper:
  provider: openai

cache:
  enabled: true
  ttl: 7          # 캐시 유지 기간 (일)
```

## 환경 변수

```bash
# .env 파일 또는 환경 변수

# OpenAI API 키 (Whisper용 - 자막 없는 영상 처리 시 필요)
OPENAI_API_KEY=sk-your-api-key

# 선택적
YT_DLP_PATH=/path/to/yt-dlp
FFMPEG_PATH=/path/to/ffmpeg
```

## Cloud Run 배포

### 사전 요구사항

- Google Cloud SDK (`gcloud`)
- GCP 프로젝트

### 배포

```bash
# 1. GCP 프로젝트 설정
gcloud config set project YOUR_PROJECT_ID

# 2. 배포 실행
./scripts/deploy-cloudrun.sh
```

### API 사용

```bash
# 동기 변환 (Cloud Run)
curl -X POST https://YOUR_SERVICE_URL/api/v1/jobs/sync \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=VIDEO_ID"}'
```

### 응답 예시

```json
{
  "jobId": "abc-123",
  "status": "completed",
  "downloadUrl": "https://storage.googleapis.com/...",
  "expiresAt": "2026-02-05T12:00:00.000Z",
  "stats": {
    "pages": 15,
    "processingTime": 45000
  }
}
```

다운로드 URL은 24시간 후 만료되며, 파일은 7일 후 자동 삭제됩니다.

## 프로그래밍 방식 사용

```typescript
import { convert, convertPlaylist } from 'yt2pdf';

// 단일 영상
const result = await convert({
  url: 'https://youtube.com/watch?v=xxxxx',
  output: './output',
  format: 'pdf',
});

console.log(`생성됨: ${result.outputPath}`);
console.log(`페이지: ${result.stats.pages}`);

// 플레이리스트
const results = await convertPlaylist({
  url: 'https://youtube.com/playlist?list=xxxxx',
});
```

## API Reference

### Types

```typescript
// 출력 형식
type OutputFormat = 'pdf' | 'md' | 'html';

// PDF 레이아웃
type PDFLayout = 'vertical' | 'horizontal';

// 이미지 품질
type ImageQuality = 'low' | 'medium' | 'high';
// low: 480p, medium: 720p, high: 1080p

// 변환 결과
interface ConversionResult {
  outputPath: string;      // 생성된 파일 경로
  metadata: VideoMetadata; // 영상 메타데이터
  stats: {
    pages: number;         // 페이지 수
    fileSize: number;      // 파일 크기 (bytes)
    screenshotCount: number; // 스크린샷 개수
    duration: number;      // 영상 길이 (초)
  };
}

// 영상 메타데이터
interface VideoMetadata {
  id: string;              // YouTube 영상 ID
  title: string;           // 영상 제목
  channel: string;         // 채널명
  duration: number;        // 영상 길이 (초)
  thumbnail: string;       // 썸네일 URL
}
```

### Functions

#### `convert(options): Promise<ConversionResult>`

단일 YouTube 영상을 변환합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `url` | `string` | (필수) | YouTube URL |
| `output` | `string` | `./output` | 출력 디렉토리 |
| `format` | `OutputFormat` | `pdf` | 출력 형식 |
| `interval` | `number` | `60` | 스크린샷 간격 (초) |
| `layout` | `PDFLayout` | `vertical` | PDF 레이아웃 |
| `quality` | `ImageQuality` | `low` | 스크린샷 품질 |
| `lang` | `string` | 자동 감지 | 자막 언어 코드 |

#### `convertPlaylist(options): Promise<ConversionResult[]>`

YouTube 플레이리스트의 모든 영상을 변환합니다.

### Input Validation

CLI는 다음 입력을 자동으로 검증합니다:

| 항목 | 검증 규칙 |
|------|-----------|
| YouTube URL | youtube.com 또는 youtu.be 형식 |
| 출력 형식 | pdf, md, html 중 하나 |
| 레이아웃 | vertical, horizontal 중 하나 |
| 품질 | low, medium, high 중 하나 |
| 간격 | 5~600초 범위의 숫자 |
| 언어 코드 | ISO 639-1 형식 (예: ko, en) |

## 캐시 관리

```bash
# 캐시 상태 확인
yt2pdf cache show

# 캐시 전체 삭제
yt2pdf cache clear

# 만료된 캐시만 정리
yt2pdf cache cleanup
```

## 비용

- **YouTube 자막 있는 영상**: 무료
- **YouTube 자막 없는 영상**: OpenAI Whisper API 비용 발생
  - $0.006/분 (약 7원/분)
  - 30분 영상 ≈ $0.18 (약 210원)

변환 전 예상 비용이 표시됩니다.

## 문제 해결

### ffmpeg를 찾을 수 없음

```bash
yt2pdf setup --check  # 설치 상태 확인
yt2pdf setup          # 자동 설치
```

### API 키 오류

```bash
# .env 파일 생성
cp .env.example .env

# API 키 설정
echo "OPENAI_API_KEY=sk-your-key" >> .env
```

## 개발

```bash
# 개발 모드 실행
npm run dev -- https://youtube.com/watch?v=xxxxx

# 빌드
npm run build

# 테스트
npm test

# 린트
npm run lint
```

## 라이선스

MIT

## 크레딧

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube 다운로드
- [ffmpeg](https://ffmpeg.org/) - 영상 처리
- [OpenAI Whisper](https://openai.com/research/whisper) - 음성 인식
