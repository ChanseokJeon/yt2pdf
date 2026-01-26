/**
 * 파일 유틸리티
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * 임시 디렉토리 생성
 */
export async function createTempDir(prefix = 'yt2pdf-'): Promise<string> {
  const tempDir = path.join(os.tmpdir(), prefix + Date.now().toString(36));
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * 디렉토리가 존재하는지 확인하고 없으면 생성
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 파일 존재 여부 확인
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 파일 크기 포맷팅
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 타임스탬프 포맷팅 (초 -> HH:MM:SS)
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 파일명에 사용할 수 없는 문자 제거
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200); // 최대 길이 제한
}

/**
 * 날짜 문자열 생성 (YYYYMMDD)
 */
export function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 파일명 패턴 적용
 * @param pattern - 패턴 문자열 (예: "{date}_{index}_{title}")
 * @param values - 치환할 값들
 */
export function applyFilenamePattern(
  pattern: string,
  values: Record<string, string | number>
): string {
  let result = pattern;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return sanitizeFilename(result);
}

/**
 * 디렉토리 정리 (임시 파일 삭제)
 */
export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // 무시
  }
}

/**
 * 파일 크기 조회
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}
