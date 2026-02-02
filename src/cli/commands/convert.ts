/**
 * 변환 명령어
 */

import ora from 'ora';
import chalk from 'chalk';
import { Orchestrator } from '../../core/orchestrator.js';
import { configManager } from '../../utils/config.js';
import { cacheManager } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { parseYouTubeUrl } from '../../utils/url.js';
import { formatBytes } from '../../utils/file.js';
import { formatTimestamp } from '../../utils/index.js';
import { validateCLIOptions } from '../../utils/validation.js';
import { CLIOptions, OutputFormat, PDFLayout, ImageQuality } from '../../types/config.js';
import { buildTheme } from '../../core/theme-builder.js';

interface ConvertCommandOptions {
  output?: string;
  format?: string;
  interval?: string;
  layout?: string;
  theme?: string;
  themeFrom?: string;
  quality?: string;
  lang?: string;
  summary?: boolean;
  translate?: boolean;
  targetLang?: string;
  cache?: boolean;
  verbose?: boolean;
  dev?: boolean;
  devChapters?: string;
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

  // 모든 입력 유효성 검사
  const validation = validateCLIOptions({
    url,
    format: options.format,
    layout: options.layout,
    quality: options.quality,
    interval: options.interval,
    lang: options.lang,
    output: options.output,
  });

  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(chalk.red(`✖ ${error}`));
    }
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

    // Dev mode 설정 적용
    if (options.dev) {
      config.dev = {
        ...config.dev,
        enabled: true,
        maxChapters: options.devChapters ? parseInt(options.devChapters, 10) : config.dev.maxChapters,
      };
      spinner.text = '[DEV] 개발 모드 활성화...';
    }

    // --theme-from 옵션 처리: URL/이미지/프리셋에서 테마 추출
    if (options.themeFrom) {
      spinner.text = '테마 추출 중...';
      try {
        const extractedTheme = await buildTheme(options.themeFrom, {
          name: `extracted-${Date.now()}`,
        });
        // 추출된 테마를 config에 적용
        config.pdf.theme = extractedTheme.name;
        // customTheme 필드가 없으므로 직접 테마 값을 저장
        (config.pdf as { extractedTheme?: typeof extractedTheme }).extractedTheme = extractedTheme;
        logger.info(`테마 추출 완료: ${extractedTheme.colors.primary}`);
      } catch (error) {
        const err = error as Error;
        logger.warn(`테마 추출 실패, 기본 테마 사용: ${err.message}`);
      }
    }

    // CLI 옵션으로 요약/번역 설정 오버라이드
    if (options.summary !== undefined) {
      config.summary.enabled = options.summary;
    }
    if (options.translate !== undefined) {
      config.translation.enabled = options.translate;
      config.translation.autoTranslate = options.translate;
    }
    if (options.targetLang) {
      config.translation.defaultLanguage = options.targetLang;
    }

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

      const devPrefix = config.dev?.enabled ? '[DEV] ' : '';
      console.log(chalk.green(`\n${devPrefix}✓ 변환 완료!\n`));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`  ${chalk.bold.blue('제목')}     ${result.metadata.title}`);
      console.log(`  ${chalk.bold.blue('채널')}     ${result.metadata.channel}`);
      console.log(`  ${chalk.bold.blue('영상 길이')} ${formatTimestamp(result.metadata.duration)}`);
      console.log(chalk.dim('─'.repeat(50)));
      const format = result.outputPath.split('.').pop()?.toUpperCase() || 'PDF';
      console.log(`  ${chalk.bold('포맷')}     ${format}`);
      console.log(`  ${chalk.bold('파일')}     ${chalk.underline(result.outputPath)}`);
      console.log(`  ${chalk.bold('섹션')}     ${result.stats.pages}개`);
      console.log(`  ${chalk.bold('페이지')}   ${result.stats.pages}개`);
      console.log(`  ${chalk.bold('용량')}     ${formatBytes(result.stats.fileSize)}`);
      console.log(`  ${chalk.bold('스크린샷')} ${result.stats.screenshotCount}개`);
      console.log(`  ${chalk.bold('소요시간')} ${elapsedTime}초`);
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`  ${chalk.cyan.underline(`https://youtube.com/watch?v=${result.metadata.id}`)}`);
      console.log();
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
