/**
 * 이미지 유틸리티
 * 이미지 다운로드, 폰트 경로 관리 등
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

/**
 * URL에서 이미지를 Buffer로 다운로드
 * HTTP 리다이렉트 처리, 타임아웃 처리 포함
 */
export async function downloadImageToBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, (response) => {
      // 리다이렉트 처리
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          void downloadImageToBuffer(redirectUrl).then(resolve);
          return;
        }
      }

      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => resolve(null));
    });
    request.on('error', () => resolve(null));
    request.setTimeout(10000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

/**
 * 폰트 디렉토리 경로 반환
 * 여러 가능한 위치를 시도하여 존재하는 경로 반환
 */
export function getFontsDir(): string {
  // Try multiple possible locations
  const possiblePaths = [
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(__dirname, '../../assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return possiblePaths[0]; // default
}

/**
 * 한글 폰트 파일 존재 여부 확인
 */
export function hasKoreanFonts(): boolean {
  try {
    const fontsDir = getFontsDir();
    const regularFont = path.join(fontsDir, 'NotoSansKR-Regular.ttf');
    const boldFont = path.join(fontsDir, 'NotoSansKR-Bold.ttf');
    return fs.existsSync(regularFont) && fs.existsSync(boldFont);
  } catch {
    return false;
  }
}

/**
 * 한글 폰트 파일 형식 검증
 * OTF 폰트는 경고 (TTF 권장)
 */
export function validateKoreanFont(): boolean {
  if (!hasKoreanFonts()) return false;

  const fontsDir = getFontsDir();
  const regularFont = path.join(fontsDir, 'NotoSansKR-Regular.ttf');
  const boldFont = path.join(fontsDir, 'NotoSansKR-Bold.ttf');

  // Font file extension check
  const regularExt = path.extname(regularFont).toLowerCase();
  const boldExt = path.extname(boldFont).toLowerCase();

  // OTF 폰트는 렌더링 문제가 있을 수 있음 (경고만, 허용은 함)
  if (regularExt === '.otf' || boldExt === '.otf') {
    // Warning is handled by caller
    return true;
  }

  return true;
}

/**
 * 한글 폰트 경로 반환
 */
export function getKoreanFontPaths(): { regular: string; bold: string } {
  const fontsDir = getFontsDir();
  return {
    regular: path.join(fontsDir, 'NotoSansKR-Regular.ttf'),
    bold: path.join(fontsDir, 'NotoSansKR-Bold.ttf'),
  };
}
