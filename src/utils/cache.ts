/**
 * 캐시 관리자
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './logger.js';

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export interface CacheStats {
  size: number;
  entries: number;
}

export class CacheManager {
  private cacheDir: string;
  private ttlMs: number;
  private initialized = false;

  constructor(cacheDir?: string, ttlDays: number = 7) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.cacheDir = cacheDir || path.join(home, '.cache', 'yt2pdf');
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  }

  /**
   * 캐시 디렉토리 초기화
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.initialized = true;
    logger.debug(`캐시 디렉토리 초기화: ${this.cacheDir}`);
  }

  /**
   * 캐시 키 생성
   */
  generateKey(url: string, options?: object): string {
    const data = JSON.stringify({ url, options: options || {} });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 캐시에서 값 가져오기
   */
  async get<T>(key: string): Promise<T | null> {
    await this.init();

    try {
      const filePath = this.getFilePath(key);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // 만료 확인
      if (Date.now() > entry.expiresAt) {
        await this.delete(key);
        logger.debug(`캐시 만료: ${key}`);
        return null;
      }

      logger.debug(`캐시 히트: ${key}`);
      return entry.value;
    } catch {
      return null;
    }
  }

  /**
   * 캐시에 값 저장
   */
  async set<T>(key: string, value: T): Promise<void> {
    await this.init();

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    };

    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
    logger.debug(`캐시 저장: ${key}`);
  }

  /**
   * 캐시 존재 여부 확인
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * 캐시 항목 삭제
   */
  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
      logger.debug(`캐시 삭제: ${key}`);
    } catch {
      // 파일이 없어도 무시
    }
  }

  /**
   * 전체 캐시 삭제
   */
  async clear(): Promise<void> {
    await this.init();

    const files = await fs.readdir(this.cacheDir);
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(this.cacheDir, file);
        try {
          await fs.unlink(filePath);
        } catch {
          // 무시
        }
      })
    );
    logger.success('캐시 전체 삭제 완료');
  }

  /**
   * 만료된 캐시 정리
   */
  async cleanup(): Promise<number> {
    await this.init();

    let removed = 0;
    const files = await fs.readdir(this.cacheDir);

    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entry = JSON.parse(content) as CacheEntry<unknown>;

        if (Date.now() > entry.expiresAt) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch {
        // 파싱 실패 시 삭제
        await fs.unlink(filePath).catch(() => {});
        removed++;
      }
    }

    logger.success(`만료된 캐시 ${removed}개 정리 완료`);
    return removed;
  }

  /**
   * 캐시 상태 조회
   */
  async getStats(): Promise<CacheStats> {
    await this.init();

    const files = await fs.readdir(this.cacheDir);
    let totalSize = 0;

    for (const file of files) {
      try {
        const stat = await fs.stat(path.join(this.cacheDir, file));
        totalSize += stat.size;
      } catch {
        // 무시
      }
    }

    return { size: totalSize, entries: files.length };
  }

  /**
   * 캐시 파일 경로
   */
  private getFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }
}

// 기본 인스턴스
export const cacheManager = new CacheManager();
