/**
 * 설치 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { YouTubeProvider } from '../../providers/youtube.js';
import { FFmpegWrapper } from '../../providers/ffmpeg.js';

const execAsync = promisify(exec);

export function setupCommand(): Command {
  const setup = new Command('setup').description('외부 의존성 설치 및 확인');

  // yt2pdf setup
  setup
    .option('-c, --check', '설치 상태만 확인')
    .action(async (options: { check?: boolean }) => {
      console.log(chalk.bold('\n🔧 yt2pdf 의존성 확인\n'));

      // ffmpeg 확인
      const ffmpegInstalled = await FFmpegWrapper.checkInstallation();
      if (ffmpegInstalled) {
        console.log(chalk.green('  ✓ ffmpeg 설치됨'));
      } else {
        console.log(chalk.red('  ✖ ffmpeg 미설치'));
      }

      // yt-dlp 확인
      const ytdlpInstalled = await YouTubeProvider.checkInstallation();
      if (ytdlpInstalled) {
        console.log(chalk.green('  ✓ yt-dlp 설치됨'));
      } else {
        console.log(chalk.red('  ✖ yt-dlp 미설치'));
      }

      // 확인만 하는 경우
      if (options.check) {
        if (!ffmpegInstalled || !ytdlpInstalled) {
          console.log(chalk.yellow('\n누락된 의존성을 설치하려면: yt2pdf setup'));
        }
        return;
      }

      // 설치 진행
      if (!ffmpegInstalled || !ytdlpInstalled) {
        console.log(chalk.bold('\n📦 누락된 의존성 설치 중...\n'));

        const platform = process.platform;

        if (!ffmpegInstalled) {
          await installFFmpeg(platform);
        }

        if (!ytdlpInstalled) {
          await installYtDlp(platform);
        }

        console.log(chalk.green('\n✓ 모든 의존성 설치 완료!'));
      } else {
        console.log(chalk.green('\n✓ 모든 의존성이 이미 설치되어 있습니다.'));
      }
    });

  return setup;
}

async function installFFmpeg(platform: string): Promise<void> {
  console.log(chalk.blue('  ffmpeg 설치 중...'));

  try {
    if (platform === 'darwin') {
      await execAsync('brew install ffmpeg');
    } else if (platform === 'linux') {
      // apt 사용 가능 여부 확인
      try {
        await execAsync('which apt-get');
        await execAsync('sudo apt-get update && sudo apt-get install -y ffmpeg');
      } catch {
        console.log(chalk.yellow('    apt를 사용할 수 없습니다. 수동으로 ffmpeg를 설치해주세요.'));
        return;
      }
    } else {
      console.log(chalk.yellow('    자동 설치가 지원되지 않는 플랫폼입니다.'));
      console.log(chalk.gray('    https://ffmpeg.org/download.html 에서 다운로드하세요.'));
      return;
    }
    console.log(chalk.green('  ✓ ffmpeg 설치 완료'));
  } catch (error) {
    console.log(chalk.red(`  ✖ ffmpeg 설치 실패: ${(error as Error).message}`));
  }
}

async function installYtDlp(platform: string): Promise<void> {
  console.log(chalk.blue('  yt-dlp 설치 중...'));

  try {
    if (platform === 'darwin') {
      await execAsync('brew install yt-dlp');
    } else {
      // pip으로 설치
      try {
        await execAsync('pip3 install yt-dlp');
      } catch {
        await execAsync('pip install yt-dlp');
      }
    }
    console.log(chalk.green('  ✓ yt-dlp 설치 완료'));
  } catch (error) {
    console.log(chalk.red(`  ✖ yt-dlp 설치 실패: ${(error as Error).message}`));
  }
}
