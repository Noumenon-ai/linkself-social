const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/backend/src/api/routes/copilot.controller.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/integrations.capabilities.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/chat/mcp.availability.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/bluesky.plugs.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/linkself.studio.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.delete.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.credentials.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/enterprise.controller.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/auth.throttle.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/linkedin.scopes.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/pinterest.sandbox.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/tiktok.creator.spec.ts',
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
