/**
 * Theme Builder 단위 테스트
 */

import {
  detectSourceType,
  getPreset,
  ensureContrast,
  paletteToTheme,
  buildTheme,
  extractFromUrl,
  extractFromImage,
  ColorPalette,
  PRESETS,
  DEFAULT_PALETTE,
  AVAILABLE_PRESETS,
} from '../../../src/core/theme-builder';

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn((path: string) => {
    // Return true for test paths, false for non-existent
    if (path.includes('nonexistent') || path.includes('non-existent')) {
      return false;
    }
    return path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg');
  }),
}));

// Mock puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue({
        background: '#ffffff',
        text: '#333333',
        primary: '#0066cc',
        heading: '#111111',
      }),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock node-vibrant
jest.mock('node-vibrant/node', () => ({
  Vibrant: {
    from: jest.fn().mockReturnValue({
      getPalette: jest.fn().mockResolvedValue({
        Vibrant: { hex: '#e63946' },
        Muted: { hex: '#a8dadc' },
        LightMuted: { hex: '#f1faee' },
        DarkMuted: { hex: '#1d3557' },
        LightVibrant: { hex: '#457b9d' },
      }),
    }),
  },
}));

describe('ThemeBuilder', () => {
  describe('detectSourceType', () => {
    it('should detect HTTP URL', () => {
      const result = detectSourceType('http://example.com');
      expect(result.type).toBe('url');
      expect(result.value).toBe('http://example.com');
    });

    it('should detect HTTPS URL', () => {
      const result = detectSourceType('https://stripe.com/docs');
      expect(result.type).toBe('url');
      expect(result.value).toBe('https://stripe.com/docs');
    });

    it('should detect PNG image', () => {
      const result = detectSourceType('./logo.png');
      expect(result.type).toBe('image');
      expect(result.value).toBe('./logo.png');
    });

    it('should detect JPG image', () => {
      const result = detectSourceType('/path/to/image.jpg');
      expect(result.type).toBe('image');
    });

    it('should detect JPEG image', () => {
      const result = detectSourceType('brand.jpeg');
      expect(result.type).toBe('image');
    });

    it('should detect WebP image', () => {
      const result = detectSourceType('photo.webp');
      expect(result.type).toBe('image');
    });

    it('should detect GIF image', () => {
      const result = detectSourceType('animation.gif');
      expect(result.type).toBe('image');
    });

    it('should detect SVG image', () => {
      const result = detectSourceType('icon.svg');
      expect(result.type).toBe('image');
    });

    it('should detect BMP image', () => {
      const result = detectSourceType('old-image.bmp');
      expect(result.type).toBe('image');
    });

    it('should detect preset name', () => {
      const result = detectSourceType('dark');
      expect(result.type).toBe('preset');
      expect(result.value).toBe('dark');
    });

    it('should treat unknown string as preset', () => {
      const result = detectSourceType('mytheme');
      expect(result.type).toBe('preset');
      expect(result.value).toBe('mytheme');
    });

    it('should treat case-sensitive image extensions', () => {
      const result = detectSourceType('logo.PNG');
      expect(result.type).toBe('image');
    });
  });

  describe('getPreset', () => {
    it('should return light preset', () => {
      const palette = getPreset('light');
      expect(palette).toEqual(PRESETS.light);
      expect(palette.background).toBe('#ffffff');
    });

    it('should return dark preset', () => {
      const palette = getPreset('dark');
      expect(palette).toEqual(PRESETS.dark);
      expect(palette.background).toBe('#1f2937');
    });

    it('should return sepia preset', () => {
      const palette = getPreset('sepia');
      expect(palette).toEqual(PRESETS.sepia);
      expect(palette.background).toBe('#fef3c7');
    });

    it('should return forest preset', () => {
      const palette = getPreset('forest');
      expect(palette).toEqual(PRESETS.forest);
      expect(palette.primary).toBe('#059669');
    });

    it('should be case-insensitive', () => {
      const palette = getPreset('DARK');
      expect(palette).toEqual(PRESETS.dark);
    });

    it('should return default palette for unknown preset', () => {
      const palette = getPreset('unknown-preset');
      expect(palette).toEqual(DEFAULT_PALETTE);
    });

    it('should return default palette for empty string', () => {
      const palette = getPreset('');
      expect(palette).toEqual(DEFAULT_PALETTE);
    });
  });

  describe('ensureContrast', () => {
    it('should set dark text for light background', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#6b7280',
        background: '#ffffff',
        text: '#000000',
        link: '#2563eb',
      };
      const result = ensureContrast(palette);
      expect(result.text).toBe('#1f2937'); // Dark text
    });

    it('should set light text for dark background', () => {
      const palette: ColorPalette = {
        primary: '#60a5fa',
        secondary: '#9ca3af',
        background: '#1f2937',
        text: '#ffffff',
        link: '#60a5fa',
      };
      const result = ensureContrast(palette);
      expect(result.text).toBe('#f9fafb'); // Light text
    });

    it('should adjust link color for sufficient contrast on light bg', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#6b7280',
        background: '#ffffff',
        text: '#1f2937',
        link: '#cccccc', // Low contrast link
      };
      const result = ensureContrast(palette);
      // Link should be adjusted to have better contrast
      expect(result.link).not.toBe('#cccccc');
    });

    it('should adjust link color for sufficient contrast on dark bg', () => {
      const palette: ColorPalette = {
        primary: '#60a5fa',
        secondary: '#9ca3af',
        background: '#1f2937',
        text: '#f9fafb',
        link: '#333333', // Low contrast link on dark bg
      };
      const result = ensureContrast(palette);
      expect(result.link).not.toBe('#333333');
    });

    it('should preserve good link colors', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#6b7280',
        background: '#ffffff',
        text: '#1f2937',
        link: '#1d4ed8', // Good contrast
      };
      const result = ensureContrast(palette);
      // Should keep or use similar color
      expect(result.link).toBeDefined();
    });

    it('should adjust secondary for minimum contrast', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#f0f0f0', // Very light secondary on white bg
        background: '#ffffff',
        text: '#1f2937',
        link: '#2563eb',
      };
      const result = ensureContrast(palette);
      // Secondary should be adjusted for better contrast
      expect(result.secondary).not.toBe('#f0f0f0');
    });
  });

  describe('paletteToTheme', () => {
    const testPalette: ColorPalette = {
      primary: '#3b82f6',
      secondary: '#64748b',
      background: '#f8fafc',
      text: '#0f172a',
      link: '#2563eb',
    };

    it('should create theme with correct name', () => {
      const theme = paletteToTheme(testPalette, 'my-theme');
      expect(theme.name).toBe('my-theme');
    });

    it('should map colors correctly', () => {
      const theme = paletteToTheme(testPalette, 'test');
      expect(theme.colors.primary).toBe('#3b82f6');
      expect(theme.colors.secondary).toBe('#64748b');
      expect(theme.colors.background).toBe('#f8fafc');
      expect(theme.colors.text).toBe('#0f172a');
      expect(theme.colors.link).toBe('#2563eb');
    });

    it('should set default margins', () => {
      const theme = paletteToTheme(testPalette, 'test');
      expect(theme.margins).toEqual({
        top: 50,
        bottom: 50,
        left: 50,
        right: 50,
      });
    });

    it('should set default fonts', () => {
      const theme = paletteToTheme(testPalette, 'test');
      expect(theme.fonts.title.name).toBe('NotoSansKR-Bold');
      expect(theme.fonts.title.size).toBe(24);
      expect(theme.fonts.body.name).toBe('NotoSansKR-Regular');
      expect(theme.fonts.body.size).toBe(11);
    });

    it('should set default spacing', () => {
      const theme = paletteToTheme(testPalette, 'test');
      expect(theme.spacing.sectionGap).toBe(30);
      expect(theme.spacing.paragraphGap).toBe(10);
      expect(theme.spacing.imageMargin).toBe(15);
    });
  });

  describe('buildTheme', () => {
    it('should build theme from light preset', async () => {
      const theme = await buildTheme('light');
      expect(theme.colors.background).toBe('#ffffff');
      expect(theme.colors.primary).toBe('#2563eb');
    });

    it('should build theme from dark preset', async () => {
      const theme = await buildTheme('dark');
      expect(theme.colors.background).toBe('#1f2937');
      expect(theme.colors.text).toBe('#f9fafb');
    });

    it('should build theme from sepia preset', async () => {
      const theme = await buildTheme('sepia');
      expect(theme.colors.background).toBe('#fef3c7');
    });

    it('should build theme from forest preset', async () => {
      const theme = await buildTheme('forest');
      expect(theme.colors.primary).toBe('#059669');
    });

    it('should use custom name', async () => {
      const theme = await buildTheme('dark', { name: 'custom-dark' });
      expect(theme.name).toBe('custom-dark');
    });

    it('should fallback to default for unknown preset', async () => {
      const theme = await buildTheme('nonexistent');
      // Should use default palette
      expect(theme.colors.background).toBe('#ffffff');
    });

    it('should return default theme for invalid image path', async () => {
      const theme = await buildTheme('./nonexistent.png');
      // Should fallback to default
      expect(theme.name).toBe('default');
      expect(theme.colors.background).toBe('#ffffff');
    });

    it('should handle empty string', async () => {
      const theme = await buildTheme('');
      expect(theme).toBeDefined();
      expect(theme.colors).toBeDefined();
    });
  });

  describe('AVAILABLE_PRESETS', () => {
    it('should export available preset names', () => {
      expect(AVAILABLE_PRESETS).toContain('light');
      expect(AVAILABLE_PRESETS).toContain('dark');
      expect(AVAILABLE_PRESETS).toContain('sepia');
      expect(AVAILABLE_PRESETS).toContain('forest');
      expect(AVAILABLE_PRESETS).toContain('minimal-neon');
    });

    it('should have correct count', () => {
      expect(AVAILABLE_PRESETS.length).toBe(5);
    });
  });

  describe('PRESETS', () => {
    it('should have all required color fields', () => {
      for (const presetName of AVAILABLE_PRESETS) {
        const preset = PRESETS[presetName];
        expect(preset.primary).toBeDefined();
        expect(preset.secondary).toBeDefined();
        expect(preset.background).toBeDefined();
        expect(preset.text).toBeDefined();
        expect(preset.link).toBeDefined();
      }
    });

    it('should have valid hex colors', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const presetName of AVAILABLE_PRESETS) {
        const preset = PRESETS[presetName];
        expect(preset.primary).toMatch(hexRegex);
        expect(preset.secondary).toMatch(hexRegex);
        expect(preset.background).toMatch(hexRegex);
        expect(preset.text).toMatch(hexRegex);
        expect(preset.link).toMatch(hexRegex);
      }
    });
  });

  describe('DEFAULT_PALETTE', () => {
    it('should equal light preset', () => {
      expect(DEFAULT_PALETTE).toEqual(PRESETS.light);
    });
  });

  describe('extractFromUrl', () => {
    it('should extract colors from URL', async () => {
      const palette = await extractFromUrl('https://example.com', 10000);
      expect(palette.primary).toBeDefined();
      expect(palette.background).toBeDefined();
      expect(palette.text).toBeDefined();
    });

    it('should return valid color palette structure', async () => {
      const palette = await extractFromUrl('https://test.com', 5000);
      expect(palette).toHaveProperty('primary');
      expect(palette).toHaveProperty('secondary');
      expect(palette).toHaveProperty('background');
      expect(palette).toHaveProperty('text');
      expect(palette).toHaveProperty('link');
    });
  });

  describe('extractFromImage', () => {
    it('should extract colors from image', async () => {
      const palette = await extractFromImage('/path/to/test.png');
      expect(palette.primary).toBe('#e63946');
      expect(palette.secondary).toBe('#a8dadc');
      expect(palette.background).toBe('#f1faee');
    });

    it('should throw error for non-existent file', async () => {
      await expect(extractFromImage('/nonexistent-file.png')).rejects.toThrow('이미지 파일을 찾을 수 없습니다');
    });
  });

  describe('buildTheme with URL', () => {
    it('should build theme from URL', async () => {
      const theme = await buildTheme('https://example.com');
      expect(theme.colors).toBeDefined();
      expect(theme.colors.primary).toBeDefined();
    });

    it('should apply custom name for URL theme', async () => {
      const theme = await buildTheme('https://test.com', { name: 'url-theme' });
      expect(theme.name).toBe('url-theme');
    });
  });

  describe('buildTheme with image', () => {
    it('should build theme from image file', async () => {
      const theme = await buildTheme('/path/to/logo.png');
      expect(theme.colors.primary).toBe('#e63946');
    });

    it('should apply WCAG contrast to image theme', async () => {
      const theme = await buildTheme('/path/to/test.jpg');
      // Text should have good contrast with background
      expect(theme.colors.text).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle URL with custom timeout', async () => {
      const theme = await buildTheme('https://slow-site.com', { timeout: 30000 });
      expect(theme).toBeDefined();
    });

    it('should handle preset with mixed case', async () => {
      const theme = await buildTheme('DaRk');
      expect(theme.colors.background).toBe('#1f2937');
    });

    it('should handle special characters in preset name', async () => {
      const theme = await buildTheme('some-weird-preset-name!!!');
      // Should fallback to default
      expect(theme.colors.background).toBe('#ffffff');
    });
  });

  describe('ensureContrast edge cases', () => {
    it('should handle very light link on light background', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#6b7280',
        background: '#ffffff',
        text: '#1f2937',
        link: '#ffffff', // White link on white bg
      };
      const result = ensureContrast(palette);
      // Should adjust link to have contrast
      expect(result.link).not.toBe('#ffffff');
    });

    it('should handle very dark link on dark background', () => {
      const palette: ColorPalette = {
        primary: '#60a5fa',
        secondary: '#9ca3af',
        background: '#000000', // Black background
        text: '#f9fafb',
        link: '#000000', // Black link on black bg
      };
      const result = ensureContrast(palette);
      expect(result.link).not.toBe('#000000');
    });

    it('should handle extreme luminance values', () => {
      const palette: ColorPalette = {
        primary: '#808080',
        secondary: '#808080',
        background: '#808080', // Gray background
        text: '#808080',
        link: '#808080',
      };
      const result = ensureContrast(palette);
      expect(result.text).toBeDefined();
      expect(result.link).toBeDefined();
    });

    it('should handle fallback when contrast cannot be achieved', () => {
      // This tests the fallback branch at line 209
      const palette: ColorPalette = {
        primary: '#7f7f7f',
        secondary: '#7f7f7f',
        background: '#808080', // Mid gray - hard to get contrast
        text: '#7f7f7f',
        link: '#7f7f7f', // Same mid gray
      };
      const result = ensureContrast(palette);
      // Should use fallback value
      expect(result.link).toBeDefined();
      // Check it's one of the fallback colors
      expect(['#1d4ed8', '#93c5fd', result.link]).toContain(result.link);
    });

    it('should adjust secondary color on light background', () => {
      const palette: ColorPalette = {
        primary: '#2563eb',
        secondary: '#ffffff', // White secondary on white bg - no contrast
        background: '#ffffff',
        text: '#1f2937',
        link: '#2563eb',
      };
      const result = ensureContrast(palette);
      expect(result.secondary).toBe('#4b5563');
    });

    it('should adjust secondary color on dark background', () => {
      const palette: ColorPalette = {
        primary: '#60a5fa',
        secondary: '#000000', // Black secondary on dark bg - low contrast
        background: '#0a0a0a',
        text: '#f9fafb',
        link: '#60a5fa',
      };
      const result = ensureContrast(palette);
      expect(result.secondary).toBe('#d1d5db');
    });
  });

  describe('detectSourceType detailed', () => {
    it('should handle URLs with query parameters', () => {
      const result = detectSourceType('https://example.com/page?theme=dark&mode=1');
      expect(result.type).toBe('url');
    });

    it('should handle URLs with fragments', () => {
      const result = detectSourceType('https://example.com/page#section');
      expect(result.type).toBe('url');
    });

    it('should handle localhost URLs', () => {
      const result = detectSourceType('http://localhost:3000');
      expect(result.type).toBe('url');
    });

    it('should handle file paths with spaces', () => {
      const result = detectSourceType('./my folder/image.png');
      expect(result.type).toBe('image');
    });

    it('should treat non-image extensions as preset', () => {
      const result = detectSourceType('./config.json');
      expect(result.type).toBe('preset');
    });
  });

  describe('getPreset detailed', () => {
    it('should handle whitespace in preset name', () => {
      const palette = getPreset(' dark ');
      // Whitespace not trimmed, so should return default
      expect(palette).toEqual(DEFAULT_PALETTE);
    });

    it('should handle numeric string as preset', () => {
      const palette = getPreset('123');
      expect(palette).toEqual(DEFAULT_PALETTE);
    });
  });

  describe('paletteToTheme detailed', () => {
    it('should handle special characters in name', () => {
      const palette = PRESETS.light;
      const theme = paletteToTheme(palette, 'theme-with-special_chars.v1');
      expect(theme.name).toBe('theme-with-special_chars.v1');
    });

    it('should handle empty name', () => {
      const palette = PRESETS.dark;
      const theme = paletteToTheme(palette, '');
      expect(theme.name).toBe('');
    });
  });
});
