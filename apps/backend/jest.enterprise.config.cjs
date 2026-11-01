const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/backend/src/api/routes/enterprise.controller.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/auth.throttle.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/linkedin.scopes.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/pinterest.sandbox.spec.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/apps/backend/tsconfig.json' },
    ],
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/',
  }),
};
