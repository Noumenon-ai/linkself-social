import dns from 'node:dns';
import { WordpressProvider } from './wordpress.provider';
import { ListmonkProvider } from './listmonk.provider';
import { LemmyProvider } from './lemmy.provider';
import { DevToProvider } from './dev.to.provider';
import { HashnodeProvider } from './hashnode.provider';
import { NostrProvider } from './nostr.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  fetchPublicInstance,
  ssrfSafeDispatcher,
} from '../../dtos/webhooks/ssrf.safe.dispatcher';
import { Relay, SimplePool, getPublicKey } from 'nostr-tools';
import { BadBody, RefreshToken } from '../social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('undici', () => ({
  Agent: class {
    constructor(public options: any) {}
  },
}));
jest.mock('nostr-tools', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    destroy: jest.fn(),
  })),
  Relay: jest.fn(),
  getPublicKey: jest.fn().mockReturnValue('public-key'),
  finalizeEvent: jest.fn().mockReturnValue({ id: 'signed-event' }),
}));
const code = (body: object) =>
  Buffer.from(JSON.stringify(body)).toString('base64');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const providers = [
  {
    provider: new WordpressProvider(),
    field: 'domain',
    body: { username: 'owner', password: 'private-password' },
    result: { id: 1, name: 'Owner' },
  },
  {
    provider: new ListmonkProvider(),
    field: 'url',
    body: { username: 'owner', password: 'private-token' },
    result: { data: { 'app.site_name': 'Newsletter' } },
  },
  {
    provider: new LemmyProvider(),
    field: 'service',
    body: { identifier: 'owner', password: 'private-password' },
    result: { jwt: 'jwt', person_view: { person: { id: 1, name: 'Owner' } } },
  },
];

describe('Own-key connections', () => {
  const env = { ...process.env };
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unreachable'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  describe.each(providers)(
    '$provider.name',
    ({ provider, field, body, result }) => {
      it.each([
        'http://127.0.0.1',
        'https://10.0.0.1',
        'https://169.254.169.254',
        'http://[::1]',
        'https://[::ffff:127.0.0.1]',
        'http://2130706433',
        'http://localhost',
        'file:///etc/passwd',
        'ftp://example.com',
      ])('refuses %s before sending credentials', async (url) => {
        process.env.DISABLE_SSRF_PROTECTION = 'true';
        expect(
          typeof (await provider.authenticate({
            code: code({ ...body, [field]: url }),
            codeVerifier: '',
          }))
        ).toBe('string');
        expect(fetchMock).not.toHaveBeenCalled();
      });
      it.each([401, 403, 500, 302])(
        'returns a safe connection error for status %s',
        async (status) => {
          fetchMock.mockResolvedValue(
            json({ password: 'private-password' }, status)
          );
          expect(
            typeof (await provider.authenticate({
              code: code({ ...body, [field]: 'https://example.com' }),
              codeVerifier: '',
            }))
          ).toBe('string');
          expect(console.log).not.toHaveBeenCalled();
          expect(fetchMock).toHaveBeenCalledTimes(1);
        }
      );
      it('handles unreachable hosts and malformed input', async () => {
        for (const value of [
          code({ ...body, [field]: 'https://example.com' }),
          'invalid',
        ]) {
          expect(
            typeof (await provider.authenticate({
              code: value,
              codeVerifier: '',
            }))
          ).toBe('string');
        }
        expect(console.log).not.toHaveBeenCalled();
      });
      it('encrypts the token and bounds every authentication request', async () => {
        fetchMock.mockImplementation(async () => json(result));
        const auth = await provider.authenticate({
          code: code({ ...body, [field]: 'https://example.com' }),
          codeVerifier: '',
        });
        expect(typeof auth).toBe('object');
        if (typeof auth === 'string') throw new Error(auth);
        expect(auth.accessToken).toMatch(/^encrypted:v1:/);
        if (auth.refreshToken)
          expect(auth.refreshToken).toMatch(/^encrypted:v1:/);
        expect(AuthService.decryptCredential(auth.accessToken)).not.toBe(
          auth.accessToken
        );
        for (const [, options] of fetchMock.mock.calls) {
          expect(options).toMatchObject({
            dispatcher: ssrfSafeDispatcher,
            redirect: 'error',
            signal: expect.any(AbortSignal),
          });
        }
      });
      it('refuses an incomplete success response', async () => {
        fetchMock.mockResolvedValue(json({}));
        expect(
          typeof (await provider.authenticate({
            code: code({ ...body, [field]: 'https://example.com' }),
            codeVerifier: '',
          }))
        ).toBe('string');
      });
    }
  );

  it.each([new DevToProvider(), new HashnodeProvider()])(
    '%s rejects wrong keys and unreachable APIs without logging',
    async (provider) => {
      for (const status of [401, 403, 500, 200]) {
        fetchMock.mockResolvedValue(json({ errors: ['Invalid key'] }, status));
        expect(
          await provider.authenticate({
            code: code({ apiKey: 'private-key' }),
            codeVerifier: '',
          })
        ).toBe('Invalid credentials');
      }
      fetchMock.mockRejectedValue(new Error('unreachable'));
      expect(
        await provider.authenticate({
          code: code({ apiKey: 'private-key' }),
          codeVerifier: '',
        })
      ).toBe('Invalid credentials');
      expect(
        await provider.authenticate({ code: 'bad-json', codeVerifier: '' })
      ).toBe('Invalid credentials');
      expect(console.log).not.toHaveBeenCalled();
    }
  );

  it.each([new DevToProvider(), new HashnodeProvider()])(
    '%s encrypts a valid API key',
    async (provider) => {
      const me = { id: 'id', name: 'Owner', username: 'owner' };
      fetchMock.mockResolvedValue(
        json(provider.identifier === 'devto' ? me : { data: { me } })
      );
      const auth = await provider.authenticate({
        code: code({ apiKey: 'private-key' }),
        codeVerifier: '',
      });
      if (typeof auth === 'string') throw new Error(auth);
      expect(auth.accessToken).not.toContain('private-key');
      expect(AuthService.decryptCredential(auth.accessToken)).toBe(
        'private-key'
      );
    }
  );

  it.each(['invalid', 'ab', 'z'.repeat(64), '0'.repeat(63)])(
    'rejects malformed Nostr private key %s',
    async (password) => {
      expect(
        await new NostrProvider().authenticate({
          code: code({ password }),
          codeVerifier: '',
        })
      ).toBe('Invalid credentials');
      expect(console.log).not.toHaveBeenCalled();
    }
  );

  it('handles an invalid Nostr scalar without logging', async () => {
    jest.mocked(getPublicKey).mockImplementationOnce(() => {
      throw new Error('invalid scalar');
    });
    expect(
      await new NostrProvider().authenticate({
        code: code({ password: '0'.repeat(64) }),
        codeVerifier: '',
      })
    ).toBe('Invalid credentials');
  });

  it('encrypts the Nostr key and bounds profile discovery', async () => {
    const auth = await new NostrProvider().authenticate({
      code: code({ password: 'a'.repeat(64) }),
      codeVerifier: '',
    });
    if (typeof auth === 'string') throw new Error(auth);
    expect(auth.accessToken).toMatch(/^encrypted:v1:/);
    expect(
      AuthService.verifyJWT(AuthService.decryptCredential(auth.accessToken))
    ).toMatchObject({ password: 'a'.repeat(64) });
    const pool = jest.mocked(SimplePool).mock.results.at(-1)!.value;
    expect(pool.get).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      { maxWait: 6000 }
    );
    expect(pool.destroy).toHaveBeenCalled();
  });

  it('finishes a Nostr post when one relay stalls and closes every connection', async () => {
    jest.useFakeTimers();
    const relays: any[] = [];
    jest.mocked(Relay).mockImplementation(() => {
      const relay = {
        connect: jest.fn().mockResolvedValue(undefined),
        publish: jest
          .fn()
          .mockImplementation(() =>
            relays.length === 1 ? new Promise(() => {}) : Promise.resolve('ok')
          ),
        close: jest.fn(),
      };
      const stalled = relays.length === 0;
      relay.publish.mockImplementation(() =>
        stalled ? new Promise(() => {}) : Promise.resolve('ok')
      );
      relays.push(relay);
      return relay as any;
    });
    try {
      const promise = new NostrProvider().post(
        'public-key',
        AuthService.encryptCredential(
          AuthService.signJWT({ password: 'a'.repeat(64) })
        ),
        [{ id: 'post', message: 'hello', settings: {} }]
      );
      await jest.advanceTimersByTimeAsync(6000);
      expect((await promise)[0].postId).toBe('signed-event');
      expect(relays).toHaveLength(5);
      relays.forEach((relay) => {
        expect(relay.close).toHaveBeenCalled();
        expect(relay.connect).toHaveBeenCalledWith({ timeout: 6000 });
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not report success when all Nostr relays reject the post', async () => {
    jest.mocked(Relay).mockImplementation(
      () =>
        ({
          connect: jest.fn().mockRejectedValue(new Error('offline')),
          close: jest.fn(),
        } as any)
    );
    await expect(
      new NostrProvider().post(
        'public-key',
        AuthService.signJWT({ password: 'a'.repeat(64) }),
        [{ id: 'post', message: 'hello', settings: {} }]
      )
    ).rejects.toThrow('No Nostr relay accepted');
  });

  it('rechecks stored WordPress URLs for lists and publishing', async () => {
    const token = AuthService.encryptCredential(
      code({
        domain: 'http://127.0.0.1',
        username: 'owner',
        password: 'secret',
      })
    );
    const provider = new WordpressProvider();
    for (const method of ['postTypes', 'categoriesList', 'tagsList'] as const)
      await expect(provider[method](token)).rejects.toThrow('public HTTP');
    await expect(
      provider.post(
        'id',
        token,
        [{ id: 'p', message: '', settings: { title: 'Title' } } as any],
        {} as any
      )
    ).rejects.toThrow('public HTTP');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks stored Listmonk URLs for lists, templates and publishing', async () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          url: 'http://127.0.0.1',
          username: 'owner',
          password: 'secret',
        })
      ),
    } as any;
    const provider = new ListmonkProvider();
    for (const method of ['list', 'templates'] as const)
      await expect(provider[method]('', {}, '', integration)).rejects.toThrow(
        'public HTTP'
      );
    await expect(
      provider.post(
        '',
        '',
        [{ id: 'p', message: '', settings: { subject: 'Title' } } as any],
        integration
      )
    ).rejects.toThrow('public HTTP');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks stored Lemmy URLs for search, posting and comments', async () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          service: 'http://127.0.0.1',
          identifier: 'owner',
          password: 'secret',
        })
      ),
    } as any;
    const provider = new LemmyProvider();
    await expect(
      provider.subreddits('', { word: 'test' }, '', integration)
    ).rejects.toThrow('public service URL');
    await expect(provider.post('', '', [] as any, integration)).rejects.toThrow(
      'public service URL'
    );
    await expect(
      provider.comment('', '', '', '', [] as any, integration)
    ).rejects.toThrow('public service URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('guards Listmonk campaign creation and its later status call', async () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          url: 'https://example.com',
          username: 'owner',
          password: 'secret',
        })
      ),
    } as any;
    fetchMock.mockImplementation(async () =>
      json({ data: { uuid: 'published', id: 2 } })
    );
    await new ListmonkProvider().post(
      '',
      '',
      [{ id: 'p', message: 'Hello', settings: { subject: 'Title' } } as any],
      integration
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://example.com/api/campaigns/2/status'
    );
    fetchMock.mock.calls.forEach(([, options]) =>
      expect(options).toMatchObject({
        dispatcher: ssrfSafeDispatcher,
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('keeps WordPress permission errors and retries while sanitizing response details', async () => {
    const token = AuthService.encryptCredential(
      code({
        domain: 'https://example.com',
        username: 'owner',
        password: 'secret',
      })
    );
    fetchMock
      .mockResolvedValueOnce(json({ error: 'rate limit' }, 429))
      .mockResolvedValueOnce(
        json({ code: 'rest_cannot_create', password: 'secret' }, 403)
      );
    const failure = await new WordpressProvider()
      .post(
        'id',
        token,
        [{ id: 'p', message: 'hello', settings: { title: 'Title' } } as any],
        {} as any
      )
      .catch((error) => error);
    expect(failure).toBeInstanceOf(BadBody);
    expect(failure.message).toContain('insufficient permissions');
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timer).toHaveBeenCalledWith(5000);
    fetchMock.mock.calls.forEach(([, options]) =>
      expect(options).toMatchObject({
        dispatcher: ssrfSafeDispatcher,
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('keeps Listmonk authentication failures classified for reconnect', async () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          url: 'https://example.com',
          username: 'owner',
          password: 'secret',
        })
      ),
    } as any;
    fetchMock.mockResolvedValue(json({ password: 'secret' }, 401));
    const failure = await new ListmonkProvider()
      .list('', {}, '', integration)
      .catch((error) => error);
    expect(failure).toBeInstanceOf(RefreshToken);
    expect(JSON.stringify(failure)).not.toContain('secret');
  });

  it.each([401, 200])(
    'sanitizes a stored Lemmy login failure (%s)',
    async (status) => {
      const integration = {
        customInstanceDetails: AuthService.fixedEncryption(
          JSON.stringify({
            service: 'https://example.com',
            identifier: 'owner',
            password: 'private-password',
          })
        ),
      } as any;
      fetchMock.mockResolvedValue(
        new Response('private-password is not JSON', { status })
      );
      const failure = await new LemmyProvider()
        .subreddits('', { word: 'test' }, '', integration)
        .catch((error) => error);
      expect(failure).toBeInstanceOf(status === 401 ? RefreshToken : BadBody);
      expect(JSON.stringify(failure)).not.toContain('private-password');
      expect(failure.message).not.toContain('private-password');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps Lemmy post rejection messages', async () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({
          service: 'https://example.com',
          identifier: 'owner',
          password: 'secret',
        })
      ),
    } as any;
    fetchMock
      .mockResolvedValueOnce(json({ jwt: 'jwt' }))
      .mockResolvedValueOnce(json({ error: 'locked' }, 403));
    await expect(
      new LemmyProvider().comment(
        '',
        '123',
        '',
        '',
        [{ id: 'p', message: 'hello', settings: { subreddit: [] } }],
        integration
      )
    ).rejects.toThrow('locked');
  });

  it.each([false, true])(
    'reads legacy and encrypted Dev.to and Hashnode tokens (encrypted=%s)',
    async (encrypted) => {
      const token = encrypted
        ? AuthService.encryptCredential('private-key')
        : 'private-key';
      fetchMock
        .mockResolvedValueOnce(json([]))
        .mockResolvedValueOnce(
          json({ data: { me: { publications: { edges: [] } } } })
        );
      await new DevToProvider().tags(token);
      await new HashnodeProvider().publications(token);
      expect(fetchMock.mock.calls[0][1].headers['api-key']).toBe('private-key');
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
        'private-key'
      );
    }
  );

  it('pins DNS and refuses private results on every lookup', async () => {
    const lookup = (ssrfSafeDispatcher as any).options.connect.lookup;
    jest
      .spyOn(dns, 'lookup')
      .mockImplementation(((_host: any, _options: any, callback: any) =>
        callback(null, [{ address: '10.0.0.1', family: 4 }])) as any);
    const callback = jest.fn();
    lookup('example.com', { all: true }, callback);
    expect(callback.mock.calls[0][0]).toEqual(new Error('Blocked IP'));
  });

  it('sets a deadline and prevents redirects before sending a public request', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(json({}));
    await fetchPublicInstance('http://example.com');
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/',
      expect.objectContaining({
        redirect: 'error',
        dispatcher: ssrfSafeDispatcher,
      })
    );
  });
});
