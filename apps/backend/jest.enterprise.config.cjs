const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/own-key.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/reddit.spec.ts',
    '<rootDir>/scripts/migrate-upload-origin.spec.ts',
    '<rootDir>/scripts/server-kit.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/studio.responses.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/media.chunked.spec.ts',
    '<rootDir>/apps/frontend/src/components/media/studio.upload.spec.ts',
    '<rootDir>/libraries/helpers/src/utils/base-path.spec.ts',
    '<rootDir>/apps/backend/src/services/auth/session.path.spec.ts',
    '<rootDir>/apps/frontend/src/proxy.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/oauth.path.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/chat/mcp.limits.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/organization-limits/organization.limits.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/enterprise.limits.spec.ts',
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
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/fanvue.spec.ts',
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
