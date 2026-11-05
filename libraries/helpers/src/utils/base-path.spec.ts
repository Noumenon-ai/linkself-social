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
    expect(config).toContain('proxy_pass http://localhost:3000/;');
    expect(config).toContain('proxy_pass http://localhost:4200/;');
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
