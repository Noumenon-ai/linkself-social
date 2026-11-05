import { parseStudioIdentity, isStudioReturnPath, assertStudioBuildPath, studioPreferenceCookieOptions } from './base-path';
import { readFileSync } from 'fs';
import { customFetch } from './custom.fetch.func';
import {
  frontendUrl, linkselfPath, publicApiUrl, studioBasePath,
  studioCookieName, studioCookiePath, withBasePath,
} from './base-path';

const { renderNginx } = require('../../../../var/docker/render-nginx.cjs');
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe.each(['', '/dashboard/studio'])('Studio prefix %s', (base) => {
  beforeEach(() => {
    process.env.LINKSELF_BASE_PATH = base;
    process.env.FRONTEND_URL = 'https://linkself.net';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://upstream.test/api';
  });

  it.each(['/launches', '/auth?code=a%2Fb#return', '/icons/platforms/x.png', '/uploads/a.mp4', '/p/id?share=true', '/'])('routes %s', (path) => {
    expect(withBasePath(path)).toBe(base + path);
    expect(withBasePath(withBasePath(path))).toBe(base + path);
  });
  it.each(['https://network.test/authorize', '//cdn.test/image.png', 'data:image/png;base64,a', '#anchor', 'relative'])('preserves non-Studio URL %s', (path) => {
    expect(withBasePath(path)).toBe(path);
  });
  it('builds public frontend and API URLs', () => {
    expect(frontendUrl()).toBe('https://linkself.net' + base);
    expect(frontendUrl('https://linkself.net' + base + '/')).toBe('https://linkself.net' + base);
    expect(frontendUrl(undefined, '/launches')).toBe('https://linkself.net' + base + '/launches');
    expect(frontendUrl(undefined, base + '/launches')).toBe('https://linkself.net' + base + '/launches');
    expect(publicApiUrl()).toBe(base ? 'https://linkself.net/dashboard/studio/api' : 'https://upstream.test/api');
  });
  it('reads only the matching auth, organization and impersonation cookies', async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(global, 'document');
    Object.defineProperty(global, 'document', { configurable: true, value: {
      cookie: 'auth=host; showorg=host-org; impersonate=host-user; linkself_studio_auth=studio; linkself_studio_showorg=studio-org; linkself_studio_impersonate=studio-user',
    } });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
    try {
      await customFetch({ baseUrl: publicApiUrl() })('/user/self');
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(publicApiUrl() + '/user/self');
      expect(options.headers).toMatchObject({
        auth: base ? 'studio' : 'host',
        showorg: base ? 'studio-org' : 'host-org',
        impersonate: base ? 'studio-user' : 'host-user',
      });
    } finally {
      fetchMock.mockRestore();
      if (originalDocument) Object.defineProperty(global, 'document', originalDocument);
      else delete (global as any).document;
    }
  });
  it('scopes cookie names and paths', () => {
    expect(studioCookieName('auth')).toBe(base ? 'linkself_studio_auth' : 'auth');
    expect(studioCookiePath()).toBe(base || '/');
  });
  it('uses same-origin LinkSelf paths outside Studio', () => {
    expect(linkselfPath('https://linkself.net', '/dashboard/social')).toBe('/dashboard/social');
    expect(linkselfPath('https://account.test', '/dashboard/social')).toBe('https://account.test/dashboard/social');
  });
  it('renders API and uploads nginx locations without changing proxy or upload security', () => {
    const template = readFileSync('var/docker/nginx.conf', 'utf8');
    const config = renderNginx(template, base);
    expect(config).toContain(`location ${base}/api/ {`);
    expect(config).toContain(`location ${base}/uploads/ {`);
    // One address per service: localhost resolves to two, and nginx then keeps
    // per-worker failure state for each, which turned bursts into 502 responses.
    expect(config).toContain('proxy_pass http://127.0.0.1:3000/;');
    expect(config).toContain('proxy_pass http://127.0.0.1:4200/;');
    expect(config).not.toContain('proxy_pass http://localhost');
    expect(config).toContain('alias /uploads/;');
    expect(config).toContain('proxy_set_header Host $host;');
    expect(config).toContain("script-src 'none'; frame-ancestors 'none'; sandbox");
    expect(config).not.toContain('__LINKSELF_BASE_PATH__');
  });
});
it('normalizes trailing slashes and checks prefix boundaries', () => {
  process.env.LINKSELF_BASE_PATH = '/dashboard/studio/';
  expect(studioBasePath()).toBe('/dashboard/studio');
  expect(withBasePath('/dashboard/studio?tab=1')).toBe('/dashboard/studio?tab=1');
  expect(withBasePath('/dashboard/studio-other')).toBe('/dashboard/studio/dashboard/studio-other');
});
it.each(['//evil.test', '/a;return 200;', '/a/../b', 'studio', '/a\nb'])('rejects unsafe nginx prefix %s', (base) => {
  expect(() => renderNginx('__LINKSELF_BASE_PATH__', base)).toThrow();
});

it.each(['https://other.test/path', '//other.test', '/%2fother.test', '/\\other.test', '/%5cother.test', '/%0a/path', '/%'])('validates return path case %#', (value) => {
  expect(isStudioReturnPath(value)).toBe(false);
});
it.each(['/launches', '/dashboard/social?added=true', '/settings#account'])('accepts local return path case %#', (value) => {
  expect(isStudioReturnPath(value)).toBe(true);
});
it.each([['', '/dashboard/studio'], ['/dashboard/studio', ''], ['/first', '/second']])('checks startup path case %#', (built, runtime) => {
  expect(() => assertStudioBuildPath(built, runtime)).toThrow();
});
it('accepts matching startup paths', () => {
  expect(() => assertStudioBuildPath('/dashboard/studio', '/dashboard/studio/')).not.toThrow();
});
it.each(['', '/dashboard/studio'])('renders LinkSelf response policy %s', (base) => {
  const config = renderNginx(readFileSync('var/docker/nginx.conf', 'utf8'), base, 'https://linkself.test');
  expect(config).toContain("Content-Security-Policy \"default-src 'none'; sandbox\" always");
  expect(config).toContain('X-Content-Type-Options "nosniff" always');
  const apiLocation = config.match(/location [^\s]*\/api\/ \{([^}]+)\}/)?.[1];
  for (const header of ['X-Content-Type-Options', 'Content-Security-Policy']) {
    expect(apiLocation?.match(new RegExp(`proxy_hide_header ${header};`, 'g'))).toHaveLength(1);
    expect(apiLocation?.match(new RegExp(`add_header ${header} `, 'g'))).toHaveLength(1);
  }
  expect(config).not.toContain('__LINKSELF_');
  if (base) {
    expect(config).toContain('location /uploads/ {');
    expect(config).toContain('limit_except GET HEAD { deny all; }');
  }
});

it('sets the preference cookie policy in LinkSelf mode', () => {
  process.env.LINKSELF_URL = 'https://linkself.test';
  expect(studioPreferenceCookieOptions()).toMatchObject({ SameSite: 'Lax' });
  delete process.env.LINKSELF_URL;
  expect(studioPreferenceCookieOptions()).not.toHaveProperty('SameSite');
});
it('checks the runtime path during server registration', async () => {
  const { register } = await import('../../../../apps/frontend/src/instrumentation');
  process.env.LINKSELF_BUILD_BASE_PATH = '/dashboard/studio';
  process.env.LINKSELF_BASE_PATH = '';
  await expect(register()).rejects.toThrow('Studio build and runtime paths differ');
  process.env.LINKSELF_BASE_PATH = '/dashboard/studio';
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  await expect(register()).resolves.toBeUndefined();
});

describe('Studio identity display', () => {
  it.each(['Free', 'Starter', 'Pro'])('accepts the %s plan', (plan) => {
    expect(parseStudioIdentity(`creator_42-name.${plan}`)).toEqual({ username: 'creator_42-name', plan });
  });
  it.each(['a', '0', '_', '-', 'a'.repeat(64)])('accepts username %s', (username) => {
    expect(parseStudioIdentity(`${username}.Free`)).toEqual({ username, plan: 'Free' });
  });
  it.each([
    undefined, null, 42, '', 'creator', 'creator.Business', 'creator.free',
    'Creator.Pro', 'creator.name.Pro', 'creator.Pro.extra', 'creator/name.Pro',
    '<b>name</b>.Pro', '.Free', `${'a'.repeat(65)}.Pro`, 'creator.Pro\n',
    ' creator.Pro', 'creator.Pro ',
  ])('ignores invalid identity %s', (value) => {
    expect(parseStudioIdentity(value)).toBeUndefined();
  });
});
