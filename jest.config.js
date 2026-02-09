/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/bin/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 80,
      statements: 80,
    },
    // theme-builder.ts의 page.evaluate 내부 코드(138-153)는
    // 브라우저 컨텍스트에서 실행되므로 Jest 커버리지 측정 불가
    './src/core/theme-builder.ts': {
      branches: 55,
      functions: 65,
      lines: 85,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|#ansi-styles|#supports-color|node-vibrant|chroma-js|uuid|hono|@hono|@scalar|pdf-to-img)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  verbose: true,
};
