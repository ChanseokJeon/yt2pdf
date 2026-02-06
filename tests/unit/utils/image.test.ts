/**
 * 이미지 유틸리티 테스트
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import {
  downloadImageToBuffer,
  getFontsDir,
  hasKoreanFonts,
  validateKoreanFont,
  getKoreanFontPaths,
} from '../../../src/utils/image';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock http/https
jest.mock('http');
jest.mock('https');
const mockHttp = http as jest.Mocked<typeof http>;
const mockHttps = https as jest.Mocked<typeof https>;

describe('Image Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('downloadImageToBuffer', () => {
    it('should download image successfully via HTTPS', async () => {
      const mockData = Buffer.from('image data');
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(mockData);
          } else if (event === 'end') {
            handler();
          }
          return mockResponse;
        }),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation((url, callback) => {
        callback(mockResponse as any);
        return mockRequest as any;
      });

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toEqual(mockData);
      expect(mockHttps.get).toHaveBeenCalledWith('https://example.com/image.jpg', expect.any(Function));
    });

    it('should download image successfully via HTTP', async () => {
      const mockData = Buffer.from('image data');
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(mockData);
          } else if (event === 'end') {
            handler();
          }
          return mockResponse;
        }),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttp.get.mockImplementation((url, callback) => {
        callback(mockResponse as any);
        return mockRequest as any;
      });

      const result = await downloadImageToBuffer('http://example.com/image.jpg');
      expect(result).toEqual(mockData);
      expect(mockHttp.get).toHaveBeenCalledWith('http://example.com/image.jpg', expect.any(Function));
    });

    it('should handle HTTP redirect (301)', async () => {
      const mockData = Buffer.from('image data');
      const mockRedirectResponse = {
        statusCode: 301,
        headers: { location: 'https://example.com/redirected.jpg' },
        on: jest.fn().mockReturnThis(),
      };
      const mockFinalResponse = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(mockData);
          } else if (event === 'end') {
            handler();
          }
          return mockFinalResponse;
        }),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get
        .mockImplementationOnce((url, callback) => {
          callback(mockRedirectResponse as any);
          return mockRequest as any;
        })
        .mockImplementationOnce((url, callback) => {
          callback(mockFinalResponse as any);
          return mockRequest as any;
        });

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toEqual(mockData);
      expect(mockHttps.get).toHaveBeenCalledTimes(2);
    });

    it('should handle HTTP redirect (302)', async () => {
      const mockData = Buffer.from('image data');
      const mockRedirectResponse = {
        statusCode: 302,
        headers: { location: 'https://example.com/redirected.jpg' },
        on: jest.fn().mockReturnThis(),
      };
      const mockFinalResponse = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(mockData);
          } else if (event === 'end') {
            handler();
          }
          return mockFinalResponse;
        }),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get
        .mockImplementationOnce((url, callback) => {
          callback(mockRedirectResponse as any);
          return mockRequest as any;
        })
        .mockImplementationOnce((url, callback) => {
          callback(mockFinalResponse as any);
          return mockRequest as any;
        });

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toEqual(mockData);
      expect(mockHttps.get).toHaveBeenCalledTimes(2);
    });

    it('should return null for non-200 status code', async () => {
      const mockResponse = {
        statusCode: 404,
        on: jest.fn().mockReturnThis(),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation((url, callback) => {
        callback(mockResponse as any);
        return mockRequest as any;
      });

      const result = await downloadImageToBuffer('https://example.com/notfound.jpg');
      expect(result).toBeNull();
    });

    it('should return null on request error', async () => {
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Network error'));
          }
          return mockRequest;
        }),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation(() => mockRequest as any);

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toBeNull();
    });

    it('should handle timeout', async () => {
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn((timeout, handler) => {
          handler();
          return mockRequest;
        }),
        destroy: jest.fn(),
      };

      mockHttps.get.mockImplementation(() => mockRequest as any);

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toBeNull();
      expect(mockRequest.setTimeout).toHaveBeenCalledWith(10000, expect.any(Function));
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('should return null on response error', async () => {
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Response error'));
          }
          return mockResponse;
        }),
      };
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation((url, callback) => {
        callback(mockResponse as any);
        return mockRequest as any;
      });

      const result = await downloadImageToBuffer('https://example.com/image.jpg');
      expect(result).toBeNull();
    });
  });

  describe('getFontsDir', () => {
    it('should return first existing path', () => {
      mockFs.existsSync.mockImplementation((p) => {
        return p === path.resolve(process.cwd(), 'assets/fonts');
      });

      const result = getFontsDir();
      expect(result).toBe(path.resolve(process.cwd(), 'assets/fonts'));
    });

    it('should try multiple paths', () => {
      mockFs.existsSync.mockImplementation((p) => {
        return p === path.resolve(__dirname, '../../assets/fonts');
      });

      const result = getFontsDir();
      expect(mockFs.existsSync).toHaveBeenCalledWith(path.resolve(process.cwd(), 'assets/fonts'));
    });

    it('should return default path if none exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getFontsDir();
      expect(result).toBe(path.resolve(process.cwd(), 'assets/fonts'));
    });
  });

  describe('hasKoreanFonts', () => {
    it('should return true if both fonts exist', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = hasKoreanFonts();
      expect(result).toBe(true);
    });

    it('should return false if fonts do not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = hasKoreanFonts();
      expect(result).toBe(false);
    });

    it('should return false on error', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      const result = hasKoreanFonts();
      expect(result).toBe(false);
    });
  });

  describe('validateKoreanFont', () => {
    it('should return true if fonts exist and are TTF', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = validateKoreanFont();
      expect(result).toBe(true);
    });

    it('should return true if fonts exist (regardless of extension)', () => {
      // Note: OTF warning is handled by the caller (registerFonts in PDFGenerator)
      // This function only validates existence, not extension
      mockFs.existsSync.mockReturnValue(true);

      const result = validateKoreanFont();
      expect(result).toBe(true);
    });

    it('should return false if fonts do not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = validateKoreanFont();
      expect(result).toBe(false);
    });
  });

  describe('getKoreanFontPaths', () => {
    it('should return correct font paths', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = getKoreanFontPaths();
      const fontsDir = getFontsDir();
      expect(result.regular).toBe(path.join(fontsDir, 'NotoSansKR-Regular.ttf'));
      expect(result.bold).toBe(path.join(fontsDir, 'NotoSansKR-Bold.ttf'));
    });

    it('should return paths even if fonts do not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getKoreanFontPaths();
      expect(result.regular).toContain('NotoSansKR-Regular.ttf');
      expect(result.bold).toContain('NotoSansKR-Bold.ttf');
    });
  });
});
