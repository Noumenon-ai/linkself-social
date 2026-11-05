import { NextRequest } from 'next/server';
import { proxy } from './proxy';

jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({ internalFetch: jest.fn() }));
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe.each(['', '/dashboard/studio'])('proxy path %s', (base) => {
  beforeEach(() => {
    process.env.LINKSELF_BASE_PATH = base;
    process.env.FRONTEND_URL = 'https://linkself.net' + base;
    process.env.IS_GENERAL = 'true';
    delete process.env.NOT_SECURED;
  });
  const request = (path: string, cookie = '') => new NextRequest('https://linkself.net' + base + path, {
    nextConfig: { basePath: base }, headers: { cookie },
  });
  it('keeps login redirects inside Studio', async () => {
    const response = await proxy(request('/launches'));
    expect(response.headers.get('location')).toBe('https://linkself.net' + base + '/auth');
  });
  it('redirects signed-in users to the prefixed calendar', async () => {
    const response = await proxy(request('/', `${base ? 'linkself_studio_auth' : 'auth'}=token`));
    expect(response.headers.get('location')).toBe('https://linkself.net' + base + '/launches');
  });
  it('logs out by deleting the same scoped cookie', async () => {
    const response = await proxy(request('/auth/logout'));
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain(`${base ? 'linkself_studio_auth' : 'auth'}=`);
    expect(cookie).toContain(`Path=${base || '/'}`);
    expect(cookie).toContain('Max-Age=-1');
    expect(cookie).toContain('HttpOnly');
    if (base) expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('location')).toBe('https://linkself.net' + base + '/auth/login');
  });
  it.each(['/p/123', '/integrations/social/youtube?code=123', '/icons/platforms/x.png'])('allows public path %s', async (path) => {
    expect((await proxy(request(path))).headers.get('location')).toBeNull();
  });
  it('does not accept the host application auth cookie in Studio mode', async () => {
    const response = await proxy(request('/launches', 'auth=host-session'));
    expect(response.headers.get('location')).toBe(base ? 'https://linkself.net' + base + '/auth' : null);
  });
});

describe.each(['', '/dashboard/studio'])('LinkSelf browser policy %s', (base) => {
  beforeEach(() => {
    process.env.LINKSELF_URL = 'https://linkself.net';
    process.env.FRONTEND_URL = 'https://linkself.net' + base;
    process.env.LINKSELF_BASE_PATH = base;
  });
  const request = (path: string) => new NextRequest('https://linkself.net' + base + path, {
    nextConfig: { basePath: base },
    headers: { cookie: `${base ? 'linkself_studio_auth' : 'auth'}=token` },
  });
  it('serves browser policy on ordinary pages', async () => {
    const response = await proxy(request('/launches'));
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });
  it('keeps ordinary query navigation non-mutating', async () => {
    const response = await proxy(request('/launches?return=/auth/logout'));
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });
  it('requires confirmation for session actions', async () => {
    const response = await proxy(request('/auth/logout'));
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toContain(base + '/account-action?action=logout');
  });
  it('requires confirmation for workspace invitations', async () => {
    const { internalFetch } = require('@gitroom/helpers/utils/internal.fetch');
    internalFetch.mockClear();
    const response = await proxy(request('/launches?org=invitation'));
    expect(response.headers.get('location')).toContain(base + '/account-action?org=invitation');
    expect(internalFetch).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
