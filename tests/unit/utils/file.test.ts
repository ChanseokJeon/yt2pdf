/**
 * 파일 유틸리티 테스트
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  formatBytes,
  formatTimestamp,
  sanitizeFilename,
  getDateString,
  applyFilenamePattern,
  createTempDir,
  ensureDir,
  fileExists,
  cleanupDir,
  getFileSize,
} from '../../../src/utils/file';

describe('File Utils', () => {
  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should respect decimal places', () => {
      expect(formatBytes(1536, 1)).toBe('1.5 KB');
      expect(formatBytes(1536, 0)).toBe('2 KB');
    });
  });

  describe('formatTimestamp', () => {
    it('should format seconds to MM:SS', () => {
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(65)).toBe('01:05');
      expect(formatTimestamp(599)).toBe('09:59');
    });

    it('should format hours when needed', () => {
      expect(formatTimestamp(3600)).toBe('01:00:00');
      expect(formatTimestamp(3661)).toBe('01:01:01');
      expect(formatTimestamp(7261)).toBe('02:01:01');
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove invalid characters', () => {
      expect(sanitizeFilename('test<>:"/\\|?*file')).toBe('testfile');
    });

    it('should replace spaces with underscores', () => {
      expect(sanitizeFilename('my file name')).toBe('my_file_name');
    });

    it('should truncate long filenames', () => {
      const longName = 'a'.repeat(250);
      expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
    });
  });

  describe('getDateString', () => {
    it('should return date in YYYYMMDD format', () => {
      const dateStr = getDateString();
      expect(dateStr).toMatch(/^\d{8}$/);
    });
  });

  describe('applyFilenamePattern', () => {
    it('should apply pattern correctly', () => {
      const result = applyFilenamePattern('{date}_{index}_{title}', {
        date: '20250101',
        index: '001',
        title: 'My Video',
      });
      expect(result).toBe('20250101_001_My_Video');
    });

    it('should handle multiple occurrences', () => {
      const result = applyFilenamePattern('{a}_{a}_{b}', {
        a: 'x',
        b: 'y',
      });
      expect(result).toBe('x_x_y');
    });
  });

  describe('createTempDir', () => {
    it('should create a temporary directory', async () => {
      const tempDir = await createTempDir('test-');
      expect(tempDir).toContain('test-');

      const stat = await fs.stat(tempDir);
      expect(stat.isDirectory()).toBe(true);

      // Cleanup
      await fs.rm(tempDir, { recursive: true });
    });
  });

  describe('ensureDir', () => {
    it('should create directory if not exists', async () => {
      const testDir = path.join(os.tmpdir(), `yt2pdf-test-${Date.now()}`);

      await ensureDir(testDir);

      const stat = await fs.stat(testDir);
      expect(stat.isDirectory()).toBe(true);

      // Cleanup
      await fs.rm(testDir, { recursive: true });
    });

    it('should not throw if directory exists', async () => {
      const testDir = path.join(os.tmpdir(), `yt2pdf-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });

      await expect(ensureDir(testDir)).resolves.not.toThrow();

      // Cleanup
      await fs.rm(testDir, { recursive: true });
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const testFile = path.join(os.tmpdir(), `yt2pdf-test-${Date.now()}.txt`);
      await fs.writeFile(testFile, 'test');

      const exists = await fileExists(testFile);
      expect(exists).toBe(true);

      // Cleanup
      await fs.rm(testFile);
    });

    it('should return false for non-existing file', async () => {
      const exists = await fileExists('/non/existing/file.txt');
      expect(exists).toBe(false);
    });
  });

  describe('cleanupDir', () => {
    it('should remove directory and contents', async () => {
      const testDir = path.join(os.tmpdir(), `yt2pdf-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'test.txt'), 'test');

      await cleanupDir(testDir);

      const exists = await fileExists(testDir);
      expect(exists).toBe(false);
    });

    it('should not throw for non-existing directory', async () => {
      await expect(cleanupDir('/non/existing/dir')).resolves.not.toThrow();
    });
  });

  describe('getFileSize', () => {
    it('should return file size in bytes', async () => {
      const testFile = path.join(os.tmpdir(), `yt2pdf-test-${Date.now()}.txt`);
      const content = 'Hello, World!';
      await fs.writeFile(testFile, content);

      const size = await getFileSize(testFile);
      expect(size).toBe(Buffer.byteLength(content));

      // Cleanup
      await fs.rm(testFile);
    });
  });
});
