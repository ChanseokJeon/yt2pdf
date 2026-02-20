/**
 * Tests for quality-aware vertical image sizing in PDFKitRenderer
 *
 * Verifies that imageQuality config affects vertical layout image sizing:
 * - default/low: fit=[pageWidth, 200], moveDown(1)
 * - high: fit=[pageWidth, 340], moveDown(1.5)
 * - horizontal layout: unchanged regardless of imageQuality
 */

import PDFKitRenderer from '../../../../src/core/pdf/pdfkit-renderer';
import { DEFAULT_THEME } from '../../../../src/core/pdf/themes';
import { PDFConfig, PDFConfigSchema } from '../../../../src/types/config';
import { PDFSection } from '../../../../src/types/index';

// Create a mock PDFDocument that tracks calls
function createMockDoc() {
  const calls: { method: string; args: unknown[] }[] = [];

  const doc: Record<string, unknown> = {
    page: {
      width: 595.28, // A4 width in points
      height: 841.89,
    },
    y: 100,
    x: 50,
    font: jest.fn().mockReturnThis(),
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    image: jest.fn(function (...args: unknown[]) {
      calls.push({ method: 'image', args });
      return doc;
    }),
    moveDown: jest.fn(function (...args: unknown[]) {
      calls.push({ method: 'moveDown', args });
      return doc;
    }),
    addPage: jest.fn().mockReturnThis(),
    rect: jest.fn().mockReturnThis(),
    fill: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    restore: jest.fn().mockReturnThis(),
    roundedRect: jest.fn().mockReturnThis(),
    lineWidth: jest.fn().mockReturnThis(),
    strokeColor: jest.fn().mockReturnThis(),
    opacity: jest.fn().mockReturnThis(),
    fillOpacity: jest.fn().mockReturnThis(),
    list: jest.fn().mockReturnThis(),
  };

  return { doc: doc as unknown as PDFKit.PDFDocument, calls };
}

function createSection(overrides?: Partial<PDFSection>): PDFSection {
  return {
    timestamp: 60,
    screenshot: {
      imagePath: '/tmp/test-screenshot.png',
      timestamp: 60,
    },
    subtitles: [{ text: 'Test subtitle', start: 60, end: 120 }],
    ...overrides,
  };
}

describe('PDFKitRenderer - Quality-Aware Vertical Image Sizing', () => {
  const videoId = 'test-video-id';
  const theme = DEFAULT_THEME;
  const expectedPageWidth =
    595.28 - theme.margins.left - theme.margins.right;

  describe('renderSectionImageAndTimestamp (vertical layout)', () => {
    it('should use fit=[pageWidth, 200] with default imageQuality (undefined)', () => {
      const config: PDFConfig = PDFConfigSchema.parse({});
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderSectionImageAndTimestamp(
        doc,
        section,
        videoId,
        expectedPageWidth
      );

      const imageCall = calls.find((c) => c.method === 'image');
      expect(imageCall).toBeDefined();
      const imageOpts = imageCall!.args[1] as { fit: number[] };
      expect(imageOpts.fit[0]).toBeCloseTo(expectedPageWidth);
      expect(imageOpts.fit[1]).toBe(200);
    });

    it('should use fit=[pageWidth, 200] with imageQuality="low"', () => {
      const config: PDFConfig = PDFConfigSchema.parse({ imageQuality: 'low' });
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderSectionImageAndTimestamp(
        doc,
        section,
        videoId,
        expectedPageWidth
      );

      const imageCall = calls.find((c) => c.method === 'image');
      expect(imageCall).toBeDefined();
      const imageOpts = imageCall!.args[1] as { fit: number[] };
      expect(imageOpts.fit[0]).toBeCloseTo(expectedPageWidth);
      expect(imageOpts.fit[1]).toBe(200);
    });

    it('should use fit=[pageWidth, 340] with imageQuality="high"', () => {
      const config: PDFConfig = PDFConfigSchema.parse({ imageQuality: 'high' });
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderSectionImageAndTimestamp(
        doc,
        section,
        videoId,
        expectedPageWidth
      );

      const imageCall = calls.find((c) => c.method === 'image');
      expect(imageCall).toBeDefined();
      const imageOpts = imageCall!.args[1] as { fit: number[] };
      expect(imageOpts.fit[0]).toBeCloseTo(expectedPageWidth);
      expect(imageOpts.fit[1]).toBe(340);
    });

    it('should use moveDown(1) for default/low quality after image', () => {
      const config: PDFConfig = PDFConfigSchema.parse({});
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderSectionImageAndTimestamp(
        doc,
        section,
        videoId,
        expectedPageWidth
      );

      // Find the moveDown call that comes after the image call
      const imageIdx = calls.findIndex((c) => c.method === 'image');
      const moveDownAfterImage = calls
        .slice(imageIdx + 1)
        .find((c) => c.method === 'moveDown');
      expect(moveDownAfterImage).toBeDefined();
      // Default moveDown() is called with no args (equivalent to 1)
      expect(
        moveDownAfterImage!.args.length === 0 || moveDownAfterImage!.args[0] === 1
      ).toBe(true);
    });

    it('should use moveDown(1.5) for high quality after image', () => {
      const config: PDFConfig = PDFConfigSchema.parse({ imageQuality: 'high' });
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderSectionImageAndTimestamp(
        doc,
        section,
        videoId,
        expectedPageWidth
      );

      // Find the moveDown call that comes after the image call
      const imageIdx = calls.findIndex((c) => c.method === 'image');
      const moveDownAfterImage = calls
        .slice(imageIdx + 1)
        .find((c) => c.method === 'moveDown');
      expect(moveDownAfterImage).toBeDefined();
      expect(moveDownAfterImage!.args[0]).toBe(1.5);
    });
  });

  describe('renderHorizontalSection (unchanged)', () => {
    it('should use fit=[halfWidth, 400] regardless of imageQuality="high"', () => {
      const config: PDFConfig = PDFConfigSchema.parse({
        layout: 'horizontal',
        imageQuality: 'high',
      });
      const renderer = new PDFKitRenderer(config, theme);
      const { doc, calls } = createMockDoc();
      const section = createSection();

      renderer.renderHorizontalSection(doc, section, videoId);

      const imageCall = calls.find((c) => c.method === 'image');
      expect(imageCall).toBeDefined();
      // Horizontal layout uses halfWidth and 400 height, NOT affected by imageQuality
      const halfWidth = expectedPageWidth / 2 - 10;
      const imageOpts = imageCall!.args[3] as { fit: number[] };
      expect(imageOpts.fit[0]).toBeCloseTo(halfWidth);
      expect(imageOpts.fit[1]).toBe(400);
    });
  });
});
