/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    global: { lines: 60 },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map pure-ESM octokit packages to manual CJS mocks in __mocks__/
    '^@octokit/app$': '<rootDir>/__mocks__/@octokit/app.js',
    '^@octokit/webhooks$': '<rootDir>/__mocks__/@octokit/webhooks.js',
  },
};
