/**
 * PDF 생성기
 */

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { PDFContent, PDFSection, VideoMetadata } from '../types/index.js';
import { PDFConfig } from '../types/config.js';
import { formatTimestamp, buildTimestampUrl } from '../utils/index.js';
import { logger } from '../utils/logger.js';

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

const DEFAULT_THEME: Theme = {
  name: 'default',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  fonts: {
    title: { name: 'Helvetica-Bold', size: 24 },
    heading: { name: 'Helvetica-Bold', size: 14 },
    body: { name: 'Helvetica', size: 11 },
    timestamp: { name: 'Helvetica', size: 10 },
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
          },
        });

        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);

        // 표지
        this.renderCoverPage(doc, content.metadata);

        // 목차 (옵션)
        if (this.config.includeToc) {
          this.renderTableOfContents(doc, content.sections, content.metadata.id);
        }

        // 본문
        for (let i = 0; i < content.sections.length; i++) {
          const section = content.sections[i];

          if (i > 0 || this.config.includeToc) {
            doc.addPage();
          }

          if (this.config.layout === 'vertical') {
            this.renderVerticalSection(doc, section, content.metadata.id);
          } else {
            this.renderHorizontalSection(doc, section, content.metadata.id);
          }
        }

        doc.end();

        writeStream.on('finish', () => {
          logger.success(`PDF 생성 완료: ${outputPath}`);
          resolve();
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
    md += `> **채널**: ${content.metadata.channel}  \n`;
    md += `> **원본**: https://youtube.com/watch?v=${content.metadata.id}  \n`;
    md += `> **생성일**: ${new Date().toISOString().split('T')[0]}\n\n`;
    md += `---\n\n`;

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
      md += `![Screenshot](./images/${imgName})\n\n`;

      // 자막
      for (const sub of section.subtitles) {
        md += `${sub.text}\n\n`;
      }

      md += `---\n\n`;
    }

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
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { color: #1f2937; }
    .meta { color: #6b7280; margin-bottom: 20px; }
    .section { margin: 30px 0; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .timestamp { font-size: 14px; color: #2563eb; text-decoration: none; font-weight: bold; }
    .timestamp:hover { text-decoration: underline; }
    .screenshot { max-width: 100%; border-radius: 4px; margin: 10px 0; }
    .subtitle { color: #374151; margin: 10px 0; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>${metadata.title}</h1>
  <div class="meta">
    <p><strong>채널:</strong> ${metadata.channel}</p>
    <p><strong>원본:</strong> <a href="https://youtube.com/watch?v=${metadata.id}">YouTube에서 보기</a></p>
    <p><strong>생성일:</strong> ${new Date().toISOString().split('T')[0]}</p>
  </div>
  <hr>
`;

    for (const section of sections) {
      const ts = timestamp(section.timestamp);
      const link = buildTimestampUrl(metadata.id, section.timestamp);
      const imgName = path.basename(section.screenshot.imagePath);

      html += `
  <div class="section">
    <a class="timestamp" href="${link}" target="_blank">${ts}</a>
    <img class="screenshot" src="./images/${imgName}" alt="Screenshot at ${ts}">
    <div class="subtitle">
`;

      for (const sub of section.subtitles) {
        html += `      <p>${sub.text}</p>\n`;
      }

      html += `    </div>
  </div>
`;
    }

    html += `
</body>
</html>`;

    await fs.promises.writeFile(outputPath, html, 'utf-8');
    logger.success(`HTML 생성 완료: ${outputPath}`);
  }

  /**
   * 표지 렌더링
   */
  private renderCoverPage(doc: PDFKit.PDFDocument, metadata: VideoMetadata): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // 제목
    doc
      .font(theme.fonts.title.name)
      .fontSize(theme.fonts.title.size)
      .fillColor(theme.colors.text)
      .text(metadata.title, { width: pageWidth, align: 'center' });

    doc.moveDown(2);

    // 메타 정보
    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.secondary);

    doc.text(`채널: ${metadata.channel}`, { align: 'center' });
    doc.text(`원본: https://youtube.com/watch?v=${metadata.id}`, { align: 'center' });
    doc.text(`생성일: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
  }

  /**
   * 목차 렌더링
   */
  private renderTableOfContents(
    doc: PDFKit.PDFDocument,
    sections: PDFSection[],
    videoId: string
  ): void {
    doc.addPage();

    const { theme } = this;

    doc
      .font(theme.fonts.heading.name)
      .fontSize(theme.fonts.heading.size)
      .fillColor(theme.colors.text)
      .text('목차', { align: 'center' });

    doc.moveDown();

    doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size);

    for (const section of sections) {
      const timestamp = formatTimestamp(section.timestamp);
      const preview = section.subtitles[0]?.text.substring(0, 50) || '';

      doc.fillColor(theme.colors.link).text(`${timestamp}`, { continued: true });
      doc.fillColor(theme.colors.text).text(`  ${preview}...`);
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

    // 스크린샷
    try {
      doc.image(section.screenshot.imagePath, {
        fit: [pageWidth, 300],
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

    doc.moveDown(0.5);

    // 자막
    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.text);

    for (const sub of section.subtitles) {
      doc.text(sub.text);
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

    // 자막
    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.text);

    for (const sub of section.subtitles) {
      doc.text(sub.text, rightX, doc.y, { width: halfWidth });
    }
  }

  /**
   * 테마 로드
   */
  private loadTheme(themeName: string): Theme {
    // 현재는 기본 테마만 지원
    // 향후 테마 파일 로드 로직 추가
    return DEFAULT_THEME;
  }

  /**
   * 사용 가능한 테마 목록
   */
  static getAvailableThemes(): string[] {
    return ['default', 'note', 'minimal'];
  }
}
