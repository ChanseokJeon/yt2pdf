/**
 * 로깅 유틸리티
 */

import chalk from 'chalk';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'error') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  error(message: string, error?: Error): void {
    console.error(chalk.red(`✖ ${message}`));
    if (error && this.shouldLog('debug')) {
      console.error(chalk.gray(error.stack || error.message));
    }
  }

  warn(message: string): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(`⚠ ${message}`));
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      console.log(chalk.blue(`ℹ ${message}`));
    }
  }

  debug(message: string, data?: object): void {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(`● ${message}`));
      if (data) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  success(message: string): void {
    console.log(chalk.green(`✓ ${message}`));
  }

  /**
   * 진행 상황 표시 (프로그레스 바 없이 간단한 메시지)
   */
  progress(current: number, total: number, message?: string): void {
    const percentage = Math.round((current / total) * 100);
    const msg = message ? ` - ${message}` : '';
    process.stdout.write(`\r${chalk.cyan(`[${percentage}%]`)} ${current}/${total}${msg}`);
    if (current === total) {
      process.stdout.write('\n');
    }
  }
}

// 싱글톤 인스턴스
export const logger = new Logger();

// 편의 함수
export const log = {
  error: (message: string, error?: Error) => logger.error(message, error),
  warn: (message: string) => logger.warn(message),
  info: (message: string) => logger.info(message),
  debug: (message: string, data?: object) => logger.debug(message, data),
  success: (message: string) => logger.success(message),
};
