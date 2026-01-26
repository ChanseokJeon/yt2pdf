// Jest 테스트 설정 파일

// 테스트 타임아웃 설정 (30초)
jest.setTimeout(30000);

// 환경 변수 모킹
process.env.NODE_ENV = 'test';

// 콘솔 출력 억제 (필요시)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

export {};
