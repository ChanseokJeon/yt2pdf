/**
 * 설정 관리 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'yaml';
import * as fs from 'fs/promises';
import { ConfigManager, configManager } from '../../utils/config.js';

export function configCommand(): Command {
  const config = new Command('config').description('설정 관리');

  // yt2pdf config show
  config
    .command('show')
    .description('현재 설정 표시')
    .action(async () => {
      try {
        const currentConfig = await configManager.load();
        console.log(chalk.bold('\n현재 설정:\n'));
        console.log(yaml.stringify(currentConfig));
      } catch (error) {
        console.error(chalk.red('설정 로드 실패:', (error as Error).message));
      }
    });

  // yt2pdf config init
  config
    .command('init')
    .description('설정 파일 생성')
    .option('-g, --global', '전역 설정 파일 생성')
    .action(async (options: { global?: boolean }) => {
      try {
        const configPath = options.global
          ? ConfigManager.getGlobalConfigPath()
          : ConfigManager.getProjectConfigPath();

        // 이미 존재하는지 확인
        try {
          await fs.access(configPath);
          console.log(chalk.yellow(`설정 파일이 이미 존재합니다: ${configPath}`));
          return;
        } catch {
          // 파일이 없으면 계속 진행
        }

        await configManager.createConfigFile(configPath);
        console.log(chalk.green(`✓ 설정 파일 생성됨: ${configPath}`));
      } catch (error) {
        console.error(chalk.red('설정 파일 생성 실패:', (error as Error).message));
      }
    });

  // yt2pdf config path
  config
    .command('path')
    .description('설정 파일 경로 표시')
    .action(() => {
      console.log(chalk.bold('\n설정 파일 경로:\n'));
      console.log(`  프로젝트: ${ConfigManager.getProjectConfigPath()}`);
      console.log(`  전역: ${ConfigManager.getGlobalConfigPath()}`);
    });

  return config;
}
