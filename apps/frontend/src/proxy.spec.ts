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
