/**
 * 설정 관리자
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { config as dotenvConfig } from 'dotenv';
import { Config, ConfigSchema, CLIOptions } from '../types/config.js';
import { logger } from './logger.js';

// .env 파일 로드
dotenvConfig();

export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config | null = null;

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * 설정 로드
   * 우선순위: CLI 옵션 > 프로젝트 설정 > 전역 설정 > 기본값
   */
  async load(cliOptions?: CLIOptions): Promise<Config> {
    // 1. 기본값
    let config: Config = ConfigSchema.parse({});

    // 2. 전역 설정 파일
    const globalPath = ConfigManager.getGlobalConfigPath();
    if (await this.fileExists(globalPath)) {
      const globalConfig = await this.loadYaml(globalPath);
      config = this.merge(config, globalConfig);
      logger.debug(`전역 설정 로드: ${globalPath}`);
    }

    // 3. 프로젝트 설정 파일
    const projectPath = ConfigManager.getProjectConfigPath();
    if (await this.fileExists(projectPath)) {
      const projectConfig = await this.loadYaml(projectPath);
      config = this.merge(config, projectConfig);
      logger.debug(`프로젝트 설정 로드: ${projectPath}`);
    }

    // 4. CLI 옵션 적용
    if (cliOptions) {
      config = this.applyCLIOptions(config, cliOptions);
    }

    // 5. 유효성 검사
    const validated = ConfigSchema.parse(config);
    this.config = validated;

    return validated;
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): Config {
    if (!this.config) {
      throw new Error('설정이 로드되지 않았습니다. load()를 먼저 호출하세요.');
    }
    return this.config;
  }

  /**
   * 프로젝트 설정 파일 경로
   */
  static getProjectConfigPath(): string {
    return path.join(process.cwd(), 'yt2pdf.config.yaml');
  }

  /**
   * 전역 설정 파일 경로
   */
  static getGlobalConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.config', 'yt2pdf', 'config.yaml');
  }

  /**
   * 설정 파일 생성
   */
  async createConfigFile(filePath: string, config?: Partial<Config>): Promise<void> {
    const defaultConfig = ConfigSchema.parse(config || {});
    const yamlContent = yaml.stringify(defaultConfig);
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, yamlContent, 'utf-8');
    logger.success(`설정 파일 생성: ${filePath}`);
  }

  /**
   * YAML 파일 로드
   */
  private async loadYaml(filePath: string): Promise<Partial<Config>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return yaml.parse(content) as Partial<Config>;
    } catch (error) {
      logger.warn(`설정 파일 로드 실패: ${filePath}`);
      return {};
    }
  }

  /**
   * 파일 존재 확인
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 설정 병합
   */
  private merge(base: Config, override: Partial<Config>): Config {
    return {
      output: { ...base.output, ...override.output },
      screenshot: { ...base.screenshot, ...override.screenshot },
      subtitle: { ...base.subtitle, ...override.subtitle },
      pdf: { ...base.pdf, ...override.pdf },
      whisper: { ...base.whisper, ...override.whisper },
      cache: { ...base.cache, ...override.cache },
      processing: { ...base.processing, ...override.processing },
      summary: { ...base.summary, ...override.summary },
      translation: { ...base.translation, ...override.translation },
      ai: { ...base.ai, ...override.ai },
      chapter: { ...base.chapter, ...override.chapter },
      dev: { ...base.dev, ...override.dev },
    };
  }

  /**
   * CLI 옵션을 설정에 적용
   */
  private applyCLIOptions(config: Config, options: CLIOptions): Config {
    const result = { ...config };

    if (options.output) {
      result.output = { ...result.output, directory: options.output };
    }
    if (options.format) {
      result.output = { ...result.output, format: options.format };
    }
    if (options.interval) {
      result.screenshot = { ...result.screenshot, interval: options.interval };
    }
    if (options.quality) {
      result.screenshot = { ...result.screenshot, quality: options.quality };
    }
    if (options.layout) {
      result.pdf = { ...result.pdf, layout: options.layout };
    }
    if (options.theme) {
      result.pdf = { ...result.pdf, theme: options.theme };
    }
    if (options.lang) {
      result.subtitle = {
        ...result.subtitle,
        languages: [options.lang, ...result.subtitle.languages.filter((l) => l !== options.lang)],
      };
    }
    if (options.noCache) {
      result.cache = { ...result.cache, enabled: false };
    }

    return result;
  }
}

// 싱글톤 인스턴스 내보내기
export const configManager = ConfigManager.getInstance();
