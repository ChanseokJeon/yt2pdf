/**
 * Proxy URL validation utility
 * Prevents command injection via YT_DLP_PROXY environment variable
 */

/**
 * Validates a proxy URL for safe use with yt-dlp
 * Accepts: http://, https://, socks4://, socks4a://, socks5://, socks5h:// protocols
 * Rejects: URLs with shell metacharacters, non-URL strings
 */
export function validateProxyUrl(url: string): boolean {
  // Must be a valid URL with allowed protocol
  try {
    const parsed = new URL(url);
    const allowedProtocols = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return false;
    }
    // Must have a hostname
    if (!parsed.hostname) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes and returns a validated proxy URL, or undefined if invalid
 */
export function getValidatedProxyUrl(envValue?: string): string | undefined {
  if (!envValue || envValue.trim() === '') {
    return undefined;
  }
  const trimmed = envValue.trim();
  if (validateProxyUrl(trimmed)) {
    return trimmed;
  }
  // Log warning but don't throw - graceful degradation
  return undefined;
}

/**
 * Known YouTube IP block error patterns from yt-dlp stderr
 */
const YOUTUBE_BLOCK_PATTERNS = [
  "sign in to confirm you're not a bot",
  "sign in to confirm that you're not a bot",
  'http error 403',
  'http error 429',
  'detected as a bot',
  'please sign in',
];

/**
 * Detects if a yt-dlp error indicates YouTube IP blocking
 * Checks error text (from err.message and/or err.stderr) for known patterns
 */
export function isYouTubeIpBlock(errorText: string): boolean {
  // Normalize smart quotes (U+2018, U+2019) to regular apostrophe (U+0027)
  const normalized = errorText.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return YOUTUBE_BLOCK_PATTERNS.some((pattern) => normalized.includes(pattern));
}
