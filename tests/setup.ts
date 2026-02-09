// Jest 테스트 설정 파일

// 테스트 타임아웃 설정 (30초)
jest.setTimeout(30000);

// 환경 변수 모킹
process.env.NODE_ENV = 'test';

// chalk 모킹 (ESM 모듈 호환성 문제 해결)
jest.mock('chalk', () => {
  const createChalk = (text: string) => text;
  const chalk: any = createChalk;
  chalk.red = createChalk;
  chalk.green = createChalk;
  chalk.yellow = createChalk;
  chalk.blue = createChalk;
  chalk.cyan = createChalk;
  chalk.magenta = createChalk;
  chalk.white = createChalk;
  chalk.gray = createChalk;
  chalk.grey = createChalk;
  chalk.bold = createChalk;
  chalk.dim = createChalk;
  chalk.italic = createChalk;
  chalk.underline = createChalk;
  chalk.hex = () => createChalk;
  chalk.bgRed = createChalk;
  chalk.bgGreen = createChalk;
  return { default: chalk, ...chalk };
});

// @scalar/hono-api-reference 모킹 (ESM 모듈 호환성 문제 해결)
jest.mock('@scalar/hono-api-reference', () => ({
  Scalar: jest.fn(() => async (c: any) => c.text('Scalar UI')),
}));

// 콘솔 출력 억제 (필요시)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

export {};
