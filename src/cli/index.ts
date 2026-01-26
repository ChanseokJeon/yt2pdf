/**
 * CLI 진입점
 */

import { Command } from 'commander';
import { convertCommand } from './commands/convert.js';
import { configCommand } from './commands/config.js';
import { cacheCommand } from './commands/cache.js';
import { setupCommand } from './commands/setup.js';

const program = new Command();

program
  .name('yt2pdf')
  .description('YouTube 영상의 자막과 스크린샷을 추출하여 PDF로 변환')
  .version('0.1.0');

// 기본 명령어 (URL만 입력)
program
  .argument('[url]', 'YouTube URL')
  .option('-o, --output <path>', '출력 디렉토리')
  .option('-f, --format <type>', '출력 포맷 (pdf, md, html)', 'pdf')
  .option('-i, --interval <seconds>', '스크린샷 간격 (초)', '60')
  .option('-l, --layout <type>', 'PDF 레이아웃 (vertical, horizontal)', 'vertical')
  .option('-t, --theme <name>', 'PDF 테마', 'default')
  .option('-q, --quality <level>', '스크린샷 품질 (low, medium, high)', 'low')
  .option('--lang <code>', '자막 언어 (ko, en)')
  .option('--no-cache', '캐시 사용 안함')
  .option('--verbose', '상세 로그 출력')
  .action(convertCommand);

// 서브 명령어
program.addCommand(configCommand());
program.addCommand(cacheCommand());
program.addCommand(setupCommand());

export { program };

// CLI 실행
export function run() {
  program.parse();
}
