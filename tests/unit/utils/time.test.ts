/**
 * 시간 유틸리티 테스트
 */

import {
  formatTimestamp,
  parseTimestamp,
  getDuration,
  formatDuration,
  isValidTimestamp,
} from '../../../src/utils/time';

describe('formatTimestamp', () => {
  it('should format seconds less than 1 minute', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(30)).toBe('00:30');
    expect(formatTimestamp(59)).toBe('00:59');
  });

  it('should format seconds less than 1 hour', () => {
    expect(formatTimestamp(60)).toBe('01:00');
    expect(formatTimestamp(65)).toBe('01:05');
    expect(formatTimestamp(120)).toBe('02:00');
    expect(formatTimestamp(599)).toBe('09:59');
    expect(formatTimestamp(3599)).toBe('59:59');
  });

  it('should format seconds with hours', () => {
    expect(formatTimestamp(3600)).toBe('01:00:00');
    expect(formatTimestamp(3665)).toBe('01:01:05');
    expect(formatTimestamp(7200)).toBe('02:00:00');
    expect(formatTimestamp(7385)).toBe('02:03:05');
  });

  it('should handle large values', () => {
    expect(formatTimestamp(36000)).toBe('10:00:00');
    expect(formatTimestamp(86399)).toBe('23:59:59');
    expect(formatTimestamp(86400)).toBe('24:00:00');
  });

  it('should handle edge cases', () => {
    expect(formatTimestamp(0.5)).toBe('00:00'); // Fractional seconds
    expect(formatTimestamp(1.9)).toBe('00:01'); // Rounds down
  });
});

describe('parseTimestamp', () => {
  it('should parse MM:SS format', () => {
    expect(parseTimestamp('00:00')).toBe(0);
    expect(parseTimestamp('00:30')).toBe(30);
    expect(parseTimestamp('01:05')).toBe(65);
    expect(parseTimestamp('02:00')).toBe(120);
    expect(parseTimestamp('59:59')).toBe(3599);
  });

  it('should parse HH:MM:SS format', () => {
    expect(parseTimestamp('01:00:00')).toBe(3600);
    expect(parseTimestamp('01:01:05')).toBe(3665);
    expect(parseTimestamp('02:03:05')).toBe(7385);
    expect(parseTimestamp('10:00:00')).toBe(36000);
  });

  it('should handle single digit values', () => {
    expect(parseTimestamp('1:5')).toBe(65);
    expect(parseTimestamp('1:1:5')).toBe(3665);
  });

  it('should throw on invalid format', () => {
    expect(() => parseTimestamp('invalid')).toThrow('Invalid timestamp format');
    expect(() => parseTimestamp('1:2:3:4')).toThrow('Invalid timestamp format');
    expect(() => parseTimestamp('1')).toThrow('Invalid timestamp format');
    expect(() => parseTimestamp('')).toThrow('Invalid timestamp format');
    expect(() => parseTimestamp('aa:bb')).toThrow('Invalid timestamp format');
  });
});

describe('round-trip conversion', () => {
  it('should maintain consistency for MM:SS format', () => {
    const testCases = [0, 30, 65, 120, 599, 3599];

    testCases.forEach((seconds) => {
      const formatted = formatTimestamp(seconds);
      const parsed = parseTimestamp(formatted);
      expect(parsed).toBe(seconds);
    });
  });

  it('should maintain consistency for HH:MM:SS format', () => {
    const testCases = [3600, 3665, 7385, 36000, 86399];

    testCases.forEach((seconds) => {
      const formatted = formatTimestamp(seconds);
      const parsed = parseTimestamp(formatted);
      expect(parsed).toBe(seconds);
    });
  });
});

describe('getDuration', () => {
  it('should calculate duration correctly', () => {
    expect(getDuration(0, 65)).toBe(65);
    expect(getDuration(60, 120)).toBe(60);
    expect(getDuration(0, 3600)).toBe(3600);
  });

  it('should handle zero duration', () => {
    expect(getDuration(0, 0)).toBe(0);
    expect(getDuration(100, 100)).toBe(0);
  });

  it('should throw when end is before start', () => {
    expect(() => getDuration(100, 50)).toThrow('cannot be before start time');
    expect(() => getDuration(60, 0)).toThrow('cannot be before start time');
  });
});

describe('formatDuration', () => {
  it('should format duration with only seconds', () => {
    expect(formatDuration(0)).toBe('0초');
    expect(formatDuration(30)).toBe('30초');
    expect(formatDuration(59)).toBe('59초');
  });

  it('should format duration with minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1분 0초');
    expect(formatDuration(65)).toBe('1분 5초');
    expect(formatDuration(120)).toBe('2분 0초');
    expect(formatDuration(125)).toBe('2분 5초');
  });

  it('should format duration with hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1시간 0초');
    expect(formatDuration(3660)).toBe('1시간 1분');
    expect(formatDuration(3665)).toBe('1시간 1분 5초');
    expect(formatDuration(7200)).toBe('2시간 0초');
  });

  it('should omit zero components when possible', () => {
    expect(formatDuration(3600)).toBe('1시간 0초');
    expect(formatDuration(60)).toBe('1분 0초');
    expect(formatDuration(3605)).toBe('1시간 5초');
  });

  it('should handle large durations', () => {
    expect(formatDuration(86400)).toBe('24시간 0초');
    expect(formatDuration(90000)).toBe('25시간 0초');
  });
});

describe('isValidTimestamp', () => {
  it('should return true for valid timestamps', () => {
    expect(isValidTimestamp('00:00')).toBe(true);
    expect(isValidTimestamp('01:05')).toBe(true);
    expect(isValidTimestamp('59:59')).toBe(true);
    expect(isValidTimestamp('01:00:00')).toBe(true);
    expect(isValidTimestamp('10:30:45')).toBe(true);
  });

  it('should return false for invalid timestamps', () => {
    expect(isValidTimestamp('invalid')).toBe(false);
    expect(isValidTimestamp('1:2:3:4')).toBe(false);
    expect(isValidTimestamp('1')).toBe(false);
    expect(isValidTimestamp('')).toBe(false);
    expect(isValidTimestamp('aa:bb')).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle negative values in formatTimestamp', () => {
    // Negative values produce negative floor results
    // Math.floor(-1 % 60) = Math.floor(-1) = -1
    expect(formatTimestamp(-1)).toBe('-1:-1');
    expect(formatTimestamp(-65)).toBe('-2:-5');
  });

  it('should handle very large values', () => {
    const largeValue = 999999;
    const formatted = formatTimestamp(largeValue);
    const parsed = parseTimestamp(formatted);
    expect(parsed).toBe(largeValue);
  });

  it('should handle fractional seconds', () => {
    expect(formatTimestamp(65.7)).toBe('01:05');
    expect(formatTimestamp(65.2)).toBe('01:05');
  });
});
