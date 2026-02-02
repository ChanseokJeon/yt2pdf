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
  .option('-f, --format <type>', '출력 포맷 (pdf, md, html, brief)', 'pdf')
  .option('-i, --interval <seconds>', '스크린샷 간격 (초)', '60')
  .option('-l, --layout <type>', 'PDF 레이아웃 (vertical, horizontal, minimal-neon)', 'vertical')
  .option('-t, --theme <name>', 'PDF 테마', 'default')
  .option('--theme-from <source>', 'URL, 이미지, 또는 프리셋에서 테마 추출')
  .option('-q, --quality <level>', '스크린샷 품질 (low, medium, high)', 'low')
  .option('--lang <code>', '자막 언어 (ko, en)')
  .option('--summary', 'AI 요약 생성 (기본: 켜짐)', true)
  .option('--no-summary', 'AI 요약 생성 안함')
  .option('--translate', '기본 언어로 자동 번역 (기본: 켜짐)', true)
  .option('--no-translate', '번역 안함')
  .option('--target-lang <code>', '번역 대상 언어 (기본: ko)', 'ko')
  .option('--no-cache', '캐시 사용 안함')
  .option('--verbose', '상세 로그 출력')
  .option('--dev', '개발 모드 (빠른 처리, 제한된 출력)')
  .option('--dev-chapters <n>', '개발 모드 최대 챕터 수 (기본: 3)')
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
