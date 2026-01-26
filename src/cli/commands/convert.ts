/**
 * 변환 명령어
 */

import ora from 'ora';
import chalk from 'chalk';
import { Orchestrator } from '../../core/orchestrator.js';
import { configManager } from '../../utils/config.js';
import { cacheManager } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { isValidYouTubeUrl, parseYouTubeUrl } from '../../utils/url.js';
import { formatBytes } from '../../utils/file.js';
import { CLIOptions, OutputFormat, PDFLayout, ImageQuality } from '../../types/config.js';

interface ConvertCommandOptions {
  output?: string;
  format?: string;
  interval?: string;
  layout?: string;
  theme?: string;
  quality?: string;
  lang?: string;
  cache?: boolean;
  verbose?: boolean;
}

export async function convertCommand(url: string | undefined, options: ConvertCommandOptions) {
  // URL 필수 확인
  if (!url) {
    console.log(chalk.yellow('사용법: yt2pdf <YouTube-URL> [options]'));
    console.log(chalk.gray('\n예시:'));
    console.log(chalk.gray('  yt2pdf https://youtube.com/watch?v=xxxxx'));
    console.log(chalk.gray('  yt2pdf https://youtube.com/watch?v=xxxxx -o ./docs -f md'));
    console.log(chalk.gray('\n옵션 확인: yt2pdf --help'));
    return;
  }

  // URL 유효성 검사
  if (!isValidYouTubeUrl(url)) {
    console.error(chalk.red('✖ 유효하지 않은 YouTube URL입니다.'));
    process.exit(1);
  }

  const spinner = ora('초기화 중...').start();

  try {
    // 로그 레벨 설정
    if (options.verbose) {
      logger.setLevel('debug');
    }

    // CLI 옵션 변환
    const cliOptions: CLIOptions = {
      output: options.output,
      format: options.format as OutputFormat | undefined,
      interval: options.interval ? parseInt(options.interval, 10) : undefined,
      layout: options.layout as PDFLayout | undefined,
      theme: options.theme,
      quality: options.quality as ImageQuality | undefined,
      lang: options.lang,
      noCache: options.cache === false,
      verbose: options.verbose,
    };

    // 설정 로드
    spinner.text = '설정 로드 중...';
    const config = await configManager.load(cliOptions);

    // 캐시 초기화
    if (config.cache.enabled) {
      await cacheManager.init();
    }

    // 오케스트레이터 생성
    const orchestrator = new Orchestrator({
      config,
      cache: config.cache.enabled ? cacheManager : undefined,
    });

    // 진행 상황 표시
    orchestrator.onProgress((state) => {
      spinner.text = `${state.currentStep} (${state.progress}%)`;
    });

    // URL 타입 확인
    const parsed = parseYouTubeUrl(url);
    spinner.text = `${parsed.type === 'playlist' ? '플레이리스트' : '영상'} 처리 중...`;

    // 변환 실행
    const startTime = Date.now();

    if (parsed.type === 'playlist') {
      const results = await orchestrator.processPlaylist({ url });
      spinner.stop();

      console.log(chalk.green(`\n✓ ${results.length}개 영상 변환 완료!\n`));

      for (const result of results) {
        console.log(chalk.gray(`  • ${result.metadata.title}`));
        console.log(chalk.gray(`    → ${result.outputPath}`));
      }
    } else {
      const result = await orchestrator.process({ url });
      spinner.stop();

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(chalk.green('\n✓ 변환 완료!\n'));
      console.log(`  ${chalk.bold('파일:')} ${result.outputPath}`);
      console.log(`  ${chalk.bold('제목:')} ${result.metadata.title}`);
      console.log(`  ${chalk.bold('페이지:')} ${result.stats.pages}`);
      console.log(`  ${chalk.bold('용량:')} ${formatBytes(result.stats.fileSize)}`);
      console.log(`  ${chalk.bold('스크린샷:')} ${result.stats.screenshotCount}개`);
      console.log(`  ${chalk.bold('소요시간:')} ${elapsedTime}초`);
    }
  } catch (error) {
    spinner.stop();
    const err = error as Error;
    console.error(chalk.red(`\n✖ 오류: ${err.message}`));

    if (options.verbose) {
      console.error(chalk.gray(err.stack));
    }

    process.exit(1);
  }
}
