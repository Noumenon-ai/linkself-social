import { createSessionToken, setSessionCookies } from './session';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe.each(['', '/dashboard/studio'])('session path %s', (base) => {
  beforeEach(() => {
    process.env.LINKSELF_BASE_PATH = base;
    process.env.FRONTEND_URL = 'https://linkself.net' + base;
    delete process.env.NOT_SECURED;
  });
  it.each([false, true])('sets isolated cookies (NOT_SECURED=%s)', (unsecured) => {
    if (unsecured) process.env.NOT_SECURED = 'true';
    const response = { cookie: jest.fn(), header: jest.fn() };
    setSessionCookies(response as any, 'signed-token', 'organization');
    expect(response.cookie.mock.calls).toEqual([
      [base ? 'linkself_studio_auth' : 'auth', 'signed-token', expect.objectContaining({
        domain: base ? undefined : '.linkself.net', path: base || '/', expires: expect.any(Date),
      })],
      [base ? 'linkself_studio_showorg' : 'showorg', 'organization', expect.any(Object)],
    ]);
    const options = response.cookie.mock.calls[0][2];
    expect(response.cookie.mock.calls[1][2]).toEqual(options);
    if (unsecured) {
      expect(options.secure).toBeUndefined();
      expect(response.header).toHaveBeenCalledWith('auth', 'signed-token');
    } else {
      expect(options).toMatchObject({ secure: true, httpOnly: true, sameSite: 'none' });
      expect(response.header).not.toHaveBeenCalled();
    }
  });
  it('retains upstream localhost domain behavior', () => {
    expect(getCookieUrlFromDomain('http://localhost:5000')).toBe(base ? undefined : 'localhost');
  });
});

describe.each(['', '/dashboard/studio'])('LinkSelf cookies %s', (base) => {
  it.each([false, true])('uses the LinkSelf cookie policy with local mode %s', (local) => {
    process.env.LINKSELF_URL = 'https://linkself.test';
    process.env.FRONTEND_URL = 'https://linkself.test' + base;
    process.env.LINKSELF_BASE_PATH = base;
    if (local) process.env.NOT_SECURED = 'true';
    else delete process.env.NOT_SECURED;
    const response = { cookie: jest.fn(), header: jest.fn() };
    setSessionCookies(response as any, 'token', 'org');
    for (const [, , options] of response.cookie.mock.calls) expect(options.sameSite).toBe('lax');
  });
});

it('issues distinct LinkSelf browser sessions', () => {
  process.env.LINKSELF_URL = 'https://linkself.test';
  process.env.JWT_SECRET = 'test-session-secret';
  const user = { id: 'user', providerName: 'LOCAL' } as any;
  expect(createSessionToken(user)).not.toBe(createSessionToken(user));
});
