/**
 * Proxy URL validation tests
 */

import { validateProxyUrl, getValidatedProxyUrl, isYouTubeIpBlock } from '../../../src/utils/proxy';

describe('proxy validation', () => {
  describe('validateProxyUrl', () => {
    it('should accept valid http proxy URL', () => {
      expect(validateProxyUrl('http://proxy.example.com:8080')).toBe(true);
    });

    it('should accept valid https proxy URL', () => {
      expect(validateProxyUrl('https://proxy.example.com:8080')).toBe(true);
    });

    it('should accept valid socks4 proxy URL', () => {
      expect(validateProxyUrl('socks4://proxy.example.com:1080')).toBe(true);
    });

    it('should accept valid socks5 proxy URL', () => {
      expect(validateProxyUrl('socks5://proxy.example.com:1080')).toBe(true);
    });

    it('should accept valid socks4a proxy URL', () => {
      expect(validateProxyUrl('socks4a://proxy.example.com:1080')).toBe(true);
    });

    it('should accept valid socks5h proxy URL', () => {
      expect(validateProxyUrl('socks5h://proxy.example.com:7000')).toBe(true);
    });

    it('should accept URL with port number', () => {
      expect(validateProxyUrl('http://proxy.example.com:3128')).toBe(true);
    });

    it('should accept URL with authentication', () => {
      expect(validateProxyUrl('http://user:pass@proxy.example.com:8080')).toBe(true);
    });

    it('should reject invalid protocol (ftp)', () => {
      expect(validateProxyUrl('ftp://proxy.example.com:21')).toBe(false);
    });

    it('should reject not a URL', () => {
      expect(validateProxyUrl('not-a-url')).toBe(false);
    });

    it('should reject URL with shell metacharacters', () => {
      expect(validateProxyUrl('http://proxy.example.com; rm -rf /')).toBe(false);
    });

    it('should reject URL without hostname', () => {
      expect(validateProxyUrl('http://:8080')).toBe(false);
    });
  });

  describe('getValidatedProxyUrl', () => {
    it('should return undefined for empty string', () => {
      expect(getValidatedProxyUrl('')).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(getValidatedProxyUrl(undefined)).toBeUndefined();
    });

    it('should return trimmed and validated URL', () => {
      expect(getValidatedProxyUrl('  http://proxy.example.com:8080  ')).toBe(
        'http://proxy.example.com:8080'
      );
    });

    it('should return undefined for invalid URL', () => {
      expect(getValidatedProxyUrl('not-a-url')).toBeUndefined();
    });

    it('should return undefined for whitespace-only string', () => {
      expect(getValidatedProxyUrl('   ')).toBeUndefined();
    });

    it('should return valid URL as-is', () => {
      const validUrl = 'http://proxy.example.com:8080';
      expect(getValidatedProxyUrl(validUrl)).toBe(validUrl);
    });
  });

  describe('isYouTubeIpBlock', () => {
    it('should detect "Sign in to confirm" pattern', () => {
      expect(isYouTubeIpBlock('ERROR: Sign in to confirm you\'re not a bot')).toBe(true);
    });

    it('should detect alternate "Sign in to confirm" pattern', () => {
      expect(isYouTubeIpBlock('Sign in to confirm that you\'re not a bot')).toBe(true);
    });

    it('should detect HTTP 403 pattern', () => {
      expect(isYouTubeIpBlock('HTTP Error 403: Forbidden')).toBe(true);
    });

    it('should detect HTTP 429 pattern', () => {
      expect(isYouTubeIpBlock('HTTP Error 429: Too Many Requests')).toBe(true);
    });

    it('should detect bot detection pattern', () => {
      expect(isYouTubeIpBlock('This request was detected as a bot')).toBe(true);
    });

    it('should detect "Please sign in" pattern', () => {
      expect(isYouTubeIpBlock('Please sign in to continue')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isYouTubeIpBlock('SIGN IN TO CONFIRM YOU\'RE NOT A BOT')).toBe(true);
    });

    it('should return false for unrelated errors', () => {
      expect(isYouTubeIpBlock('Video unavailable')).toBe(false);
      expect(isYouTubeIpBlock('command not found: yt-dlp')).toBe(false);
      expect(isYouTubeIpBlock('Network timeout')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isYouTubeIpBlock('')).toBe(false);
    });
  });
});
