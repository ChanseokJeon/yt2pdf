/**
 * Tests for Language Utility Module
 */

import { describe, it, expect } from '@jest/globals';
import {
  LANGUAGE_MAP,
  getLanguageName,
  isKorean,
  getSupportedLanguages,
  isLanguageSupported,
} from '../../../src/utils/language.js';

describe('LANGUAGE_MAP', () => {
  it('should contain all expected languages', () => {
    expect(LANGUAGE_MAP).toHaveProperty('ko');
    expect(LANGUAGE_MAP).toHaveProperty('en');
    expect(LANGUAGE_MAP).toHaveProperty('ja');
    expect(LANGUAGE_MAP).toHaveProperty('zh');
    expect(LANGUAGE_MAP).toHaveProperty('es');
    expect(LANGUAGE_MAP).toHaveProperty('fr');
    expect(LANGUAGE_MAP).toHaveProperty('de');
  });

  it('should have correct language names', () => {
    expect(LANGUAGE_MAP.ko).toBe('한국어');
    expect(LANGUAGE_MAP.en).toBe('English');
    expect(LANGUAGE_MAP.ja).toBe('日本語');
    expect(LANGUAGE_MAP.zh).toBe('中文');
    expect(LANGUAGE_MAP.es).toBe('Español');
    expect(LANGUAGE_MAP.fr).toBe('Français');
    expect(LANGUAGE_MAP.de).toBe('Deutsch');
  });
});

describe('getLanguageName', () => {
  it('should return language name for known code', () => {
    expect(getLanguageName('ko')).toBe('한국어');
    expect(getLanguageName('en')).toBe('English');
    expect(getLanguageName('ja')).toBe('日本語');
    expect(getLanguageName('zh')).toBe('中文');
  });

  it('should return the code itself for unknown code', () => {
    expect(getLanguageName('unknown')).toBe('unknown');
    expect(getLanguageName('xyz')).toBe('xyz');
    expect(getLanguageName('')).toBe('');
  });

  it('should be case-sensitive', () => {
    expect(getLanguageName('KO')).toBe('KO'); // Not 'ko', returns as-is
    expect(getLanguageName('En')).toBe('En'); // Not 'en', returns as-is
  });
});

describe('isKorean', () => {
  it('should return true for Korean code', () => {
    expect(isKorean('ko')).toBe(true);
  });

  it('should return false for non-Korean codes', () => {
    expect(isKorean('en')).toBe(false);
    expect(isKorean('ja')).toBe(false);
    expect(isKorean('zh')).toBe(false);
    expect(isKorean('unknown')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(isKorean('KO')).toBe(false);
    expect(isKorean('Ko')).toBe(false);
  });
});

describe('getSupportedLanguages', () => {
  it('should return array of language codes', () => {
    const languages = getSupportedLanguages();
    expect(Array.isArray(languages)).toBe(true);
    expect(languages.length).toBeGreaterThan(0);
  });

  it('should include all expected language codes', () => {
    const languages = getSupportedLanguages();
    expect(languages).toContain('ko');
    expect(languages).toContain('en');
    expect(languages).toContain('ja');
    expect(languages).toContain('zh');
    expect(languages).toContain('es');
    expect(languages).toContain('fr');
    expect(languages).toContain('de');
  });

  it('should return at least 7 languages', () => {
    const languages = getSupportedLanguages();
    expect(languages.length).toBeGreaterThanOrEqual(7);
  });
});

describe('isLanguageSupported', () => {
  it('should return true for supported languages', () => {
    expect(isLanguageSupported('ko')).toBe(true);
    expect(isLanguageSupported('en')).toBe(true);
    expect(isLanguageSupported('ja')).toBe(true);
    expect(isLanguageSupported('zh')).toBe(true);
    expect(isLanguageSupported('es')).toBe(true);
    expect(isLanguageSupported('fr')).toBe(true);
    expect(isLanguageSupported('de')).toBe(true);
  });

  it('should return false for unsupported languages', () => {
    expect(isLanguageSupported('unknown')).toBe(false);
    expect(isLanguageSupported('xyz')).toBe(false);
    expect(isLanguageSupported('')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(isLanguageSupported('KO')).toBe(false);
    expect(isLanguageSupported('EN')).toBe(false);
  });
});
