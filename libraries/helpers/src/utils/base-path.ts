// Next injects this same build-time value into browser bundles. Set it to the
// same value at container runtime; changing a Next basePath requires a rebuild.
export const studioBasePath = () =>
  (process.env.LINKSELF_BASE_PATH || '').replace(/\/+$/, '');

/** Browser paths only. Next Link/router and internal API routes already route. */
export function withBasePath(path: string): string {
  const base = studioBasePath();
  if (!base || !path.startsWith('/') || path.startsWith('//') ||
      path === base || /^[/?#]$/.test(path.charAt(base.length)) && path.startsWith(base)) {
    return path;
  }
  return base + path;
}

/** Public Studio URL, including when FRONTEND_URL already contains the prefix. */
export function frontendUrl(url = process.env.FRONTEND_URL || '', path = ''): string {
  const trimmed = url.replace(/\/+$/, '');
  const base = studioBasePath();
  const root = !trimmed || !base || trimmed.endsWith(base) ? trimmed : trimmed + base;
  const suffix = base && (path === base || path.startsWith(base + '/') || path.startsWith(base + '?'))
    ? path.slice(base.length) : path;
  return root + suffix;
}

export const publicApiUrl = () => studioBasePath()
  ? frontendUrl() + '/api'
  : (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

export const studioCookieName = (name: string) =>
  studioBasePath() ? `linkself_studio_${name}` : name;

export const studioCookiePath = () => studioBasePath() || '/';

/** LinkSelf pages are outside Next's basePath, so render these with plain anchors. */
export function linkselfPath(url: string, path: string, studioUrl = frontendUrl()): string {
  const target = new URL(path, url);
  if (studioUrl && target.origin === new URL(studioUrl).origin) {
    return target.pathname + target.search + target.hash;
  }
  return target.toString();
}

/** Validate a browser return path without resolving it against another origin. */
export function isStudioReturnPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !decoded.startsWith('//') && !/[\\\x00-\x20\x7f]/.test(decoded) &&
      new URL(value, 'https://studio.invalid').origin === 'https://studio.invalid';
  } catch {
    return false;
  }
}

export function assertStudioBuildPath(built: string, runtime: string) {
  if (built.replace(/\/+$/, '') !== runtime.replace(/\/+$/, '')) {
    throw new Error('Studio build and runtime paths differ; rebuild with the configured path');
  }
}

export function studioPreferenceCookieOptions() {
  const linkself = typeof document === 'undefined'
    ? !!process.env.LINKSELF_URL
    : !!document.documentElement?.dataset?.linkselfTheme;
  return { path: studioCookiePath(), ...(linkself ? { SameSite: 'Lax' as const } : {}) };
}
