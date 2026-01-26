/**
 * 캐시 관리 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { cacheManager } from '../../utils/cache.js';
import { formatBytes } from '../../utils/file.js';

export function cacheCommand(): Command {
  const cache = new Command('cache').description('캐시 관리');

  // yt2pdf cache show
  cache
    .command('show')
    .description('캐시 상태 표시')
    .action(async () => {
      try {
        await cacheManager.init();
        const stats = await cacheManager.getStats();

        console.log(chalk.bold('\n캐시 상태:\n'));
        console.log(`  항목 수: ${stats.entries}개`);
        console.log(`  총 용량: ${formatBytes(stats.size)}`);
      } catch (error) {
        console.error(chalk.red('캐시 상태 조회 실패:', (error as Error).message));
      }
    });

  // yt2pdf cache clear
  cache
    .command('clear')
    .description('캐시 전체 삭제')
    .action(async () => {
      try {
        await cacheManager.clear();
        console.log(chalk.green('✓ 캐시가 삭제되었습니다.'));
      } catch (error) {
        console.error(chalk.red('캐시 삭제 실패:', (error as Error).message));
      }
    });

  // yt2pdf cache cleanup
  cache
    .command('cleanup')
    .description('만료된 캐시 정리')
    .action(async () => {
      try {
        const removed = await cacheManager.cleanup();
        console.log(chalk.green(`✓ ${removed}개의 만료된 캐시가 정리되었습니다.`));
      } catch (error) {
        console.error(chalk.red('캐시 정리 실패:', (error as Error).message));
      }
    });

  return cache;
}
