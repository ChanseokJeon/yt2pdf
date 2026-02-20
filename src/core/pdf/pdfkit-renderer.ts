/**
 * PDFKit Renderer - Handles all PDFKit rendering operations
 */

import { PDFSection, VideoMetadata, ContentSummary, CoverMetadata } from '../../types/index.js';
import { PDFConfig } from '../../types/config.js';
import {
  formatTimestamp,
  buildTimestampUrl,
  cleanSubtitleText,
  deduplicateSubtitles,
  cleanMixedLanguageText,
} from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { normalizeTextForPDF } from '../../utils/text-normalizer.js';
import { Theme, MINIMAL_NEON_COLORS, MINIMAL_NEON_TAG_COLORS } from './themes.js';

/**
 * Video type labels for display
 */
const VIDEO_TYPE_LABELS: Record<string, string> = {
  conference_talk: '컨퍼런스 발표',
  tutorial: '튜토리얼',
  interview: '인터뷰',
  lecture: '강의',
  demo: '제품 데모',
  discussion: '토론/패널',
  unknown: '기타',
};

/**
 * Process subtitles: clean, normalize, and deduplicate
 */
function processSubtitles(subtitles: { text: string }[], forPDF: boolean = true): string[] {
  const subtitleTexts = subtitles.map((sub) => {
    const cleaned = cleanSubtitleText(sub.text);
    const mixed = cleanMixedLanguageText(cleaned, 'ko');
    return forPDF ? normalizeTextForPDF(mixed) : mixed;
  });
  return deduplicateSubtitles(subtitleTexts);
}

/**
 * PDFKit Renderer Class
 */
export default class PDFKitRenderer {
  private config: PDFConfig;
  private theme: Theme;

  constructor(config: PDFConfig, theme: Theme) {
    this.config = config;
    this.theme = theme;
  }

  // ============================================================
  // Cover Page Methods
  // ============================================================

  /**
   * Render cover page title and thumbnail
   */
  renderCoverTitle(
    doc: PDFKit.PDFDocument,
    metadata: VideoMetadata,
    thumbnailBuffer: Buffer | null | undefined,
    pageWidth: number
  ): void {
    const { theme } = this;

    // Title
    doc
      .font(theme.fonts.title.name)
      .fontSize(theme.fonts.title.size)
      .fillColor(theme.colors.text)
      .text(normalizeTextForPDF(metadata.title), { width: pageWidth, align: 'center' });

    doc.moveDown(1);

    // Thumbnail
    if (thumbnailBuffer) {
      try {
        const thumbnailWidth = Math.min(400, pageWidth);
        const centerX = (doc.page.width - thumbnailWidth) / 2;
        doc.image(thumbnailBuffer, centerX, doc.y, {
          fit: [thumbnailWidth, 225],
          align: 'center',
        });
        doc.y += 225 + 10;
      } catch {
        logger.debug('썸네일 렌더링 실패');
      }
    }

    doc.moveDown(1);
  }

  /**
   * Render cover page metadata info
   */
  renderCoverMetadata(
    doc: PDFKit.PDFDocument,
    metadata: VideoMetadata,
    sectionCount: number | undefined
  ): void {
    const { theme } = this;

    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.secondary);

    doc.text(normalizeTextForPDF(`채널: ${metadata.channel}`), { align: 'center' });
    doc.text(`영상 길이: ${formatTimestamp(metadata.duration)}`, { align: 'center' });
    if (sectionCount) {
      doc.text(`섹션: ${sectionCount}개`, { align: 'center' });
    }

    const youtubeUrl = `https://youtube.com/watch?v=${metadata.id}`;
    doc.fillColor(theme.colors.link);
    doc.text(youtubeUrl, { link: youtubeUrl, align: 'center' });

    doc.fillColor(theme.colors.secondary);
    doc.text(`생성일: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
  }

  /**
   * Render cover page summary section
   */
  renderCoverSummary(
    doc: PDFKit.PDFDocument,
    summary: ContentSummary | CoverMetadata,
    pageWidth: number
  ): void {
    const { theme } = this;

    doc.moveDown(1.5);

    // Metadata badges (난이도 + 읽기 시간)
    if ('difficulty' in summary || 'estimatedReadTime' in summary) {
      const badges: string[] = [];

      if ('difficulty' in summary && summary.difficulty) {
        const labels = {
          beginner: '🟢 입문',
          intermediate: '🟡 중급',
          advanced: '🔴 고급',
        };
        badges.push(labels[summary.difficulty]);
      }

      if ('estimatedReadTime' in summary && summary.estimatedReadTime) {
        badges.push(`⏱️ ${summary.estimatedReadTime}분`);
      }

      if (badges.length > 0) {
        doc
          .font(theme.fonts.body.name)
          .fontSize(10)
          .fillColor(theme.colors.secondary)
          .text(badges.join('  •  '), { align: 'left' });
        doc.moveDown(0.5);
      }
    }

    // Summary
    doc
      .font(theme.fonts.heading.name)
      .fontSize(theme.fonts.heading.size)
      .fillColor(theme.colors.text)
      .text('📝 요약', { align: 'left' });

    doc.moveDown(0.5);

    doc
      .font(theme.fonts.body.name)
      .fontSize(theme.fonts.body.size)
      .fillColor(theme.colors.text)
      .text(normalizeTextForPDF(summary.summary), { align: 'left', width: pageWidth });

    // Key Points
    if (summary.keyPoints && summary.keyPoints.length > 0) {
      doc.moveDown(1);

      doc
        .font(theme.fonts.heading.name)
        .fontSize(12)
        .fillColor(theme.colors.text)
        .text('💡 핵심 포인트', { align: 'left' });

      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size).fillColor(theme.colors.text);

      for (const point of summary.keyPoints) {
        doc.text(normalizeTextForPDF(`• ${point}`), { indent: 10, width: pageWidth - 10 });
      }
    }

    // Target Audience
    if ('targetAudience' in summary && summary.targetAudience) {
      doc.moveDown(1);

      doc
        .font(theme.fonts.heading.name)
        .fontSize(12)
        .fillColor(theme.colors.text)
        .text('👥 대상 독자', { align: 'left' });

      doc.moveDown(0.3);

      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.text)
        .text(normalizeTextForPDF(summary.targetAudience), { indent: 10, width: pageWidth - 10 });
    }

    // Recommended For
    if ('recommendedFor' in summary && summary.recommendedFor?.length) {
      doc.moveDown(1);

      doc
        .font(theme.fonts.heading.name)
        .fontSize(12)
        .fillColor(theme.colors.text)
        .text('🎯 이런 분께 추천합니다', { align: 'left' });

      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size).fillColor(theme.colors.text);

      for (const item of summary.recommendedFor) {
        doc.text(normalizeTextForPDF(`• ${item}`), { indent: 10, width: pageWidth - 10 });
      }
    }

    // Benefits
    if ('benefits' in summary && summary.benefits?.length) {
      doc.moveDown(1);

      doc
        .font(theme.fonts.heading.name)
        .fontSize(12)
        .fillColor(theme.colors.text)
        .text('✨ 이 영상을 보면', { align: 'left' });

      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size).fillColor(theme.colors.text);

      for (const benefit of summary.benefits) {
        doc.text(normalizeTextForPDF(`• ${benefit}`), { indent: 10, width: pageWidth - 10 });
      }
    }

    // Keywords
    if ('keywords' in summary && summary.keywords?.length) {
      doc.moveDown(1);

      doc
        .font(theme.fonts.heading.name)
        .fontSize(12)
        .fillColor(theme.colors.text)
        .text('🏷️ 키워드', { align: 'left' });

      doc.moveDown(0.3);

      const keywordTags = summary.keywords.map((k) => `#${k}`).join(' ');
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.link)
        .text(normalizeTextForPDF(keywordTags), { indent: 10, width: pageWidth - 10 });
    }
  }

  /**
   * Render cover page footer
   */
  renderCoverFooter(doc: PDFKit.PDFDocument): void {
    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor('#9ca3af')
      .text(normalizeTextForPDF('Generated by v2doc'), { align: 'center' });

    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(normalizeTextForPDF('영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.'), {
        align: 'center',
      });
  }

  /**
   * 표지 렌더링 (동기)
   */
  renderCoverPageSync(
    doc: PDFKit.PDFDocument,
    metadata: VideoMetadata,
    thumbnailBuffer?: Buffer | null,
    sectionCount?: number,
    summary?: ContentSummary
  ): void {
    const pageWidth = doc.page.width - this.theme.margins.left - this.theme.margins.right;

    // Title and thumbnail
    this.renderCoverTitle(doc, metadata, thumbnailBuffer, pageWidth);

    // Metadata
    this.renderCoverMetadata(doc, metadata, sectionCount);

    // Summary (if available)
    if (summary && summary.summary) {
      this.renderCoverSummary(doc, summary, pageWidth);
    }

    // Footer
    this.renderCoverFooter(doc);
  }

  // ============================================================
  // Table of Contents
  // ============================================================

  /**
   * 목차 렌더링
   */
  renderTableOfContents(doc: PDFKit.PDFDocument, sections: PDFSection[], _videoId: string): void {
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
      const pageNum = startPage + i;

      // 챕터 제목 우선, 없으면 섹션 요약, 없으면 첫 자막 fallback
      let title = section.chapterTitle || section.sectionSummary?.summary || '';
      if (!title) {
        const rawPreview = section.subtitles[0]?.text || '';
        title = normalizeTextForPDF(cleanSubtitleText(rawPreview)).substring(0, 50);
      }
      // 길이 제한 (50자)
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      // 타임스탬프 (파란색)
      doc.fillColor(theme.colors.link).text(`${timestamp}`, { continued: true });

      // 섹션 제목 (검정색)
      const titleText = title ? `  ${title}` : '';
      doc.fillColor(theme.colors.text).text(titleText, { continued: true });

      // 점선 + 페이지 번호 (오른쪽 정렬)
      const textWidth = doc.widthOfString(`${timestamp}${titleText}`);
      const pageNumWidth = doc.widthOfString(`${pageNum}`);
      const dotsWidth = pageWidth - textWidth - pageNumWidth - 10;
      const dotsCount = Math.max(0, Math.floor(dotsWidth / doc.widthOfString('.')));
      const dots = '.'.repeat(dotsCount);

      doc.fillColor(theme.colors.secondary).text(`${dots}${pageNum}`);
    }
  }

  // ============================================================
  // Section Rendering Methods
  // ============================================================

  /**
   * Render section image and timestamp for vertical layout
   */
  renderSectionImageAndTimestamp(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    videoId: string,
    pageWidth: number
  ): void {
    const { theme } = this;

    // Chapter title
    if (section.chapterTitle) {
      doc
        .font(theme.fonts.heading.name)
        .fontSize(14)
        .fillColor(theme.colors.text)
        .text(normalizeTextForPDF(`📑 ${section.chapterTitle}`), { width: pageWidth });
      doc.moveDown(0.5);
    }

    // Screenshot
    const imageMaxHeight = this.config.imageQuality === 'high' ? 340 : 200;
    try {
      doc.image(section.screenshot.imagePath, {
        fit: [pageWidth, imageMaxHeight],
        align: 'center',
      });
    } catch {
      doc.text('[이미지 로드 실패]');
    }

    doc.moveDown(this.config.imageQuality === 'high' ? 1.5 : 1);

    // Timestamp
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
  }

  /**
   * Render AI-enhanced summary content (keyPoints, mainInformation, notableQuotes)
   */
  renderSectionSummaryContent(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    pageWidth: number
  ): void {
    const { theme } = this;

    // Key Points
    if (section.sectionSummary?.keyPoints && section.sectionSummary.keyPoints.length > 0) {
      doc
        .font(theme.fonts.heading.name)
        .fontSize(11)
        .fillColor(theme.colors.primary)
        .text('💡 핵심 포인트', { width: pageWidth });
      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(10).fillColor(theme.colors.text);

      for (const point of section.sectionSummary.keyPoints) {
        doc.text(normalizeTextForPDF(`• ${point}`), { width: pageWidth, indent: 10 });
      }
      doc.moveDown(0.5);
    }

    // Main Information
    if (section.sectionSummary?.mainInformation) {
      const mainInfo = section.sectionSummary.mainInformation;

      doc
        .font(theme.fonts.heading.name)
        .fontSize(11)
        .fillColor(theme.colors.primary)
        .text('📋 주요 정보', { width: pageWidth });
      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(10).fillColor(theme.colors.text);

      // Paragraphs
      if (mainInfo.paragraphs && mainInfo.paragraphs.length > 0) {
        for (const para of mainInfo.paragraphs) {
          doc.text(normalizeTextForPDF(para), { width: pageWidth });
          doc.moveDown(0.2);
        }
      }

      // Bullets with tag handling
      if (mainInfo.bullets && mainInfo.bullets.length > 0) {
        const tagPattern = /^\[([A-Z_]+)\]\s*/;
        const dimGray = '#9ca3af';

        for (const bullet of mainInfo.bullets) {
          const tagMatch = bullet.match(tagPattern);

          if (tagMatch) {
            const tag = tagMatch[0];
            const content = bullet.slice(tag.length);

            doc
              .fillColor(dimGray)
              .text(normalizeTextForPDF(`• ${tag}`), {
                width: pageWidth,
                indent: 10,
                continued: true,
              })
              .fillColor(theme.colors.text)
              .text(normalizeTextForPDF(content));
          } else {
            doc
              .fillColor(theme.colors.text)
              .text(normalizeTextForPDF(`• ${bullet}`), { width: pageWidth, indent: 10 });
          }
        }
      }
      doc.moveDown(0.5);
    }

    // Notable Quotes
    if (section.sectionSummary?.notableQuotes && section.sectionSummary.notableQuotes.length > 0) {
      doc
        .font(theme.fonts.heading.name)
        .fontSize(11)
        .fillColor(theme.colors.primary)
        .text('💬 주목할 만한 인용', { width: pageWidth });
      doc.moveDown(0.3);

      doc.font(theme.fonts.body.name).fontSize(9).fillColor(theme.colors.secondary);

      for (const quote of section.sectionSummary.notableQuotes) {
        doc.text(normalizeTextForPDF(`"${quote}"`), { width: pageWidth, indent: 10 });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3);
    }
  }

  /**
   * Render raw subtitles when no AI-enhanced content is available
   */
  renderRawSubtitles(doc: PDFKit.PDFDocument, section: PDFSection, pageWidth: number): void {
    const { theme } = this;
    const dedupedTexts = processSubtitles(section.subtitles);

    if (dedupedTexts.length === 0) {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.secondary)
        .text('(이 구간에 자막이 없습니다)', { align: 'center' });
    } else {
      doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size).fillColor(theme.colors.text);

      const maxY = doc.page.height - theme.margins.bottom - 50;

      for (const text of dedupedTexts) {
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
   * Check if section has AI-enhanced content
   */
  private hasEnhancedContent(section: PDFSection): boolean {
    return !!(
      section.sectionSummary &&
      ((section.sectionSummary.keyPoints && section.sectionSummary.keyPoints.length > 0) ||
        (section.sectionSummary.mainInformation?.paragraphs &&
          section.sectionSummary.mainInformation.paragraphs.length > 0) ||
        (section.sectionSummary.mainInformation?.bullets &&
          section.sectionSummary.mainInformation.bullets.length > 0))
    );
  }

  /**
   * Vertical 레이아웃 섹션 렌더링
   */
  renderVerticalSection(doc: PDFKit.PDFDocument, section: PDFSection, videoId: string): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // Image and timestamp
    this.renderSectionImageAndTimestamp(doc, section, videoId, pageWidth);

    // Check page space
    const remainingSpace = doc.page.height - doc.y - theme.margins.bottom - 40;
    if (remainingSpace < 100) {
      doc.addPage();
    }

    // AI-enhanced content
    this.renderSectionSummaryContent(doc, section, pageWidth);

    // Raw subtitles (only if no AI content)
    if (!this.hasEnhancedContent(section)) {
      this.renderRawSubtitles(doc, section, pageWidth);
    }
  }

  /**
   * Horizontal 레이아웃 섹션 렌더링
   */
  renderHorizontalSection(doc: PDFKit.PDFDocument, section: PDFSection, videoId: string): void {
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
    const dedupedTexts = processSubtitles(section.subtitles);

    if (dedupedTexts.length === 0) {
      doc
        .font(theme.fonts.body.name)
        .fontSize(theme.fonts.body.size)
        .fillColor(theme.colors.secondary)
        .text('(이 구간에 자막이 없습니다)', rightX, doc.y, { width: halfWidth });
    } else {
      doc.font(theme.fonts.body.name).fontSize(theme.fonts.body.size).fillColor(theme.colors.text);

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

  // ============================================================
  // Minimal Neon Layout Methods
  // ============================================================

  /**
   * Fill page background with dark color for minimal-neon layout
   */
  fillMinimalNeonBackground(doc: PDFKit.PDFDocument): void {
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(MINIMAL_NEON_COLORS.bg);
  }

  /**
   * Render section label with gradient line (minimal-neon style)
   */
  renderMinimalNeonSectionLabel(doc: PDFKit.PDFDocument, label: string, pageWidth: number): void {
    const { theme } = this;

    // Label text
    doc
      .font(theme.fonts.timestamp.name)
      .fontSize(11)
      .fillColor(MINIMAL_NEON_COLORS.neonGreen)
      .text(label.toUpperCase(), { continued: true });

    // Gradient line (simulated with fading line)
    const startX = doc.x + doc.widthOfString(label.toUpperCase()) + 12;
    const lineY = doc.y + 5;
    const lineEndX = theme.margins.left + pageWidth;

    // Draw gradient line (simplified as solid line fading to transparent)
    doc
      .strokeColor(MINIMAL_NEON_COLORS.neonGreen)
      .lineWidth(1)
      .moveTo(startX, lineY)
      .lineTo(lineEndX, lineY)
      .stroke();

    doc.text(''); // Complete the continued text
    doc.moveDown(0.5);
  }

  /**
   * Render minimal-neon cover page
   */
  renderMinimalNeonCoverPage(
    doc: PDFKit.PDFDocument,
    metadata: VideoMetadata,
    _thumbnailBuffer: Buffer | null | undefined, // Not used in minimal-neon design
    sectionCount: number,
    summary?: ContentSummary
  ): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // Fill background
    this.fillMinimalNeonBackground(doc);

    // Header top: tag badge + date
    const tagBadgeY = theme.margins.top;

    // Tag badge with dot
    doc.circle(theme.margins.left + 4, tagBadgeY + 5, 4).fill(MINIMAL_NEON_COLORS.neonGreen);

    doc
      .font(theme.fonts.timestamp.name)
      .fontSize(11)
      .fillColor(MINIMAL_NEON_COLORS.neonGreen)
      .text('VIDEO SUMMARY', theme.margins.left + 16, tagBadgeY);

    // Date (right side)
    const dateText = normalizeTextForPDF(`생성일: ${new Date().toISOString().split('T')[0]}`);
    doc
      .font(theme.fonts.body.name)
      .fontSize(10)
      .fillColor(MINIMAL_NEON_COLORS.gray500)
      .text(dateText, doc.page.width - theme.margins.right - 100, tagBadgeY, {
        width: 100,
        align: 'right',
      });

    // Border line
    doc.y = tagBadgeY + 30;
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .moveTo(theme.margins.left, doc.y)
      .lineTo(doc.page.width - theme.margins.right, doc.y)
      .stroke();

    doc.moveDown(1.5);

    // Title (large, bold)
    doc
      .font(theme.fonts.title.name)
      .fontSize(48)
      .fillColor(MINIMAL_NEON_COLORS.white)
      .text(normalizeTextForPDF(metadata.title), theme.margins.left, doc.y, {
        width: pageWidth,
        align: 'left',
        lineGap: 5,
      });

    doc.moveDown(0.5);

    // Subtitle (channel name as subtitle)
    doc
      .font(theme.fonts.body.name)
      .fontSize(18)
      .fillColor(MINIMAL_NEON_COLORS.gray300)
      .text(normalizeTextForPDF(metadata.channel), { width: pageWidth });

    doc.moveDown(1.5);

    // Metadata grid (4 columns)
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .moveTo(theme.margins.left, doc.y)
      .lineTo(doc.page.width - theme.margins.right, doc.y)
      .stroke();

    doc.moveDown(1);

    const metaItems = [
      { label: 'CHANNEL', value: metadata.channel },
      { label: 'DURATION', value: formatTimestamp(metadata.duration) },
      { label: 'SECTIONS', value: `${sectionCount}개` },
      { label: 'TYPE', value: VIDEO_TYPE_LABELS[metadata.videoType || 'unknown'] },
    ];

    const colWidth = pageWidth / 4;
    const metaStartY = doc.y;

    metaItems.forEach((item, idx) => {
      const x = theme.margins.left + idx * colWidth;

      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(9)
        .fillColor(MINIMAL_NEON_COLORS.gray500)
        .text(item.label, x, metaStartY, { width: colWidth - 10 });

      doc
        .font(theme.fonts.body.name)
        .fontSize(13)
        .fillColor(MINIMAL_NEON_COLORS.white)
        .text(normalizeTextForPDF(item.value), x, metaStartY + 15, { width: colWidth - 10 });
    });

    doc.y = metaStartY + 45;

    // YouTube link row
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .moveTo(theme.margins.left, doc.y)
      .lineTo(doc.page.width - theme.margins.right, doc.y)
      .stroke();

    doc.moveDown(1);

    doc
      .font(theme.fonts.timestamp.name)
      .fontSize(9)
      .fillColor(MINIMAL_NEON_COLORS.gray500)
      .text('YOUTUBE LINK', theme.margins.left, doc.y);

    doc.moveDown(0.3);

    const youtubeUrl = `https://youtube.com/watch?v=${metadata.id}`;
    doc
      .font(theme.fonts.body.name)
      .fontSize(13)
      .fillColor(MINIMAL_NEON_COLORS.neonBlue)
      .text(youtubeUrl, { link: youtubeUrl });

    // Summary section (if available)
    if (summary && summary.summary) {
      doc.moveDown(1.5);
      this.renderMinimalNeonSectionLabel(doc, 'Executive Summary', pageWidth);

      doc
        .font(theme.fonts.body.name)
        .fontSize(15)
        .fillColor(MINIMAL_NEON_COLORS.gray100)
        .text(normalizeTextForPDF(summary.summary), {
          width: pageWidth,
          lineGap: 12,
        });

      // Key insights (if available)
      if (summary.keyPoints && summary.keyPoints.length > 0) {
        // Check if there's enough space for Key Insights section
        // Estimate: label (~30) + 3 insights (~150) + padding (~50) = ~230px minimum
        const remainingSpace = doc.page.height - doc.y - theme.margins.bottom - 60;
        if (remainingSpace < 230) {
          // Not enough space, add a new page
          doc.addPage();
          this.fillMinimalNeonBackground(doc);
          doc.y = theme.margins.top;
        } else {
          doc.moveDown(1.5);
        }
        this.renderMinimalNeonSectionLabel(doc, 'Key Insights', pageWidth);
        this.renderMinimalNeonInsightCards(doc, summary.keyPoints, pageWidth);
      }
    }

    // Footer
    doc.y = doc.page.height - theme.margins.bottom - 40;
    doc
      .font(theme.fonts.body.name)
      .fontSize(9)
      .fillColor(MINIMAL_NEON_COLORS.gray500)
      .text(normalizeTextForPDF('Generated by v2doc'), { align: 'center' });

    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .text(normalizeTextForPDF('영상 정보 및 자막의 저작권은 원 제작자에게 있습니다.'), {
        align: 'center',
      });
  }

  /**
   * Render insight cards in minimal-neon style
   */
  renderMinimalNeonInsightCards(
    doc: PDFKit.PDFDocument,
    keyPoints: string[],
    pageWidth: number
  ): void {
    const { theme } = this;

    // Border around all cards
    const startY = doc.y;
    const cardPadding = 20;

    keyPoints.forEach((point, idx) => {
      if (idx > 0) {
        // Draw separator line
        doc
          .strokeColor(MINIMAL_NEON_COLORS.border)
          .lineWidth(1)
          .moveTo(theme.margins.left, doc.y)
          .lineTo(theme.margins.left + pageWidth, doc.y)
          .stroke();
      }

      doc.y += cardPadding;

      // Number (left column)
      const numStr = String(idx + 1).padStart(2, '0');
      doc
        .font(theme.fonts.title.name)
        .fontSize(26)
        .fillColor(MINIMAL_NEON_COLORS.neonGreen)
        .text(numStr, theme.margins.left, doc.y, { width: 50 });

      // Content (right column)
      doc
        .font(theme.fonts.body.name)
        .fontSize(13)
        .fillColor(MINIMAL_NEON_COLORS.gray300)
        .text(normalizeTextForPDF(point), theme.margins.left + 60, doc.y, {
          width: pageWidth - 70,
        });

      doc.moveDown(0.4);
    });

    // Draw border around all cards (only if no page break occurred)
    const endY = doc.y;
    // If endY < startY, a page break occurred and border would be wrong
    if (endY > startY) {
      doc
        .strokeColor(MINIMAL_NEON_COLORS.border)
        .lineWidth(1)
        .rect(theme.margins.left, startY - 5, pageWidth, endY - startY + 10)
        .stroke();
    }
  }

  /**
   * Render minimal-neon TOC (Table of Contents)
   */
  renderMinimalNeonTOC(doc: PDFKit.PDFDocument, sections: PDFSection[], _videoId: string): void {
    doc.addPage();
    this.fillMinimalNeonBackground(doc);

    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    this.renderMinimalNeonSectionLabel(doc, 'Table of Contents', pageWidth);

    // Draw TOC border
    const tocStartY = doc.y;

    sections.forEach((section, idx) => {
      const timestamp = formatTimestamp(section.timestamp);
      const title =
        section.chapterTitle ||
        section.sectionSummary?.summary?.substring(0, 50) ||
        `섹션 ${idx + 1}`;

      // Border bottom for each item (except last)
      if (idx > 0) {
        doc
          .strokeColor(MINIMAL_NEON_COLORS.border)
          .lineWidth(1)
          .moveTo(theme.margins.left, doc.y)
          .lineTo(theme.margins.left + pageWidth, doc.y)
          .stroke();
      }

      const itemY = doc.y + 12;

      // Time column (left)
      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(13)
        .fillColor(MINIMAL_NEON_COLORS.neonBlue)
        .text(timestamp, theme.margins.left + 15, itemY, { width: 60 });

      // Vertical separator
      doc
        .strokeColor(MINIMAL_NEON_COLORS.border)
        .lineWidth(1)
        .moveTo(theme.margins.left + 80, itemY - 5)
        .lineTo(theme.margins.left + 80, itemY + 15)
        .stroke();

      // Title column (right)
      doc
        .font(theme.fonts.body.name)
        .fontSize(13)
        .fillColor(MINIMAL_NEON_COLORS.gray100)
        .text(normalizeTextForPDF(title), theme.margins.left + 95, itemY, {
          width: pageWidth - 110,
        });

      doc.y = itemY + 25;
    });

    // Draw outer border
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .rect(theme.margins.left, tocStartY - 5, pageWidth, doc.y - tocStartY + 5)
      .stroke();
  }

  /**
   * Render a single section in minimal-neon style
   */
  renderMinimalNeonSection(
    doc: PDFKit.PDFDocument,
    section: PDFSection,
    _videoId: string, // Reserved for future timestamp link support
    sectionIndex: number
  ): void {
    const { theme } = this;
    const pageWidth = doc.page.width - theme.margins.left - theme.margins.right;

    // Fill background
    this.fillMinimalNeonBackground(doc);

    // Detailed Analysis section label (only for first section after TOC)
    if (sectionIndex === 0) {
      this.renderMinimalNeonSectionLabel(doc, 'Detailed Analysis', pageWidth);
    }

    // Detail section box
    const sectionStartY = doc.y;

    // Draw outer border
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .rect(theme.margins.left, sectionStartY, pageWidth, 0) // Will update height later
      .stroke();

    // Header bar (elevated background)
    doc.rect(theme.margins.left, sectionStartY, pageWidth, 45).fill(MINIMAL_NEON_COLORS.bgElevated);

    // Time badge (neon-green background)
    const timestamp = formatTimestamp(section.timestamp);
    const timeBadgeWidth = 55;
    doc
      .rect(theme.margins.left + 15, sectionStartY + 12, timeBadgeWidth, 22)
      .fill(MINIMAL_NEON_COLORS.neonGreen);

    doc
      .font(theme.fonts.timestamp.name)
      .fontSize(11)
      .fillColor(MINIMAL_NEON_COLORS.bg)
      .text(timestamp, theme.margins.left + 15 + 5, sectionStartY + 17, {
        width: timeBadgeWidth - 10,
        align: 'center',
      });

    // Section title
    const sectionTitle =
      section.chapterTitle ||
      section.sectionSummary?.summary?.substring(0, 60) ||
      `섹션 ${sectionIndex + 1}`;

    doc
      .font(theme.fonts.heading.name)
      .fontSize(18)
      .fillColor(MINIMAL_NEON_COLORS.white)
      .text(
        normalizeTextForPDF(sectionTitle),
        theme.margins.left + timeBadgeWidth + 30,
        sectionStartY + 15,
        {
          width: pageWidth - timeBadgeWidth - 50,
        }
      );

    // Header bottom border
    doc.y = sectionStartY + 45;
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .moveTo(theme.margins.left, doc.y)
      .lineTo(theme.margins.left + pageWidth, doc.y)
      .stroke();

    doc.y += 20;

    // Screenshot with actual aspect ratio
    try {
      const imgWidth = Math.min(pageWidth - 40, 400);
      const imgX = theme.margins.left + 20;

      // Get actual image dimensions to preserve aspect ratio
      interface PDFDocWithImages {
        openImage: (path: string) => { width: number; height: number };
      }
      const imgInfo = (doc as unknown as PDFDocWithImages).openImage(section.screenshot.imagePath);
      const actualRatio = imgInfo.height / imgInfo.width;

      // Cap aspect ratio to prevent overly tall images (max ~16:9)
      const cappedRatio = Math.min(actualRatio, 0.65);
      const imgHeight = imgWidth * cappedRatio;

      const imageStartY = doc.y;
      doc.image(section.screenshot.imagePath, imgX, imageStartY, {
        width: imgWidth,
        height: imgHeight,
      });

      // PDFKit advances doc.y automatically, just add spacing
      doc.y = imageStartY + imgHeight + 15;
    } catch {
      doc
        .font(theme.fonts.body.name)
        .fontSize(11)
        .fillColor(MINIMAL_NEON_COLORS.gray500)
        .text('[이미지 로드 실패]', { align: 'center' });
      doc.moveDown();
    }

    // Key Points with left border
    if (section.sectionSummary?.keyPoints && section.sectionSummary.keyPoints.length > 0) {
      // Check remaining page space before Key Points
      const remainingSpaceForKeyPoints = doc.page.height - doc.y - theme.margins.bottom - 60;
      if (remainingSpaceForKeyPoints < 80) {
        doc.addPage();
        this.fillMinimalNeonBackground(doc);
        doc.y = theme.margins.top;
      }

      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(9)
        .fillColor(MINIMAL_NEON_COLORS.gray500)
        .text('KEY POINTS', theme.margins.left + 20, doc.y);

      doc.moveDown(0.5);

      section.sectionSummary.keyPoints.forEach((point) => {
        // Left border
        doc
          .strokeColor(MINIMAL_NEON_COLORS.border)
          .lineWidth(2)
          .moveTo(theme.margins.left + 20, doc.y)
          .lineTo(theme.margins.left + 20, doc.y + 18)
          .stroke();

        doc
          .font(theme.fonts.body.name)
          .fontSize(13)
          .fillColor(MINIMAL_NEON_COLORS.gray100)
          .text(normalizeTextForPDF(point), theme.margins.left + 35, doc.y, {
            width: pageWidth - 55,
          });

        doc.moveDown(0.5);
      });
    }

    // Main Information bullets with tags
    if (
      section.sectionSummary?.mainInformation?.bullets &&
      section.sectionSummary.mainInformation.bullets.length > 0
    ) {
      doc.moveDown(0.5);

      // Check remaining page space before Main Information (reduced threshold)
      const remainingSpaceForMainInfo = doc.page.height - doc.y - theme.margins.bottom - 60;
      if (remainingSpaceForMainInfo < 80) {
        doc.addPage();
        this.fillMinimalNeonBackground(doc);
        doc.y = theme.margins.top;
      }

      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(9)
        .fillColor(MINIMAL_NEON_COLORS.gray500)
        .text('주요 정보', theme.margins.left + 20, doc.y);

      doc.moveDown(0.5);

      const tagPattern = /^\[([A-Z_]+)\]\s*/;

      section.sectionSummary.mainInformation.bullets.forEach((bullet) => {
        const tagMatch = bullet.match(tagPattern);
        const startX = theme.margins.left + 20;

        if (tagMatch) {
          const tagName = tagMatch[1];
          const content = bullet.slice(tagMatch[0].length);
          const tagColors = MINIMAL_NEON_TAG_COLORS[tagName] || {
            bg: MINIMAL_NEON_COLORS.bgSubtle,
            text: MINIMAL_NEON_COLORS.gray300,
          };

          // Tag badge
          const tagWidth = doc.widthOfString(tagName) + 12;
          doc.roundedRect(startX, doc.y - 2, tagWidth, 16, 4).fill(tagColors.bg);

          doc
            .font(theme.fonts.timestamp.name)
            .fontSize(8)
            .fillColor(tagColors.text)
            .text(tagName, startX + 6, doc.y, { width: tagWidth, continued: false });

          doc
            .font(theme.fonts.body.name)
            .fontSize(13)
            .fillColor(MINIMAL_NEON_COLORS.gray300)
            .text(normalizeTextForPDF(content), startX + tagWidth + 10, doc.y - 14, {
              width: pageWidth - tagWidth - 50,
            });
        } else {
          doc
            .font(theme.fonts.body.name)
            .fontSize(13)
            .fillColor(MINIMAL_NEON_COLORS.gray300)
            .text(normalizeTextForPDF(`• ${bullet}`), startX, doc.y, {
              width: pageWidth - 40,
            });
        }

        doc.moveDown(0.3);
      });
    }

    // Notable Quotes with blue left border
    if (section.sectionSummary?.notableQuotes && section.sectionSummary.notableQuotes.length > 0) {
      doc.moveDown(0.8);

      // Check remaining page space before Notable Quotes
      const remainingSpaceForQuotes = doc.page.height - doc.y - theme.margins.bottom - 60;
      if (remainingSpaceForQuotes < 80) {
        doc.addPage();
        this.fillMinimalNeonBackground(doc);
        doc.y = theme.margins.top;
      }

      // Quote block background
      const quoteStartY = doc.y;
      // Calculate actual quote box height based on text wrapping
      // Set font size before calculating height (fontSize not valid in heightOfString options)
      doc.fontSize(13);
      let quoteBoxHeight = 30; // header + padding
      section.sectionSummary.notableQuotes.forEach((quote) => {
        const quoteText = `"${normalizeTextForPDF(quote)}"`;
        quoteBoxHeight += doc.heightOfString(quoteText, { width: pageWidth - 60 }) + 12;
      });

      doc
        .rect(theme.margins.left + 20, quoteStartY, pageWidth - 40, quoteBoxHeight)
        .fill(MINIMAL_NEON_COLORS.bgElevated);

      // Blue left border
      doc
        .rect(theme.margins.left + 20, quoteStartY, 3, quoteBoxHeight)
        .fill(MINIMAL_NEON_COLORS.neonBlue);

      doc
        .font(theme.fonts.timestamp.name)
        .fontSize(9)
        .fillColor(MINIMAL_NEON_COLORS.neonBlue)
        .text('NOTABLE QUOTES', theme.margins.left + 35, quoteStartY + 10);

      doc.y = quoteStartY + 28;

      section.sectionSummary.notableQuotes.forEach((quote) => {
        doc
          .font(theme.fonts.body.name)
          .fontSize(13)
          .fillColor(MINIMAL_NEON_COLORS.white)
          .text(normalizeTextForPDF(`"${quote}"`), theme.margins.left + 35, doc.y, {
            width: pageWidth - 60,
          });
        doc.moveDown(0.3);
      });

      doc.y = quoteStartY + quoteBoxHeight + 10;
    }

    // Draw outer border for the section
    const sectionEndY = doc.y + 20;
    doc
      .strokeColor(MINIMAL_NEON_COLORS.border)
      .lineWidth(1)
      .rect(theme.margins.left, sectionStartY, pageWidth, sectionEndY - sectionStartY)
      .stroke();

    // Footer
    doc.y = doc.page.height - theme.margins.bottom - 20;
    doc
      .font(theme.fonts.body.name)
      .fontSize(8)
      .fillColor(MINIMAL_NEON_COLORS.gray500)
      .text(normalizeTextForPDF('Generated by v2doc'), { align: 'center' });
  }
}
