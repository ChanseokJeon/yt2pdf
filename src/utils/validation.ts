/**
 * 입력 유효성 검사 유틸리티
 */

import { OutputFormat, PDFLayout, ImageQuality } from '../types/config.js';
import { isValidYouTubeUrl } from './url.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * YouTube URL 유효성 검사
 */
export function validateYouTubeUrl(url: string | undefined): ValidationResult {
  const errors: string[] = [];

  if (!url || typeof url !== 'string') {
    errors.push('YouTube URL이 필요합니다.');
    return { valid: false, errors };
  }

  if (!url.trim()) {
    errors.push('YouTube URL이 비어있습니다.');
    return { valid: false, errors };
  }

  if (!isValidYouTubeUrl(url)) {
    errors.push('유효하지 않은 YouTube URL입니다. youtube.com 또는 youtu.be URL을 입력하세요.');
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * 출력 형식 유효성 검사
 */
export function validateOutputFormat(format: string | undefined): ValidationResult {
  const validFormats: OutputFormat[] = ['pdf', 'md', 'html', 'brief'];

  if (!format) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  if (!validFormats.includes(format as OutputFormat)) {
    return {
      valid: false,
      errors: [`유효하지 않은 출력 형식입니다: ${format}. 가능한 값: ${validFormats.join(', ')}`],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * PDF 레이아웃 유효성 검사
 */
export function validatePDFLayout(layout: string | undefined): ValidationResult {
  const validLayouts: PDFLayout[] = ['vertical', 'horizontal', 'minimal-neon'];

  if (!layout) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  if (!validLayouts.includes(layout as PDFLayout)) {
    return {
      valid: false,
      errors: [`유효하지 않은 레이아웃입니다: ${layout}. 가능한 값: ${validLayouts.join(', ')}`],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * 이미지 품질 유효성 검사
 */
export function validateImageQuality(quality: string | undefined): ValidationResult {
  const validQualities: ImageQuality[] = ['low', 'high'];

  if (!quality) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  if (!validQualities.includes(quality as ImageQuality)) {
    return {
      valid: false,
      errors: [
        `유효하지 않은 이미지 품질입니다: ${quality}. 가능한 값: ${validQualities.join(', ')}`,
      ],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * 스크린샷 간격 유효성 검사
 */
export function validateInterval(interval: string | number | undefined): ValidationResult {
  if (interval === undefined) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  const num = typeof interval === 'string' ? parseInt(interval, 10) : interval;

  if (isNaN(num)) {
    return {
      valid: false,
      errors: [`스크린샷 간격은 숫자여야 합니다: ${interval}`],
    };
  }

  if (num < 5) {
    return {
      valid: false,
      errors: ['스크린샷 간격은 최소 5초 이상이어야 합니다.'],
    };
  }

  if (num > 600) {
    return {
      valid: false,
      errors: ['스크린샷 간격은 최대 600초(10분)까지 설정할 수 있습니다.'],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * 언어 코드 유효성 검사
 */
export function validateLanguageCode(lang: string | undefined): ValidationResult {
  if (!lang) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  // ISO 639-1 형식 검사 (2글자)
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
    return {
      valid: false,
      errors: [`유효하지 않은 언어 코드입니다: ${lang}. 예: ko, en, ja, zh-CN`],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * 출력 경로 유효성 검사
 */
export function validateOutputPath(outputPath: string | undefined): ValidationResult {
  if (!outputPath) {
    return { valid: true, errors: [] }; // 기본값 사용
  }

  // 기본적인 경로 유효성 검사
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(outputPath)) {
    return {
      valid: false,
      errors: ['출력 경로에 유효하지 않은 문자가 포함되어 있습니다.'],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * 모든 CLI 옵션 유효성 검사
 */
export function validateCLIOptions(options: {
  url?: string;
  format?: string;
  layout?: string;
  quality?: string;
  interval?: string | number;
  lang?: string;
  output?: string;
}): ValidationResult {
  const allErrors: string[] = [];

  const validations = [
    validateYouTubeUrl(options.url),
    validateOutputFormat(options.format),
    validatePDFLayout(options.layout),
    validateImageQuality(options.quality),
    validateInterval(options.interval),
    validateLanguageCode(options.lang),
    validateOutputPath(options.output),
  ];

  for (const result of validations) {
    if (!result.valid) {
      allErrors.push(...result.errors);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}
