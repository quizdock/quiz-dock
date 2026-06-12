/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@roux-quizz/contracts$': '<rootDir>/../../../packages/contracts/src/index.ts',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  // Les tests d'intégration ouvrent des sockets/Redis ; on force la sortie après
  // la fin des tests (le teardown best-effort peut laisser des handles ouverts).
  forceExit: true,
  testTimeout: 20000,
};
