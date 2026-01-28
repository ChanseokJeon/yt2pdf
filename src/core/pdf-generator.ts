/**
 * PDF 생성기
 */

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { PDFDocument as PDFLibDocument, PDFName } from 'pdf-lib';
import { PDFContent, PDFSection, VideoMetadata, ContentSummary, ExecutiveBrief } from '../types/index.js';
import { PDFConfig } from '../types/config.js';
import { formatTimestamp, buildTimestampUrl, cleanSubtitleText, deduplicateSubtitles, cleanMixedLanguageText } from '../utils/index.js';
import { logger } from '../utils/logger.js';

/**
 * 텍스트를 PDF 렌더링에 안전한 형태로 정규화
 * - NFC 정규화 (한글 조합형 → 완성형)
 * - 제어 문자 제거
 * - 특수 유니코드 문자 필터링
 */
function normalizeTextForPDF(text: string): string {
  if (!text) return text;

  // 1. NFC 정규화 (한글 조합형 → 완성형)
  // NFD 형태의 한글(ㅎㅏㄴㄱㅡㄹ)을 NFC 형태(한글)로 변환
  let normalized = text.normalize('NFC');

  // 2. 제어 문자 제거 (탭, 줄바꿈은 유지)
  normalized = normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. 유니코드 대체 문자(Replacement Character) 제거
  normalized = normalized.replace(/\uFFFD/g, '');

  // 4. Zero-width 문자 제거 (ZWJ, ZWNJ, ZWSP 등)
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 5. 한글 확장 문자 제거 (PDFKit에서 렌더링 실패하는 문자들)
  // - D7B0-D7FF: 한글 자모 확장-B
  // - A960-A97F: 한글 자모 확장-A
  normalized = normalized.replace(/[\uD7B0-\uD7FF\uA960-\uA97F]/g, '');

  // 6. Private Use Area 문자 제거
  normalized = normalized.replace(/[\uE000-\uF8FF]/g, '');

  // 7. 확장 라틴 문자 처리 (PDFKit 폰트 폴백 문제 방지)
  // 일반적인 확장 라틴을 기본 ASCII로 변환
  const latinMap: Record<string, string> = {
    'ħ': 'h', 'Ħ': 'H',
    'ı': 'i', 'İ': 'I', 'Ĩ': 'I', 'ĩ': 'i',
    'ł': 'l', 'Ł': 'L',
    'ñ': 'n', 'Ñ': 'N',
    'ø': 'o', 'Ø': 'O',
    'ß': 'ss',
    'þ': 'th', 'Þ': 'Th',
    'đ': 'd', 'Đ': 'D',
  };
  for (const [from, to] of Object.entries(latinMap)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to);
  }

  // 8. 나머지 확장 라틴 문자 제거 (Latin Extended-A, B)
  normalized = normalized.replace(/[\u0100-\u024F]/g, '');

  // 9. 쓰레기 한글 패턴 제거 (한글+ASCII 비정상 혼합)
  normalized = normalized.replace(/[가-힣][a-z`_]{1,3}[가-힣]/gi, '');

  return normalized;
}

/**
 * URL에서 이미지를 Buffer로 다운로드
 */
async function downloadImageToBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, (response) => {
      // 리다이렉트 처리
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImageToBuffer(redirectUrl).then(resolve);
          return;
        }
      }

      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => resolve(null));
    });
    request.on('error', () => resolve(null));
    request.setTimeout(10000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

// Font paths - relative to project root
function getFontsDir(): string {
  // Try multiple possible locations
  const possiblePaths = [
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(__dirname, '../../assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return possiblePaths[0]; // default
}

const FONTS_DIR = getFontsDir();
const KOREAN_FONT_REGULAR = path.join(FONTS_DIR, 'NotoSansKR-Regular.ttf');
const KOREAN_FONT_BOLD = path.join(FONTS_DIR, 'NotoSansKR-Bold.ttf');

export interface Theme {
  name: string;
  margins: { top: number; bottom: number; left: number; right: number };
  fonts: {
    title: { name: string; size: number };
    heading: { name: string; size: number };
    body: { name: string; size: number };
    timestamp: { name: string; size: number };
  };
  colors: {
    primary: string;
    text: string;
    secondary: string;
    link: string;
    background: string;
  };
  spacing: {
    sectionGap: number;
    paragraphGap: number;
    imageMargin: number;
  };
}

// Check if Korean fonts are available
function hasKoreanFonts(): boolean {
  try {
    return fs.existsSync(KOREAN_FONT_REGULAR) && fs.existsSync(KOREAN_FONT_BOLD);
  } catch {
    return false;
  }
}

// Validate Korean font format
function validateKoreanFont(): boolean {
  if (!hasKoreanFonts()) return false;

  // Font file extension check
  const regularExt = path.extname(KOREAN_FONT_REGULAR).toLowerCase();
  const boldExt = path.extname(KOREAN_FONT_BOLD).toLowerCase();

  if (regularExt === '.otf' || boldExt === '.otf') {
    logger.warn('OTF 폰트는 한글 렌더링 문제가 발생할 수 있습니다. TTF 사용을 권장합니다.');
  }

  return true;
}

const DEFAULT_THEME: Theme = {
  name: 'default',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  fonts: {
    title: { name: 'NotoSansKR-Bold', size: 24 },
    heading: { name: 'NotoSansKR-Bold', size: 14 },
    body: { name: 'NotoSansKR-Regular', size: 11 },
    timestamp: { name: 'NotoSansKR-Regular', size: 10 },
  },
  colors: {
    primary: '#2563eb',
    text: '#1f2937',
    secondary: '#6b7280',
    link: '#2563eb',
    background: '#ffffff',
  },
  spacing: {
    sectionGap: 30,
    paragraphGap: 10,
    imageMargin: 15,
  },
};

export class PDFGenerator {
  private config: PDFConfig;
  private theme: Theme;

  constructor(config: PDFConfig) {
    this.config = config;
    this.theme = this.loadTheme(config.theme);
  }

  /**
   * PDF 생성
   */
  async generatePDF(content: PDFContent, outputPath: string): Promise<void> {
    // 썸네일 다운로드 (비동기)
    let thumbnailBuffer: Buffer | null = null;
    if (content.metadata.thumbnail) {
      logger.debug('썸네일 다운로드 중...');
      thumbnailBuffer = await downloadImageToBuffer(content.metadata.thumbnail);
      if (thumbnailBuffer) {
        logger.debug('썸네일 다운로드 완료');
      }
    }

    return new Promise((resolve, reject) => {
      try {
        logger.info('PDF 생성 시작...');

        const doc = new PDFDocument({
          size: 'A4',
          margins: this.theme.margins,
          info: {
            Title: content.metadata.title,
            Author: content.metadata.channel,
            Subject: `YouTube: ${content.metadata.id}`,
            Creator: 'yt2pdf',
            Producer: 'yt2pdf - YouTube to PDF Converter',
            Keywords: 'YouTube, transcript, subtitle, screenshot',
          },
        });

        // Register Korean fonts
        if (validateKoreanFont()) {
          doc.registerFont('NotoSansKR-Regular', KOREAN_FONT_REGULAR);
          doc.registerFont('NotoSansKR-Bold', KOREAN_FONT_BOLD);
          logger.debug('한글 폰트 로드 완료');
        } else {
          logger.warn('한글 폰트를 찾을 수 없습니다. 기본 폰트를 사용합니다.');
          // Fallback to Helvetica
          this.theme.fonts.title.name = 'Helvetica-Bold';
          this.theme.fonts.heading.name = 'Helvetica-Bold';
          this.theme.fonts.body.name = 'Helvetica';
          this.theme.fonts.timestamp.name = 'Helvetica';
        }

        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);

        // 페이지 푸터 추가 함수
        const addPageFooter = (pageNum: number, totalPages: number) => {
          const bottomY = doc.page.height - 30;
          const savedY = doc.y;
          doc
            .font(this.theme.fonts.timestamp.name)
            .fontSize(9)
            .fillColor(this.theme.colors.secondary);

          // 제목 (왼쪽) - NFC 정규화 적용
          const shortTitle =
            content.metadata.title.length > 45
              ? content.metadata.title.substring(0, 45) + '...'
              : content.metadata.title;
          doc.text(normalizeTextForPDF(shortTitle), this.theme.margins.left, bottomY, {
            width: doc.page.width / 2 - this.theme.margins.left,
            align: 'left',
            lineBreak: false,
          });

          // 페이지 번호 (오른쪽)
          doc.text(`${pageNum} / ${totalPages}`, doc.page.width / 2, bottomY, {
            width: doc.page.width / 2 - this.theme.margins.right,
            align: 'right',
            lineBreak: false,
          });

          doc.y = savedY;
        };

        // 표지 (썸네일 + 요약 포함)
        this.renderCoverPageSync(doc, content.metadata, thumbnailBuffer, content.sections.length, content.summary);

        // 목차 (옵션)
        if (this.config.includeToc) {
          this.renderTableOfContents(doc, content.sections, content.metadata.id);
        }

        // 섹션 필터링: 최종 처리 후 콘텐츠가 부족한 섹션 제외
        const validSections = content.sections.filter(section => {
          const subtitleTexts = section.subtitles.map(sub => {
            const cleaned = cleanSubtitleText(sub.text);
            return normalizeTextForPDF(cleanMixedLanguageText(cleaned, 'ko'));
          });
          const dedupedTexts = deduplicateSubtitles(subtitleTexts);
          const totalWords = dedupedTexts.join(' ').split(/\s+/).filter(w => w.length > 0).length;
          return totalWords >= 10; // 최종 처리 후 10단어 이상만 포함
        });

        // 총 페이지 수 계산 (표지 + 목차? + 유효 섹션들)
        const totalPages = 1 + (this.config.includeToc ? 1 : 0) + validSections.length;
        let currentPage = 1; // 표지는 1페이지

        // PDF 아웃라인(북마크) 추가
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outline = (doc as any).outline;

        // 본문 페이지 렌더링 (유효 섹션만)
        for (let i = 0; i < validSections.length; i++) {
          const section = validSections[i];

          if (i > 0 || this.config.includeToc) {
            doc.addPage();
          }
          currentPage++;

          // 북마크 추가 (타임스탬프로)
          const bookmarkTitle = formatTimestamp(section.timestamp);
          if (outline) {
            outline.addItem(bookmarkTitle);
          }

          if (this.config.layout === 'vertical') {
            this.renderVerticalSection(doc, section, content.metadata.id);
          } else {
            this.renderHorizontalSection(doc, section, content.metadata.id);
          }

          // 현재 페이지에 푸터 추가 (표지 제외)
          addPageFooter(currentPage, totalPages);
        }

        doc.end();

        writeStream.on('finish', async () => {
          try {
            await this.removeEmptyPages(outputPath);
            logger.success(`PDF 생성 완료: ${outputPath}`);
            resolve();
          } catch (e) {
            // Post-processing failure shouldn't fail the whole generation
            logger.warn(`빈 페이지 제거 실패: ${e}`);
            resolve();
          }
        });

        writeStream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Markdown 생성
   */
  async generateMarkdown(content: PDFContent, outputPath: string): Promise<void> {
    let md = `# ${content.metadata.title}\n\n`;
    md += `| 항목 | 내용 |\n`;
    md += `|------|------|\n`;
    md += `| **채널** | ${content.metadata.channel} |\n`;
    md += `| **영상 길이** | ${formatTimestamp(content.metadata.duration)} |\n`;
    md += `| **섹션** | ${content.sections.length}개 |\n`;
    md += `| **원본** | [YouTube](https://youtube.com/watch?v=${content.metadata.id}) |\n`;
    md += `| **생성일** | ${new Date().toISOString().split('T')[0]} |\n\n`;
    md += `---\n\n`;

    // 요약 (있는 경우)
    if (content.summary && content.summary.summary) {
      md += `## 📝 요약\n\n`;
      md += `${content.summary.summary}\n\n`;

      if (content.summary.keyPoints && content.summary.keyPoints.length > 0) {
        md += `### 💡 핵심 포인트\n\n`;
        for (const point of content.summary.keyPoints) {
          md += `- ${point}\n`;
        }
        md += `\n`;
      }
      md += `---\n\n`;
    }

    // 목차
    if (this.config.includeToc) {
      md += `## 목차\n\n`;
      for (const section of content.sections) {
        const timestamp = formatTimestamp(section.timestamp);
        md += `- [${timestamp}](#${timestamp.replace(/:/g, '')})\n`;
      }
      md += `\n---\n\n`;
    }

    // 본문
    for (const section of content.sections) {
      const timestamp = formatTimestamp(section.timestamp);
      const link = buildTimestampUrl(content.metadata.id, section.timestamp);

      md += `## [${timestamp}](${link}) {#${timestamp.replace(/:/g, '')}}\n\n`;

      // 스크린샷 (로컬 파일 참조)
      const imgName = path.basename(section.screenshot.imagePath);
      md += `![${timestamp} 스크린샷](./images/${imgName})\n\n`;

      // 섹션 요약 (있는 경우)
      if (section.sectionSummary && section.sectionSummary.summary) {
        md += `> **요약**: ${section.sectionSummary.summary}\n`;
        if (section.sectionSummary.keyPoints.length > 0) {
          md += `>\n`;
          for (const point of section.sectionSummary.keyPoints) {
            md += `> - ${point}\n`;
          }
        }
        md += `\n`;
      }

      // 자막 - 정리, 혼합 언어 정리, 중복 제거
      const subtitleTexts = section.subtitles.map((sub) => {
        const cleaned = cleanSubtitleText(sub.text);
        return cleanMixedLanguageText(cleaned, 'ko');
      });
      const dedupedTexts = deduplicateSubtitles(subtitleTexts);

      if (dedupedTexts.length === 0) {
        md += `*(이 구간에 자막이 없습니다)*\n\n`;
      } else {
        for (const text of dedupedTexts) {
          md += `${text}\n\n`;
        }
      }

      md += `---\n\n`;
    }

    // footer
    md += `\n---\n\n*Generated by [yt2pdf](https://github.com/user/yt2pdf)*\n\n> 영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.\n`;

    await fs.promises.writeFile(outputPath, md, 'utf-8');
    logger.success(`Markdown 생성 완료: ${outputPath}`);
  }

  /**
   * HTML 생성
   */
  async generateHTML(content: PDFContent, outputPath: string): Promise<void> {
    const timestamp = formatTimestamp;
    const { metadata, sections } = content;

    let html = `<!DOCTYPE html>
<html lang="${this.detectLanguage(sections)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#2563eb" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111827" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${metadata.title} - ${metadata.channel} | YouTube 영상 자막 및 스크린샷">
  <meta property="og:title" content="${metadata.title}">
  <meta property="og:description" content="${metadata.channel}의 YouTube 영상">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://youtube.com/watch?v=${metadata.id}">
  ${metadata.thumbnail ? `<meta property="og:image" content="${metadata.thumbnail}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${metadata.title}">
  <meta name="twitter:description" content="${metadata.channel}의 YouTube 영상 자막">
  ${metadata.thumbnail ? `<meta name="twitter:image" content="${metadata.thumbnail}">` : ''}
  <link rel="canonical" href="https://youtube.com/watch?v=${metadata.id}">
  <meta name="robots" content="noindex, nofollow">
  <meta name="generator" content="yt2pdf">
  <title>${metadata.title} | ${metadata.channel}</title>
  <style>
    :root {
      --bg-color: #ffffff;
      --text-color: #1f2937;
      --secondary-color: #6b7280;
      --border-color: #e5e7eb;
      --link-color: #2563eb;
      --section-bg: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #111827;
        --text-color: #f3f4f6;
        --secondary-color: #9ca3af;
        --border-color: #374151;
        --link-color: #60a5fa;
        --section-bg: #1f2937;
      }
    }
    /* 수동 다크 모드 */
    :root[data-theme="dark"] {
      --bg-color: #111827;
      --text-color: #f3f4f6;
      --secondary-color: #9ca3af;
      --border-color: #374151;
      --link-color: #60a5fa;
      --section-bg: #1f2937;
    }
    :root[data-theme="light"] {
      --bg-color: #ffffff;
      --text-color: #1f2937;
      --secondary-color: #6b7280;
      --border-color: #e5e7eb;
      --link-color: #2563eb;
      --section-bg: #ffffff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.7;
      background-color: var(--bg-color);
      color: var(--text-color);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      min-height: 100vh;
    }
    h1 { color: var(--text-color); line-height: 1.3; word-wrap: break-word; overflow-wrap: break-word; max-width: 100%; margin-bottom: 15px; }
    h1 a:hover { color: var(--link-color) !important; }
    a { transition: color 0.2s; }
    .meta { color: var(--secondary-color); margin-bottom: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 5px; }
    .meta a { color: var(--link-color); text-decoration: none; transition: color 0.2s; }
    .meta a:hover { text-decoration: underline; }
    .meta p { margin: 0; padding: 4px 0; }
    .section {
      margin: 35px 0;
      padding: 25px;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background-color: var(--section-bg);
      counter-increment: section;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .section::before {
      content: counter(section);
      position: absolute;
      top: -12px;
      left: 15px;
      background: var(--link-color);
      color: white;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: bold;
      min-width: 20px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .timestamp { font-size: 14px; color: var(--link-color); text-decoration: none; font-weight: bold; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--border-color); border-radius: 4px; transition: background 0.2s; }
    .timestamp:hover { text-decoration: none; background: var(--link-color); color: white; }
    .timestamp::before { content: '▶'; font-size: 10px; transition: transform 0.2s; }
    .timestamp:hover::before { transform: translateX(3px); color: white; }
    .screenshot { max-width: 100%; height: auto; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px; margin: 10px 0; cursor: zoom-in; transition: transform 0.2s, box-shadow 0.2s, opacity 0.3s; box-shadow: 0 2px 8px rgba(0,0,0,0.1); background: var(--border-color); }
    .screenshot:hover { box-shadow: 0 6px 16px rgba(0,0,0,0.18); transform: scale(1.01); }
    .screenshot.zoomed { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(1); max-width: 95vw; max-height: 95vh; z-index: 1000; cursor: zoom-out; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); animation: fadeIn 0.2s ease-out; }
    .overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 999; backdrop-filter: blur(5px); }
    .overlay.active { display: block; }
    /* 단축키 도움말 */
    .help-modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--section-bg); padding: 25px 35px; border-radius: 16px; z-index: 1001; box-shadow: 0 15px 60px rgba(0,0,0,0.35); max-width: 320px; border: 1px solid var(--border-color); }
    .help-modal.active { display: block; }
    .help-modal h3 { margin: 0 0 15px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; }
    .help-modal kbd { background: var(--border-color); padding: 4px 8px; border-radius: 5px; font-family: ui-monospace, monospace; font-size: 13px; border: 1px solid var(--secondary-color); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
    .help-modal ul { list-style: none; padding: 0; margin: 0; }
    .help-modal li { margin: 10px 0; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
    .help-modal button { margin-top: 15px; width: 100%; padding: 10px; border: none; background: var(--link-color); color: white; border-radius: 6px; cursor: pointer; font-weight: 500; transition: background 0.2s, transform 0.2s; }
    .help-modal button:hover { background: #1d4ed8; transform: scale(1.02); }
    /* 진행 표시줄 */
    .progress-bar { position: fixed; top: 0; left: 0; height: 4px; background: linear-gradient(90deg, var(--link-color), #60a5fa); z-index: 1000; transition: width 0.1s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
    /* 스크롤 스냅 */
    html { scroll-behavior: smooth; }
    /* 텍스트 선택 스타일 */
    ::selection { background: var(--link-color); color: white; }
    ::-moz-selection { background: var(--link-color); color: white; }
    /* 포커스 스타일 */
    :focus-visible { outline: 2px solid var(--link-color); outline-offset: 2px; }
    .subtitle { color: var(--text-color); margin: 15px 0; counter-reset: line; padding-top: 10px; border-top: 1px dashed var(--border-color); }
    .subtitle p { position: relative; padding-left: 30px; margin: 8px 0; line-height: 1.7; }
    .subtitle p::before { counter-increment: line; content: counter(line); position: absolute; left: 0; color: var(--secondary-color); font-size: 11px; opacity: 0.5; font-family: ui-monospace, monospace; }
    hr { border: none; border-top: 1px solid var(--border-color); margin: 25px 0; opacity: 0.6; }
    /* 스크롤바 스타일 */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg-color); }
    ::-webkit-scrollbar-thumb { background: var(--secondary-color); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--link-color); }
    /* 목차 스타일 */
    .toc { margin: 20px 0; padding: 15px 20px; background: var(--section-bg); border-radius: 10px; border: 1px solid var(--border-color); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .toc h2 { margin: 0 0 12px 0; font-size: 16px; cursor: pointer; user-select: none; }
    .toc h2::after { content: ' ▼'; font-size: 10px; }
    .toc.collapsed h2::after { content: ' ▶'; }
    .toc.collapsed .toc-list { display: none; }
    .toc-list { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 5px 0; margin: 0; max-height: 150px; overflow-y: auto; scrollbar-width: thin; }
    .toc-list li a { display: inline-block; padding: 4px 10px; background: var(--border-color); border-radius: 4px; text-decoration: none; color: var(--link-color); font-size: 13px; transition: all 0.2s; }
    .toc-list li a:hover { background: var(--link-color); color: white; transform: scale(1.05); }
    .toc-list li a:focus { outline: 2px solid var(--link-color); outline-offset: 1px; }
    .toc-list li a.current { background: var(--link-color); color: white; }
    /* 맨 위로 버튼 */
    .back-to-top {
      position: fixed;
      bottom: 30px;
      right: 30px;
      width: 44px;
      height: 44px;
      background: var(--link-color);
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 22px;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 15px rgba(0,0,0,0.25);
    }
    .back-to-top:hover { transform: scale(1.1); }
    .back-to-top:focus { outline: 2px solid var(--link-color); outline-offset: 2px; }
    .back-to-top { transition: transform 0.2s, opacity 0.2s; }
    .help-btn:hover { transform: scale(1.1); background: var(--link-color); }
    #themeToggle:hover { transform: scale(1.1); background: var(--secondary-color); }
    #copyAllBtn:hover { transform: scale(1.02); filter: brightness(1.1); }
    /* 검색 박스 */
    .search-box {
      position: sticky;
      top: 0;
      background: var(--bg-color);
      padding: 12px 0;
      z-index: 100;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 15px;
      backdrop-filter: blur(10px);
    }
    .search-box input {
      width: 100%;
      padding: 12px 40px 12px 16px;
      border: 2px solid var(--border-color);
      border-radius: 12px;
      font-size: 14px;
      background: var(--section-bg);
      color: var(--text-color);
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-box input:hover { border-color: var(--secondary-color); }
    .search-box input:focus {
      outline: none;
      border-color: var(--link-color);
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
    }
    .search-box input::placeholder { color: var(--secondary-color); }
    .search-count { font-size: 12px; color: var(--secondary-color); margin-top: 5px; transition: opacity 0.2s; padding: 4px 0; }
    .search-count:empty { display: none; }
    .section.hidden { display: none; }
    .section.active { border-color: var(--link-color); box-shadow: 0 0 0 3px var(--link-color), 0 4px 12px rgba(0,0,0,0.1); }
    .section:hover { border-color: var(--secondary-color); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    /* 접기 버튼 */
    .collapse-btn { background: var(--border-color); border: none; color: var(--secondary-color); cursor: pointer; font-size: 12px; padding: 4px 10px; margin-left: 10px; border-radius: 4px; transition: all 0.2s; }
    .collapse-btn:hover { background: var(--link-color); color: white; }
    .collapse-btn:active { transform: scale(0.95); }
    .subtitle.collapsed { display: none; }
    .subtitle:not(.collapsed) { animation: fadeIn 0.2s ease-out; }
    .section:target { animation: highlight 1s ease; }
    @keyframes highlight { 0%, 100% { background: var(--section-bg); } 50% { background: var(--border-color); } }
    .highlight { background-color: #fef08a; color: #1f2937; padding: 1px 2px; border-radius: 2px; transition: background-color 0.2s; }
    .highlight:hover { background-color: #facc15; }
    .highlight { animation: pulse 1.5s ease-in-out infinite; }
    @media (prefers-color-scheme: dark) {
      .highlight { background-color: #854d0e; color: #fef3c7; }
    }
    /* 모바일 반응형 */
    @media (max-width: 600px) {
      body { padding: 12px; }
      h1 { font-size: 1.4em; word-break: keep-all; }
      .meta { font-size: 14px; }
      .section { padding: 12px; margin: 20px 0; }
      .timestamp { font-size: 13px; }
      .subtitle { font-size: 15px; }
      .subtitle p { margin: 6px 0; }
      .toc { padding: 10px; }
      .toc-list { gap: 6px; }
      .toc-list li a { padding: 3px 8px; font-size: 12px; }
      .back-to-top { bottom: 15px; right: 15px; width: 36px; height: 36px; font-size: 18px; }
      .help-btn { bottom: 15px; right: 60px; width: 36px; height: 36px; font-size: 16px; }
      #themeToggle { bottom: 15px; right: 105px; width: 36px; height: 36px; font-size: 16px; }
      .section:hover { transform: none; box-shadow: none; }
      .section::before { font-size: 10px; padding: 2px 7px; }
    }
    /* 초기 로딩 애니메이션 */
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    body { animation: fadeIn 0.3s ease-out; }
    /* 인쇄 스타일 */
    @media print {
      .search-box, .back-to-top, .toc, .progress-bar, .help-modal, .overlay, .collapse-btn, .copy-btn, .help-btn, #themeToggle, .line-count { display: none !important; }
      .section { break-inside: avoid; border: none; box-shadow: none; page-break-inside: avoid; }
      .section::before { display: none; }
      body { max-width: 100%; padding: 0; }
      h1, .meta { page-break-after: avoid; }
      .screenshot { max-width: 80%; }
    }
  </style>
</head>
<body>
  <div class="progress-bar" id="progressBar"></div>
  <h1 id="top"><a href="https://youtube.com/watch?v=${metadata.id}" target="_blank" style="color:inherit;text-decoration:none;" title="YouTube에서 보기">${metadata.title}</a></h1>

  <!-- 검색 박스 -->
  <div class="search-box" style="position:relative">
    <input type="text" id="searchInput" placeholder="🔍 자막 검색... (Enter: 다음 결과)" autocomplete="off" style="padding-right:35px">
    <button id="clearSearch" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--secondary-color);cursor:pointer;font-size:18px;display:none;padding:0;line-height:1" title="검색 초기화">&times;</button>
    <div class="search-count" id="searchCount"></div>
  </div>

  <div class="meta">
    <p>👤 <strong>채널:</strong> <a href="https://youtube.com/@${encodeURIComponent(metadata.channel)}" target="_blank" style="color:var(--link-color)">${metadata.channel}</a></p>
    <p>⏱️ <strong>영상 길이:</strong> ${timestamp(metadata.duration)}</p>
    <p>📑 <strong>섹션:</strong> ${sections.length}개</p>
    <p>📖 <strong>읽기 시간:</strong> <span id="readTime"></span></p>
    <p>🔗 <strong>원본:</strong> <a href="https://youtube.com/watch?v=${metadata.id}">YouTube에서 보기</a></p>
    <p>📅 <strong>생성일:</strong> ${new Date().toISOString().split('T')[0]}</p>
    <p style="grid-column: 1 / -1"><button id="copyAllBtn" title="모든 자막을 클립보드에 복사합니다" style="padding:8px 16px;background:var(--link-color);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;transition:background 0.2s,transform 0.2s;">📋 전체 자막 복사</button></p>
  </div>
  <hr>

${content.summary && content.summary.summary ? `
  <!-- 요약 -->
  <div class="summary" style="margin:20px 0;padding:20px;background:var(--section-bg);border-radius:12px;border:1px solid var(--border-color);border-left:4px solid var(--link-color);">
    <h2 style="margin:0 0 12px 0;font-size:18px;color:var(--text-color);">📝 요약</h2>
    <p style="margin:0;line-height:1.8;color:var(--text-color);">${content.summary.summary}</p>
${content.summary.keyPoints && content.summary.keyPoints.length > 0 ? `
    <h3 style="margin:15px 0 8px 0;font-size:14px;color:var(--secondary-color);">💡 핵심 포인트</h3>
    <ul style="margin:0;padding-left:20px;color:var(--text-color);">
${content.summary.keyPoints.map((point) => `      <li style="margin:5px 0">${point}</li>`).join('\n')}
    </ul>
` : ''}
  </div>
  <hr>
` : ''}
  <!-- 목차 -->
  <nav class="toc">
    <h2>📑 목차 <span style="font-size:12px;font-weight:normal;color:var(--secondary-color)">(${sections.length}개 섹션)</span></h2>
    <ul class="toc-list">
${sections.map((s) => {
      const sectionSubtitles = s.subtitles.map((sub) => {
        const cleaned = cleanSubtitleText(sub.text);
        return cleanMixedLanguageText(cleaned, 'ko');
      });
      const sectionDeduped = deduplicateSubtitles(sectionSubtitles);
      const tsId = timestamp(s.timestamp).replace(/:/g, '');
      return `      <li><a href="#section-${tsId}" title="${sectionDeduped.length}줄">${timestamp(s.timestamp)}</a></li>`;
    }).join('\n')}
    </ul>
  </nav>
`;

    for (const section of sections) {
      const ts = timestamp(section.timestamp);
      const link = buildTimestampUrl(metadata.id, section.timestamp);
      const imgName = path.basename(section.screenshot.imagePath);

      // 자막 - 정리, 혼합 언어 정리, 중복 제거
      const subtitleTexts = section.subtitles.map((sub) => {
        const cleaned = cleanSubtitleText(sub.text);
        return cleanMixedLanguageText(cleaned, 'ko');
      });
      const dedupedTexts = deduplicateSubtitles(subtitleTexts);
      const lineCount = dedupedTexts.length;

      const sectionId = ts.replace(/:/g, '');

      // 섹션 요약 HTML
      let sectionSummaryHtml = '';
      if (section.sectionSummary && section.sectionSummary.summary) {
        sectionSummaryHtml = `
    <div class="section-summary" style="margin:10px 0;padding:12px 15px;background:linear-gradient(135deg, var(--border-color) 0%, transparent 100%);border-radius:8px;border-left:3px solid var(--link-color);">
      <div style="font-size:13px;color:var(--text-color);line-height:1.6;margin-bottom:8px;">${section.sectionSummary.summary}</div>
      ${section.sectionSummary.keyPoints.length > 0 ? `
      <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--secondary-color);">
        ${section.sectionSummary.keyPoints.map((p) => `<li style="margin:3px 0">${p}</li>`).join('')}
      </ul>` : ''}
    </div>`;
      }

      // 챕터 제목 HTML
      const chapterTitleHtml = section.chapterTitle
        ? `<h3 style="margin:0 0 10px 0;font-size:16px;color:var(--text-color);">📑 ${section.chapterTitle}</h3>`
        : '';

      html += `
  <div class="section" id="section-${sectionId}" data-timestamp="${section.timestamp}" data-lines="${lineCount}">
    ${chapterTitleHtml}
    <a class="timestamp" href="${link}" target="_blank" title="YouTube에서 ${ts}부터 재생">${ts}</a>
    <span class="line-count" style="font-size:11px;color:var(--secondary-color);margin-left:8px">${lineCount}줄</span>
    <button class="collapse-btn" onclick="this.parentElement.querySelector('.subtitle').classList.toggle('collapsed');this.textContent=this.textContent==='▼'?'▶':'▼';" title="접기/펼치기">▼</button>
    <button class="collapse-btn copy-btn" title="자막 복사" aria-label="이 섹션 자막 복사">📋</button>
    <img class="screenshot" src="./images/${imgName}" alt="Screenshot at ${ts}" loading="lazy" onerror="this.outerHTML='<div style=\\'background:var(--border-color);padding:40px;text-align:center;border-radius:4px;color:var(--secondary-color)\\'>📷 이미지 로드 실패</div>'">${sectionSummaryHtml}
    <div class="subtitle">
`;
      if (dedupedTexts.length === 0) {
        html += `      <p style="color:var(--secondary-color);font-style:italic">(이 구간에 자막이 없습니다)</p>\n`;
      } else {
        for (const text of dedupedTexts) {
          // HTML 출력에서는 특수문자 이스케이프
          const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          html += `      <p>${escaped}</p>\n`;
        }
      }

      html += `    </div>
  </div>
`;
    }

    html += `
  <div class="overlay" id="overlay"></div>
  <div class="help-modal" id="helpModal">
    <h3>⌨️ 단축키</h3>
    <ul>
      <li><span><kbd>j</kbd> / <kbd>↓</kbd></span><span>다음 섹션</span></li>
      <li><span><kbd>k</kbd> / <kbd>↑</kbd></span><span>이전 섹션</span></li>
      <li><span><kbd>/</kbd></span><span>검색</span></li>
      <li><span><kbd>g</kbd></span><span>맨 위로</span></li>
      <li><span><kbd>t</kbd></span><span>테마 전환</span></li>
      <li><span><kbd>Esc</kbd></span><span>닫기</span></li>
      <li><span><kbd>?</kbd></span><span>이 도움말</span></li>
    </ul>
    <button onclick="document.getElementById('helpModal').classList.remove('active')">닫기 (Esc)</button>
  </div>

  <footer style="text-align:center;padding:40px 20px;color:var(--secondary-color);font-size:12px;border-top:1px solid var(--border-color);margin-top:40px;background:var(--section-bg);border-radius:8px 8px 0 0;">
    <p style="margin:0">🛠️ Generated by <a href="https://github.com/user/yt2pdf" style="color:var(--link-color);text-decoration:none;font-weight:500" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">yt2pdf</a></p>
    <p style="margin:5px 0 0 0;font-size:11px">⚖️ 영상 정보 및 자막의 저작권은 원 제작자에게 있습니다</p>
  </footer>

  <!-- 맨 위로 버튼 -->
  <button class="back-to-top" onclick="window.scrollTo({top:0,behavior:'smooth'})" title="맨 위로 (g 키)" aria-label="맨 위로 이동">↑</button>
  <!-- 도움말 버튼 -->
  <button class="help-btn" onclick="document.getElementById('helpModal').classList.add('active')" title="단축키 도움말 (? 키)" aria-label="단축키 도움말 열기" style="position:fixed;bottom:30px;right:80px;width:44px;height:44px;background:var(--secondary-color);color:white;border:none;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 15px rgba(0,0,0,0.25);transition:transform 0.2s;">?</button>
  <!-- 다크 모드 토글 -->
  <button id="themeToggle" title="테마 전환" style="position:fixed;bottom:30px;right:130px;width:40px;height:40px;background:var(--border-color);color:var(--text-color);border:none;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.2);transition:transform 0.2s,background 0.2s;">🌓</button>
  <script>
    // 맨 위로 버튼 + 진행 표시줄
    const btn = document.querySelector('.back-to-top');
    const progressBar = document.getElementById('progressBar');
    window.addEventListener('scroll', () => {
      const show = window.scrollY > 300;
      btn.style.display = show ? 'flex' : 'none';
      btn.style.opacity = show ? '1' : '0';
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
      progressBar.style.width = progress + '%';
    });

    // 자막 검색 기능
    const searchInput = document.getElementById('searchInput');
    const searchCount = document.getElementById('searchCount');
    const sections = document.querySelectorAll('.section');

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      let matchCount = 0;

      sections.forEach(section => {
        const subtitle = section.querySelector('.subtitle');
        const originalTexts = subtitle.querySelectorAll('p');
        let hasMatch = false;

        originalTexts.forEach(p => {
          const text = p.textContent || '';
          if (!query) {
            p.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          } else if (text.toLowerCase().includes(query)) {
            hasMatch = true;
            matchCount++;
            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const regex = new RegExp('(' + query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
            p.innerHTML = escaped.replace(regex, '<span class="highlight">$1</span>');
          } else {
            p.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
        });

        section.classList.toggle('hidden', query && !hasMatch);
      });

      searchCount.textContent = query ? (matchCount > 0 ? matchCount + '개 섹션에서 발견' : '결과 없음') : '';
    });

    // Enter 키로 다음 검색 결과로 이동
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const visible = visibleSections();
        if (visible.length > 0) {
          currentIdx = (currentIdx + 1) % visible.length;
          visible[currentIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          updateActiveSection();
        }
      }
    });

    // 검색 클리어 버튼
    const clearBtn = document.getElementById('clearSearch');
    searchInput.addEventListener('input', () => {
      clearBtn.style.display = searchInput.value ? 'block' : 'none';
    });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      clearBtn.style.display = 'none';
      searchInput.focus();
    });

    // 키보드 네비게이션 (j/k)
    let currentIdx = -1;
    const visibleSections = () => Array.from(sections).filter(s => !s.classList.contains('hidden'));
    document.addEventListener('keydown', (e) => {
      if (e.target === searchInput) return;
      const visible = visibleSections();
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        currentIdx = Math.min(currentIdx + 1, visible.length - 1);
        visible[currentIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateActiveSection();
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        currentIdx = Math.max(currentIdx - 1, 0);
        visible[currentIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateActiveSection();
      }
    });

    function updateActiveSection() {
      const visible = visibleSections();
      visible.forEach((s, i) => s.classList.toggle('active', i === currentIdx));
    }

    // 복사 버튼
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const subtitle = btn.closest('.section').querySelector('.subtitle');
        const text = Array.from(subtitle.querySelectorAll('p')).map(p => p.textContent).join('\\n');
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = '✓';
          btn.style.color = '#22c55e';
          setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1500);
        } catch {
          btn.textContent = '✗';
          btn.style.color = '#ef4444';
          setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1500);
        }
      });
    });

    // 스크롤 위치 기억
    const storageKey = 'yt2pdf_scroll_' + '${metadata.id}';
    window.addEventListener('scroll', () => {
      localStorage.setItem(storageKey, window.scrollY.toString());
    });
    const savedScroll = localStorage.getItem(storageKey);
    if (savedScroll) {
      setTimeout(() => window.scrollTo(0, parseInt(savedScroll)), 100);
    }

    // 목차 접기 (상태 저장)
    const tocKey = 'yt2pdf_toc_collapsed';
    const toc = document.querySelector('.toc');
    if (localStorage.getItem(tocKey) === 'true') toc.classList.add('collapsed');
    document.querySelector('.toc h2')?.addEventListener('click', () => {
      toc.classList.toggle('collapsed');
      localStorage.setItem(tocKey, toc.classList.contains('collapsed'));
    });

    // 이미지 확대
    const overlay = document.getElementById('overlay');
    document.querySelectorAll('.screenshot').forEach(img => {
      img.addEventListener('click', () => {
        img.classList.toggle('zoomed');
        overlay.classList.toggle('active');
      });
    });
    overlay.addEventListener('click', closeZoom);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeZoom(); document.getElementById('helpModal').classList.remove('active'); }
      if (e.key === '?' && e.target !== searchInput) document.getElementById('helpModal').classList.toggle('active');
      if (e.key === '/' && e.target !== searchInput) { e.preventDefault(); searchInput.focus(); }
      if (e.key === 'g' && e.target !== searchInput) { window.scrollTo({top:0,behavior:'smooth'}); }
      if (e.key === 't' && e.target !== searchInput) { document.getElementById('themeToggle').click(); }
    });
    function closeZoom() {
      document.querySelector('.screenshot.zoomed')?.classList.remove('zoomed');
      overlay.classList.remove('active');
    }

    // 스크롤 스파이 (목차 하이라이트)
    const tocLinks = document.querySelectorAll('.toc-list a');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach(link => {
            link.classList.toggle('current', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { threshold: 0.3 });
    sections.forEach(s => observer.observe(s));

    // 전체 자막 복사
    const copyAllBtn = document.getElementById('copyAllBtn');
    copyAllBtn.addEventListener('click', async () => {
      const allText = Array.from(document.querySelectorAll('.subtitle'))
        .map(s => Array.from(s.querySelectorAll('p')).map(p => p.textContent).join('\\n'))
        .join('\\n\\n');
      try {
        await navigator.clipboard.writeText(allText);
        copyAllBtn.textContent = '✓ 복사됨!';
        copyAllBtn.style.background = '#22c55e';
        setTimeout(() => { copyAllBtn.textContent = '전체 자막 복사'; copyAllBtn.style.background = ''; }, 1500);
      } catch {
        copyAllBtn.textContent = '✗ 실패';
        copyAllBtn.style.background = '#ef4444';
        setTimeout(() => { copyAllBtn.textContent = '전체 자막 복사'; copyAllBtn.style.background = ''; }, 1500);
      }
    });

    // 읽기 시간 계산
    const allSubtitleText = Array.from(document.querySelectorAll('.subtitle p')).map(p => p.textContent).join(' ');
    const wordCount = allSubtitleText.split(/\\s+/).filter(w => w.length > 0).length;
    const readMinutes = Math.ceil(wordCount / 200); // 분당 200단어 가정
    document.getElementById('readTime').textContent = readMinutes <= 1 ? '1분 미만' : \`약 \${readMinutes}분 (\${wordCount.toLocaleString()}단어)\`;

    // 다크 모드 토글
    const themeToggle = document.getElementById('themeToggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('yt2pdf_theme');
    if (savedTheme) {
      root.setAttribute('data-theme', savedTheme);
      themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
    themeToggle.addEventListener('click', () => {
      const current = root.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('yt2pdf_theme', next);
      themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  </script>
</body>
</html>`;

    await fs.promises.writeFile(outputPath, html, 'utf-8');
    logger.success(`HTML 생성 완료: ${outputPath}`);
  }

  /**
   * Executive Brief PDF 생성 (한 페이지 요약)
   */
  async generateBriefPDF(brief: ExecutiveBrief, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Executive Brief PDF 생성 시작...');

        const doc = new PDFDocument({
          size: 'A4',
          margins: this.theme.margins,
          info: {
            Title: `Executive Brief: ${brief.title}`,
            Author: brief.metadata.channel,
            Subject: `YouTube: ${brief.metadata.videoId}`,
            Creator: 'yt2pdf',
            Producer: 'yt2pdf - YouTube to PDF Converter',
          },
        });

        // Register Korean fonts
        if (validateKoreanFont()) {
          doc.registerFont('NotoSansKR-Regular', KOREAN_FONT_REGULAR);
          doc.registerFont('NotoSansKR-Bold', KOREAN_FONT_BOLD);
        } else {
          this.theme.fonts.title.name = 'Helvetica-Bold';
          this.theme.fonts.heading.name = 'Helvetica-Bold';
          this.theme.fonts.body.name = 'Helvetica';
          this.theme.fonts.timestamp.name = 'Helvetica';
        }

        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);

        const { theme } = this;
        const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

        // 제목 섹션 - NFC 정규화 적용
        doc
          .font(theme.fonts.title.name)
          .fontSize(20)
          .fillColor(theme.colors.text)
          .text(normalizeTextForPDF(`📹 ${brief.title}`), { width: pageWidth, align: 'left' });

        doc.moveDown(0.3);

        // 메타 정보
        const videoTypeLabels: Record<string, string> = {
          conference_talk: '컨퍼런스 발표',
          tutorial: '튜토리얼',
          interview: '인터뷰',
          lecture: '강의',
          demo: '제품 데모',
          discussion: '토론/패널',
          unknown: '기타',
        };

        doc
          .font(theme.fonts.body.name)
          .fontSize(10)
          .fillColor(theme.colors.secondary)
          .text(
            normalizeTextForPDF(`채널: ${brief.metadata.channel} | 길이: ${formatTimestamp(brief.metadata.duration)} | 유형: ${videoTypeLabels[brief.metadata.videoType] || brief.metadata.videoType}`),
            { width: pageWidth }
          );

        doc.moveDown(1);

        // 구분선
        doc.strokeColor(theme.colors.secondary).lineWidth(0.5)
          .moveTo(theme.margins.left, doc.y)
          .lineTo(doc.page.width - theme.margins.right, doc.y)
          .stroke();

        doc.moveDown(0.8);

        // 핵심 요약 - NFC 정규화 적용
        doc
          .font(theme.fonts.heading.name)
          .fontSize(12)
          .fillColor(theme.colors.text)
          .text('📝 핵심 요약');

        doc.moveDown(0.3);

        doc
          .font(theme.fonts.body.name)
          .fontSize(10)
          .fillColor(theme.colors.text)
          .text(normalizeTextForPDF(brief.summary), { width: pageWidth, lineGap: 2 });

        doc.moveDown(0.8);

        // 구분선
        doc.strokeColor(theme.colors.secondary).lineWidth(0.5)
          .moveTo(theme.margins.left, doc.y)
          .lineTo(doc.page.width - theme.margins.right, doc.y)
          .stroke();

        doc.moveDown(0.8);

        // Key Takeaways - NFC 정규화 적용
        if (brief.keyTakeaways.length > 0) {
          doc
            .font(theme.fonts.heading.name)
            .fontSize(12)
            .fillColor(theme.colors.text)
            .text('💡 Key Takeaways');

          doc.moveDown(0.3);

          doc.font(theme.fonts.body.name).fontSize(10).fillColor(theme.colors.text);
          for (const point of brief.keyTakeaways) {
            doc.text(normalizeTextForPDF(`• ${point}`), { width: pageWidth - 15, indent: 10, lineGap: 2 });
          }

          doc.moveDown(0.8);

          // 구분선
          doc.strokeColor(theme.colors.secondary).lineWidth(0.5)
            .moveTo(theme.margins.left, doc.y)
            .lineTo(doc.page.width - theme.margins.right, doc.y)
            .stroke();

          doc.moveDown(0.8);
        }

        // 챕터별 요약 - NFC 정규화 적용
        if (brief.chapterSummaries.length > 0) {
          doc
            .font(theme.fonts.heading.name)
            .fontSize(12)
            .fillColor(theme.colors.text)
            .text('📑 챕터별 요약');

          doc.moveDown(0.3);

          for (const chapter of brief.chapterSummaries) {
            const ts = formatTimestamp(chapter.startTime);
            doc
              .font(theme.fonts.timestamp.name)
              .fontSize(9)
              .fillColor(theme.colors.link)
              .text(`[${ts}] `, { continued: true });

            doc
              .font(theme.fonts.body.name)
              .fontSize(10)
              .fillColor(theme.colors.text)
              .text(normalizeTextForPDF(chapter.title), { continued: chapter.summary ? true : false });

            if (chapter.summary) {
              doc
                .fillColor(theme.colors.secondary)
                .text(normalizeTextForPDF(` - ${chapter.summary}`));
            }
          }

          doc.moveDown(0.8);
        }

        // Action Items (있는 경우) - NFC 정규화 적용
        if (brief.actionItems && brief.actionItems.length > 0) {
          // 구분선
          doc.strokeColor(theme.colors.secondary).lineWidth(0.5)
            .moveTo(theme.margins.left, doc.y)
            .lineTo(doc.page.width - theme.margins.right, doc.y)
            .stroke();

          doc.moveDown(0.8);

          doc
            .font(theme.fonts.heading.name)
            .fontSize(12)
            .fillColor(theme.colors.text)
            .text('🎯 Action Items');

          doc.moveDown(0.3);

          doc.font(theme.fonts.body.name).fontSize(10).fillColor(theme.colors.text);
          for (const item of brief.actionItems) {
            doc.text(normalizeTextForPDF(`□ ${item}`), { width: pageWidth - 15, indent: 10, lineGap: 2 });
          }
        }

        // 푸터
        doc.moveDown(2);
        doc
          .fontSize(8)
          .fillColor(theme.colors.secondary)
          .text(`원본: https://youtube.com/watch?v=${brief.metadata.videoId}`, { align: 'center', link: `https://youtube.com/watch?v=${brief.metadata.videoId}` });

        doc.moveDown(0.3);
        doc
          .fontSize(7)
          .fillColor('#9ca3af')
          .text('Generated by yt2pdf | 영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.', { align: 'center' });

        doc.end();

        writeStream.on('finish', () => {
          logger.success(`Executive Brief PDF 생성 완료: ${outputPath}`);
          resolve();
        });

        writeStream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Executive Brief Markdown 생성
   */
  async generateBriefMarkdown(brief: ExecutiveBrief, outputPath: string): Promise<void> {
    const videoTypeLabels: Record<string, string> = {
      conference_talk: '컨퍼런스 발표',
      tutorial: '튜토리얼',
      interview: '인터뷰',
      lecture: '강의',
      demo: '제품 데모',
      discussion: '토론/패널',
      unknown: '기타',
    };

    let md = `# 📹 ${brief.title}\n\n`;
    md += `> **채널:** ${brief.metadata.channel} | **길이:** ${formatTimestamp(brief.metadata.duration)} | **유형:** ${videoTypeLabels[brief.metadata.videoType] || brief.metadata.videoType}\n\n`;
    md += `---\n\n`;

    // 핵심 요약
    md += `## 📝 핵심 요약\n\n`;
    md += `${brief.summary}\n\n`;

    // Key Takeaways
    if (brief.keyTakeaways.length > 0) {
      md += `## 💡 Key Takeaways\n\n`;
      for (const point of brief.keyTakeaways) {
        md += `- ${point}\n`;
      }
      md += `\n`;
    }

    // 챕터별 요약
    if (brief.chapterSummaries.length > 0) {
      md += `## 📑 챕터별 요약\n\n`;
      md += `| 시간 | 챕터 | 요약 |\n`;
      md += `|------|------|------|\n`;
      for (const chapter of brief.chapterSummaries) {
        const ts = formatTimestamp(chapter.startTime);
        const link = buildTimestampUrl(brief.metadata.videoId, chapter.startTime);
        md += `| [${ts}](${link}) | ${chapter.title} | ${chapter.summary} |\n`;
      }
      md += `\n`;
    }

    // Action Items
    if (brief.actionItems && brief.actionItems.length > 0) {
      md += `## 🎯 Action Items\n\n`;
      for (const item of brief.actionItems) {
        md += `- [ ] ${item}\n`;
      }
      md += `\n`;
    }

    // 푸터
    md += `---\n\n`;
    md += `📎 **원본:** [YouTube에서 보기](https://youtube.com/watch?v=${brief.metadata.videoId})\n\n`;
    md += `*Generated by [yt2pdf](https://github.com/user/yt2pdf) | 영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.*\n`;

    await fs.promises.writeFile(outputPath, md, 'utf-8');
    logger.success(`Executive Brief Markdown 생성 완료: ${outputPath}`);
  }

  /**
   * Executive Brief HTML 생성
   */
  async generateBriefHTML(brief: ExecutiveBrief, outputPath: string): Promise<void> {
    const videoTypeLabels: Record<string, string> = {
      conference_talk: '컨퍼런스 발표',
      tutorial: '튜토리얼',
      interview: '인터뷰',
      lecture: '강의',
      demo: '제품 데모',
      discussion: '토론/패널',
      unknown: '기타',
    };

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Executive Brief: ${brief.title}</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1f2937;
      --secondary: #6b7280;
      --border: #e5e7eb;
      --link: #2563eb;
      --card-bg: #f9fafb;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --text: #f3f4f6;
        --secondary: #9ca3af;
        --border: #374151;
        --link: #60a5fa;
        --card-bg: #1f2937;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 { font-size: 1.5em; margin-bottom: 10px; line-height: 1.3; }
    h2 { font-size: 1.1em; margin: 25px 0 10px; color: var(--text); }
    .meta { color: var(--secondary); font-size: 0.9em; margin-bottom: 20px; }
    .meta a { color: var(--link); text-decoration: none; }
    .meta a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin: 15px 0;
    }
    .summary-text { font-size: 1em; line-height: 1.8; }
    ul { padding-left: 20px; }
    li { margin: 8px 0; }
    .chapter-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    .chapter-table th, .chapter-table td { padding: 10px; text-align: left; border-bottom: 1px solid var(--border); }
    .chapter-table th { background: var(--card-bg); font-weight: 600; }
    .chapter-table td a { color: var(--link); text-decoration: none; font-family: monospace; }
    .chapter-table td a:hover { text-decoration: underline; }
    .action-item { display: flex; align-items: flex-start; gap: 10px; margin: 8px 0; }
    .action-item input { margin-top: 4px; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--secondary); font-size: 0.8em; }
    .footer a { color: var(--link); text-decoration: none; }
    @media print {
      body { max-width: 100%; padding: 20px; }
      .card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>📹 ${brief.title}</h1>
    <p class="meta">
      <strong>채널:</strong> <a href="https://youtube.com/@${encodeURIComponent(brief.metadata.channel)}" target="_blank">${brief.metadata.channel}</a> |
      <strong>길이:</strong> ${formatTimestamp(brief.metadata.duration)} |
      <strong>유형:</strong> ${videoTypeLabels[brief.metadata.videoType] || brief.metadata.videoType}
    </p>
  </header>

  <hr>

  <section class="card">
    <h2>📝 핵심 요약</h2>
    <p class="summary-text">${brief.summary}</p>
  </section>

${brief.keyTakeaways.length > 0 ? `
  <section>
    <h2>💡 Key Takeaways</h2>
    <ul>
${brief.keyTakeaways.map(point => `      <li>${point}</li>`).join('\n')}
    </ul>
  </section>
` : ''}

${brief.chapterSummaries.length > 0 ? `
  <section>
    <h2>📑 챕터별 요약</h2>
    <table class="chapter-table">
      <thead>
        <tr><th>시간</th><th>챕터</th><th>요약</th></tr>
      </thead>
      <tbody>
${brief.chapterSummaries.map(ch => `        <tr>
          <td><a href="${buildTimestampUrl(brief.metadata.videoId, ch.startTime)}" target="_blank">${formatTimestamp(ch.startTime)}</a></td>
          <td>${ch.title}</td>
          <td>${ch.summary}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </section>
` : ''}

${brief.actionItems && brief.actionItems.length > 0 ? `
  <section class="card">
    <h2>🎯 Action Items</h2>
${brief.actionItems.map(item => `    <div class="action-item"><input type="checkbox"><span>${item}</span></div>`).join('\n')}
  </section>
` : ''}

  <footer class="footer">
    <p>📎 <a href="https://youtube.com/watch?v=${brief.metadata.videoId}" target="_blank">YouTube에서 보기</a></p>
    <p>Generated by <a href="https://github.com/user/yt2pdf">yt2pdf</a> | 영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.</p>
  </footer>
</body>
</html>`;

    await fs.promises.writeFile(outputPath, html, 'utf-8');
    logger.success(`Executive Brief HTML 생성 완료: ${outputPath}`);
  }

  /**
   * 표지 렌더링 (동기)
   */
  private renderCoverPageSync(
    doc: PDFKit.PDFDocument,
    metadata: VideoMetadata,
    thumbnailBuffer?: Buffer | null,
    sectionCount?: number,
    summary?: ContentSummary
  ): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // 제목 (NFC 정규화 적용)
    doc
      .font(theme.fonts.title.name)
      .fontSize(theme.fonts.title.size)
      .fillColor(theme.colors.text)
      .text(normalizeTextForPDF(metadata.title), { width: pageWidth, align: 'center' });

    doc.moveDown(1);

    // 썸네일 이미지 (있는 경우)
    if (thumbnailBuffer) {
      try {
        const thumbnailWidth = Math.min(400, pageWidth);
        const centerX = (doc.page.width - thumbnailWidth) / 2;
        doc.image(thumbnailBuffer, centerX, doc.y, {
          fit: [thumbnailWidth, 225], // 16:9 비율
          align: 'center',
        });
        doc.y += 225 + 10; // 이미지 높이만큼 이동
      } catch {
        logger.debug('썸네일 렌더링 실패');
      }
    }

    doc.moveDown(1);

    // 메타 정보 (NFC 정규화 적용)
    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.secondary);

    doc.text(normalizeTextForPDF(`채널: ${metadata.channel}`), { align: 'center' });
    doc.text(`영상 길이: ${formatTimestamp(metadata.duration)}`, { align: 'center' });
    if (sectionCount) {
      doc.text(`섹션: ${sectionCount}개`, { align: 'center' });
    }

    // 원본 링크 (클릭 가능)
    const youtubeUrl = `https://youtube.com/watch?v=${metadata.id}`;
    doc.fillColor(theme.colors.link);
    doc.text('원본: ', { continued: true, align: 'center' });
    doc.text(youtubeUrl, { link: youtubeUrl, align: 'center' });

    doc.fillColor(theme.colors.secondary);
    doc.text(`생성일: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });

    // 요약 (있는 경우) - NFC 정규화 적용
    if (summary && summary.summary) {
      doc.moveDown(1.5);

      // 요약 제목
      doc
        .font(theme.fonts.heading.name)
        .fontSize(theme.fonts.heading.size)
        .fillColor(theme.colors.text)
        .text('📝 요약', { align: 'left' });

      doc.moveDown(0.5);

      // 요약 본문 (NFC 정규화 적용 - AI 응답 깨짐 방지)
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.text)
        .text(normalizeTextForPDF(summary.summary), { align: 'left', width: pageWidth });

      // 핵심 포인트 (있는 경우)
      if (summary.keyPoints && summary.keyPoints.length > 0) {
        doc.moveDown(1);

        doc
          .font(theme.fonts.heading.name)
          .fontSize(12)
          .fillColor(theme.colors.text)
          .text('💡 핵심 포인트', { align: 'left' });

        doc.moveDown(0.3);

        doc
          .font(theme.fonts.body.name)
          .fontSize(theme.fonts.body.size)
          .fillColor(theme.colors.text);

        for (const point of summary.keyPoints) {
          doc.text(normalizeTextForPDF(`• ${point}`), { indent: 10, width: pageWidth - 10 });
        }
      }
    }

    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor('#9ca3af')
      .text('Generated by yt2pdf', { align: 'center' });

    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .text('영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.', { align: 'center' });
  }

  /**
   * 목차 렌더링
   */
  private renderTableOfContents(
    doc: PDFKit.PDFDocument,
    sections: PDFSection[],
    _videoId: string
  ): void {
    doc.addPage();

    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    doc
      .font(theme.fonts.heading.name)
      .fontSize(theme.fonts.heading.size)
      .fillColor(theme.colors.text)
      .text('목차', { align: 'center' });

    doc.moveDown();

    doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size);

    // 목차는 2페이지, 본문은 3페이지부터 시작
    const startPage = 3;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const timestamp = formatTimestamp(section.timestamp);
      const rawPreview = section.subtitles[0]?.text || '';
      const preview = normalizeTextForPDF(cleanSubtitleText(rawPreview)).substring(0, 50);
      const pageNum = startPage + i;

      // 타임스탬프 (파란색)
      doc.fillColor(theme.colors.link).text(`${timestamp}`, { continued: true });

      // 제목 미리보기 (검정색) - NFC 정규화 적용
      const previewText = preview ? `  ${preview}...` : '';
      doc.fillColor(theme.colors.text).text(previewText, { continued: true });

      // 점선 + 페이지 번호 (오른쪽 정렬)
      const textWidth = doc.widthOfString(`${timestamp}${previewText}`);
      const pageNumWidth = doc.widthOfString(`${pageNum}`);
      const dotsWidth = pageWidth - textWidth - pageNumWidth - 10;
      const dotsCount = Math.max(0, Math.floor(dotsWidth / doc.widthOfString('.')));
      const dots = '.'.repeat(dotsCount);

      doc.fillColor(theme.colors.secondary).text(`${dots}${pageNum}`);
    }
  }

  /**
   * Vertical 레이아웃 섹션 렌더링
   */
  private renderVerticalSection(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    videoId: string
  ): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // 챕터 제목 (있는 경우) - NFC 정규화 적용
    if (section.chapterTitle) {
      doc
        .font(theme.fonts.heading.name)
        .fontSize(14)
        .fillColor(theme.colors.text)
        .text(normalizeTextForPDF(`📑 ${section.chapterTitle}`), { width: pageWidth });
      doc.moveDown(0.5);
    }

    // 스크린샷
    try {
      doc.image(section.screenshot.imagePath, {
        fit: [pageWidth, 280],
        align: 'center',
      });
    } catch {
      doc.text('[이미지 로드 실패]');
    }

    doc.moveDown();

    // 타임스탬프
    const timestamp = formatTimestamp(section.timestamp);
    if (this.config.timestampLinks) {
      const url = buildTimestampUrl(videoId, section.timestamp);
      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(theme.fonts.timestamp.size)
        .fillColor(theme.colors.link)
        .text(timestamp, { link: url });
    } else {
      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(theme.fonts.timestamp.size)
        .fillColor(theme.colors.secondary)
        .text(timestamp);
    }

    doc.moveDown(0.3);

    // 남은 페이지 공간 확인 - 최소 100px 이상 있어야 자막 렌더링
    const remainingSpace = doc.page.height - doc.y - theme.margins.bottom - 40; // 40px for footer
    if (remainingSpace < 100) {
      doc.addPage();
    }

    // 섹션 요약 (있는 경우) - NFC 정규화 적용
    if (section.sectionSummary && section.sectionSummary.summary) {
      doc
        .font(theme.fonts.body.name)
        .fontSize(10)
        .fillColor(theme.colors.primary)
        .text(normalizeTextForPDF(`💡 ${section.sectionSummary.summary}`), { width: pageWidth });

      if (section.sectionSummary.keyPoints && section.sectionSummary.keyPoints.length > 0) {
        doc.moveDown(0.2);
        doc.fillColor(theme.colors.secondary).fontSize(9);
        for (const point of section.sectionSummary.keyPoints) {
          doc.text(normalizeTextForPDF(`  • ${point}`), { width: pageWidth });
        }
      }
      doc.moveDown(0.5);
    }

    // 자막 - 정리, 혼합 언어 정리, 중복 제거, NFC 정규화
    const subtitleTexts = section.subtitles.map((sub) => {
      const cleaned = cleanSubtitleText(sub.text);
      return normalizeTextForPDF(cleanMixedLanguageText(cleaned, 'ko'));
    });
    const dedupedTexts = deduplicateSubtitles(subtitleTexts);

    // 자막이 없는 경우 안내 메시지
    if (dedupedTexts.length === 0) {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.secondary)
        .text('(이 구간에 자막이 없습니다)', { align: 'center' });
    } else {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.text);

      // 남은 공간 계산 - 오버플로우 방지
      const maxY = doc.page.height - theme.margins.bottom - 50; // 50px for footer

      for (const text of dedupedTexts) {
        // 남은 공간이 부족하면 중단 (오버플로우 방지)
        if (doc.y >= maxY) {
          doc
            .fontSize(9)
            .fillColor(theme.colors.secondary)
            .text('(자막 계속...)', { align: 'right' });
          break;
        }
        doc.text(text, { width: pageWidth });
      }
    }
  }

  /**
   * Horizontal 레이아웃 섹션 렌더링
   */
  private renderHorizontalSection(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    videoId: string
  ): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;
    const halfWidth = pageWidth / 2 - 10;

    const startY = doc.y;

    // 왼쪽: 스크린샷
    try {
      doc.image(section.screenshot.imagePath, theme.margins.left, startY, {
        fit: [halfWidth, 400],
      });
    } catch {
      doc.text('[이미지 로드 실패]', theme.margins.left, startY);
    }

    // 오른쪽: 타임스탬프 + 자막
    const rightX = theme.margins.left + halfWidth + 20;

    // 타임스탬프
    const timestamp = formatTimestamp(section.timestamp);
    doc
      .font(theme.fonts.timestamp.name)
      .fontSize(theme.fonts.timestamp.size)
      .fillColor(this.config.timestampLinks ? theme.colors.link : theme.colors.secondary);

    if (this.config.timestampLinks) {
      const url = buildTimestampUrl(videoId, section.timestamp);
      doc.text(timestamp, rightX, startY, { link: url, width: halfWidth });
    } else {
      doc.text(timestamp, rightX, startY, { width: halfWidth });
    }

    doc.moveDown(0.5);

    // 남은 페이지 공간 확인 - 최소 100px 이상 있어야 자막 렌더링
    const remainingSpace = doc.page.height - doc.y - theme.margins.bottom - 40; // 40px for footer
    if (remainingSpace < 100) {
      doc.addPage();
      doc.x = rightX; // Restore x position after new page
    }

    // 자막 - 정리, 혼합 언어 정리, 중복 제거, NFC 정규화
    const subtitleTexts = section.subtitles.map((sub) => {
      const cleaned = cleanSubtitleText(sub.text);
      return normalizeTextForPDF(cleanMixedLanguageText(cleaned, 'ko'));
    });
    const dedupedTexts = deduplicateSubtitles(subtitleTexts);

    if (dedupedTexts.length === 0) {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.secondary)
        .text('(이 구간에 자막이 없습니다)', rightX, doc.y, { width: halfWidth });
    } else {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.text);

      // 남은 공간 계산 - 오버플로우 방지
      const maxY = doc.page.height - theme.margins.bottom - 50; // 50px for footer

      for (const text of dedupedTexts) {
        // 남은 공간이 부족하면 중단 (오버플로우 방지)
        if (doc.y >= maxY) {
          doc
            .fontSize(9)
            .fillColor(theme.colors.secondary)
            .text('(자막 계속...)', rightX, doc.y, { width: halfWidth, align: 'right' });
          break;
        }
        doc.text(text, rightX, doc.y, { width: halfWidth });
      }
    }
  }

  /**
   * 테마 로드
   */
  private loadTheme(_themeName: string): Theme {
    // 현재는 기본 테마만 지원
    // 향후 테마 파일 로드 로직 추가
    return DEFAULT_THEME;
  }

  /**
   * 자막 언어 감지
   */
  private detectLanguage(sections: PDFSection[]): string {
    const text = sections
      .flatMap((s) => s.subtitles.map((sub) => sub.text))
      .join(' ')
      .slice(0, 500);

    // 한글 포함 여부 확인
    const koreanRegex = /[\uAC00-\uD7AF]/;
    if (koreanRegex.test(text)) return 'ko';

    // 일본어 확인
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
    if (japaneseRegex.test(text)) return 'ja';

    // 중국어 확인
    const chineseRegex = /[\u4E00-\u9FFF]/;
    if (chineseRegex.test(text)) return 'zh';

    // 아랍어 확인
    const arabicRegex = /[\u0600-\u06FF]/;
    if (arabicRegex.test(text)) return 'ar';

    // 러시아어 (키릴 문자)
    const cyrillicRegex = /[\u0400-\u04FF]/;
    if (cyrillicRegex.test(text)) return 'ru';

    // 태국어
    const thaiRegex = /[\u0E00-\u0E7F]/;
    if (thaiRegex.test(text)) return 'th';

    return 'en';
  }

  /**
   * PDF 후처리 - 빈 페이지 제거
   * 콘텐츠 스트림 크기가 200바이트 미만인 페이지를 제거
   */
  private async removeEmptyPages(pdfPath: string): Promise<void> {
    const existingPdfBytes = await fs.promises.readFile(pdfPath);
    const pdfDoc = await PDFLibDocument.load(existingPdfBytes);

    const pages = pdfDoc.getPages();
    const pagesToRemove: number[] = [];

    for (let i = 0; i < pages.length; i++) {
      // 첫 2페이지 (표지 + 목차) 스킵
      if (i < 2) continue;

      const page = pages[i];
      const node = page.node;

      // 콘텐츠 스트림 참조 가져오기
      const contentsRef = node.get(PDFName.of('Contents'));
      let contentSize = 0;

      if (contentsRef) {
        // 실제 콘텐츠 스트림 크기 확인
        const resolved = node.context.lookup(contentsRef);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resolvedAny = resolved as any;
        if (resolvedAny && resolvedAny.contents) {
          contentSize = resolvedAny.contents.length;
        }
      }

      // 300바이트 미만의 페이지는 빈 페이지로 간주 (오버플로우 페이지 포함)
      if (contentSize < 300) {
        pagesToRemove.push(i);
      }
    }

    // 역순으로 제거하여 인덱스 유지
    for (let i = pagesToRemove.length - 1; i >= 0; i--) {
      pdfDoc.removePage(pagesToRemove[i]);
    }

    if (pagesToRemove.length > 0) {
      const pdfBytes = await pdfDoc.save();
      await fs.promises.writeFile(pdfPath, pdfBytes);
      logger.debug(`빈 페이지 ${pagesToRemove.length}개 제거됨`);
    }
  }

  /**
   * 사용 가능한 테마 목록
   */
  static getAvailableThemes(): string[] {
    return ['default', 'note', 'minimal'];
  }
}
