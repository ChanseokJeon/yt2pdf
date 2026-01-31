/**
 * Theme Builder - URL/이미지/프리셋에서 테마 자동 생성
 */

/// <reference lib="dom" />

import { Vibrant } from 'node-vibrant/node';
import chroma from 'chroma-js';
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { Theme } from './pdf-generator.js';

// 간단한 로거 (테스트 호환성을 위해 logger 의존성 제거)
const log = {
  info: (msg: string) => process.env.NODE_ENV !== 'test' && console.log(`[theme-builder] ${msg}`),
  warn: (msg: string) => process.env.NODE_ENV !== 'test' && console.warn(`[theme-builder] ${msg}`),
};

// ============================================
// Types
// ============================================

export type ThemeSourceType = 'url' | 'image' | 'preset';

export interface ThemeSource {
  type: ThemeSourceType;
  value: string;
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  link: string;
}

export interface ThemeBuilderOptions {
  name?: string;
  timeout?: number;
}

// ============================================
// Constants
// ============================================

const DEFAULT_TIMEOUT = 10000;

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;

const PRESETS: Record<string, ColorPalette> = {
  light: {
    primary: '#2563eb',
    secondary: '#6b7280',
    background: '#ffffff',
    text: '#1f2937',
    link: '#3b82f6',
  },
  dark: {
    primary: '#60a5fa',
    secondary: '#9ca3af',
    background: '#1f2937',
    text: '#f9fafb',
    link: '#93c5fd',
  },
  sepia: {
    primary: '#92400e',
    secondary: '#78716c',
    background: '#fef3c7',
    text: '#451a03',
    link: '#b45309',
  },
  forest: {
    primary: '#059669',
    secondary: '#6b7280',
    background: '#ecfdf5',
    text: '#064e3b',
    link: '#10b981',
  },
  'minimal-neon': {
    primary: '#22c55e',
    secondary: '#71717a',
    background: '#09090b',
    text: '#fafafa',
    link: '#3b82f6',
  },
};

const DEFAULT_PALETTE: ColorPalette = PRESETS.light;

// ============================================
// Source Detection
// ============================================

export function detectSourceType(input: string): ThemeSource {
  // URL 체크
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return { type: 'url', value: input };
  }

  // 이미지 파일 체크
  if (IMAGE_EXTENSIONS.test(input)) {
    if (fs.existsSync(input)) {
      return { type: 'image', value: input };
    }
    // 파일이 없어도 이미지 확장자면 image 타입으로 처리 (에러는 나중에)
    return { type: 'image', value: input };
  }

  // 그 외는 프리셋
  return { type: 'preset', value: input };
}

// ============================================
// Color Extractors
// ============================================

export async function extractFromImage(imagePath: string): Promise<ColorPalette> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`이미지 파일을 찾을 수 없습니다: ${imagePath}`);
  }

  const palette = await Vibrant.from(imagePath).getPalette();

  return {
    primary: palette.Vibrant?.hex || DEFAULT_PALETTE.primary,
    secondary: palette.Muted?.hex || DEFAULT_PALETTE.secondary,
    background: palette.LightMuted?.hex || DEFAULT_PALETTE.background,
    text: palette.DarkMuted?.hex || DEFAULT_PALETTE.text,
    link: palette.LightVibrant?.hex || DEFAULT_PALETTE.link,
  };
}

export async function extractFromUrl(url: string, timeout: number): Promise<ColorPalette> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    const colors = await page.evaluate(() => {
      const getStyle = (selector: string, prop: string): string => {
        const el = document.querySelector(selector);
        if (!el) return '';
        const style = getComputedStyle(el);
        return style.getPropertyValue(prop) || (style as unknown as Record<string, string>)[prop] || '';
      };

      const rgbToHex = (rgb: string): string => {
        if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return '';
        const match = rgb.match(/\d+/g);
        if (!match || match.length < 3) return '';
        const [r, g, b] = match.map(Number);
        return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
      };

      return {
        background: rgbToHex(getStyle('body', 'background-color')),
        text: rgbToHex(getStyle('body', 'color')),
        primary: rgbToHex(getStyle('a', 'color')),
        heading: rgbToHex(getStyle('h1, h2', 'color')),
      };
    });

    return {
      primary: colors.primary || colors.heading || DEFAULT_PALETTE.primary,
      secondary: colors.heading || DEFAULT_PALETTE.secondary,
      background: colors.background || DEFAULT_PALETTE.background,
      text: colors.text || DEFAULT_PALETTE.text,
      link: colors.primary || DEFAULT_PALETTE.link,
    };
  } finally {
    await browser.close();
  }
}

export function getPreset(name: string): ColorPalette {
  const preset = PRESETS[name.toLowerCase()];
  if (!preset) {
    log.warn(`알 수 없는 프리셋 '${name}'. 기본 테마를 사용합니다.`);
  }
  return preset || DEFAULT_PALETTE;
}

// ============================================
// WCAG Contrast Adjustment
// ============================================

export function ensureContrast(palette: ColorPalette): ColorPalette {
  const { background, primary } = palette;

  // 배경 명도 계산
  const bgLuminance = chroma(background).luminance();

  // 텍스트: 4.5:1 대비율 보장
  const text = bgLuminance > 0.5 ? '#1f2937' : '#f9fafb';

  // 링크: 대비율 부족시 명도 조정
  let link = palette.link || primary;
  let attempts = 0;
  const maxAttempts = 20;

  while (chroma.contrast(link, background) < 4.5 && attempts < maxAttempts) {
    const currentLum = chroma(link).luminance();
    const adjustment = bgLuminance > 0.5 ? -0.05 : 0.05;
    const newLum = Math.max(0.01, Math.min(0.99, currentLum + adjustment));
    link = chroma(link).luminance(newLum).hex();
    attempts++;
  }

  // 대비 확보 실패시 안전한 기본값
  if (chroma.contrast(link, background) < 4.5) {
    link = bgLuminance > 0.5 ? '#1d4ed8' : '#93c5fd';
  }

  // Secondary도 대비 확인
  let secondary = palette.secondary;
  if (chroma.contrast(secondary, background) < 3) {
    secondary = bgLuminance > 0.5 ? '#4b5563' : '#d1d5db';
  }

  return {
    ...palette,
    text,
    link,
    secondary,
  };
}

// ============================================
// Theme Builder
// ============================================

export function paletteToTheme(palette: ColorPalette, name: string): Theme {
  return {
    name,
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    fonts: {
      title: { name: 'NotoSansKR-Bold', size: 24 },
      heading: { name: 'NotoSansKR-Bold', size: 14 },
      body: { name: 'NotoSansKR-Regular', size: 11 },
      timestamp: { name: 'NotoSansKR-Regular', size: 10 },
    },
    colors: {
      primary: palette.primary,
      text: palette.text,
      secondary: palette.secondary,
      link: palette.link,
      background: palette.background,
    },
    spacing: {
      sectionGap: 30,
      paragraphGap: 10,
      imageMargin: 15,
    },
  };
}

// ============================================
// Public API
// ============================================

export async function buildTheme(
  source: string,
  options: ThemeBuilderOptions = {}
): Promise<Theme> {
  const { name = `extracted-${Date.now()}`, timeout = DEFAULT_TIMEOUT } = options;

  try {
    const sourceType = detectSourceType(source);
    let palette: ColorPalette;

    switch (sourceType.type) {
      case 'url':
        log.info(`URL에서 테마 추출 중: ${sourceType.value}`);
        palette = await extractFromUrl(sourceType.value, timeout);
        break;

      case 'image':
        log.info(`이미지에서 테마 추출 중: ${sourceType.value}`);
        palette = await extractFromImage(sourceType.value);
        break;

      case 'preset':
        log.info(`프리셋 테마 사용: ${sourceType.value}`);
        palette = getPreset(sourceType.value);
        break;
    }

    // WCAG 대비율 보정
    palette = ensureContrast(palette);

    log.info(`테마 추출 완료: primary=${palette.primary}, bg=${palette.background}`);
    return paletteToTheme(palette, name);
  } catch (error) {
    const err = error as Error;
    log.warn(`테마 추출 실패: ${err.message}. 기본 테마를 사용합니다.`);
    return paletteToTheme(DEFAULT_PALETTE, 'default');
  }
}

// ============================================
// Utility Exports (for testing)
// ============================================

export const AVAILABLE_PRESETS = Object.keys(PRESETS);
export { PRESETS, DEFAULT_PALETTE };
