import { assertStudioBuildPath } from '@gitroom/helpers/utils/base-path';

export async function register() {
  const runtimeEnv = process.env;
  assertStudioBuildPath(
    process.env.LINKSELF_BUILD_BASE_PATH || '',
    runtimeEnv['LINKSELF_BASE_PATH'] || ''
  );
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
