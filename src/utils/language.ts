/**
 * Language Utility Module
 * Centralized language code mapping and utilities
 */

/**
 * ISO 639-1 language code to language name mapping
 */
export const LANGUAGE_MAP: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

/**
 * Convert language code to language name
 * @param code ISO 639-1 language code
 * @returns Language name in native language
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_MAP[code] || code;
}

/**
 * Check if the language code is Korean
 * @param code ISO 639-1 language code
 * @returns True if the code is 'ko'
 */
export function isKorean(code: string): boolean {
  return code === 'ko';
}

/**
 * Get all supported language codes
 * @returns Array of supported language codes
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_MAP);
}

/**
 * Check if a language code is supported
 * @param code ISO 639-1 language code
 * @returns True if the language is supported
 */
export function isLanguageSupported(code: string): boolean {
  return code in LANGUAGE_MAP;
}
