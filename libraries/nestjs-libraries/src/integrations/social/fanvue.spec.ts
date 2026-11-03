import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FanvueProvider } from '@gitroom/nestjs-libraries/integrations/social/fanvue.provider';
import { FanvueDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/fanvue.dto';
import { allProviders } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import {
  BadBody,
  NotEnoughScopes,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { PostDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

const API = 'https://api.fanvue.com/v1';
const TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
const scopes =
  'openid offline_access offline read:self write:post write:media read:media';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const post = (
  overrides: Partial<PostDetails<FanvueDto>> = {}
): PostDetails<FanvueDto> => ({
  id: 'local-post',
  message: 'Hello fans',
  settings: { audience: 'subscribers' },
  ...overrides,
});

describe('Fanvue provider', () => {
  const savedEnv = { ...process.env };
  let provider: FanvueProvider;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.FANVUE_CLIENT_ID = 'client-id';
    process.env.FANVUE_CLIENT_SECRET = 'test-client-secret';
    process.env.FRONTEND_URL = 'https://studio.example.com';
    provider = new FanvueProvider();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected network request');
    });
    jest.mocked(timer).mockClear();
  });

  afterEach(() => {
    fetchMock.mockRestore();
    for (const key of [
      'FANVUE_CLIENT_ID',
      'FANVUE_CLIENT_SECRET',
      'FRONTEND_URL',
    ]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const tokenResponse = () =>
    json({
      access_token: 'access-secret',
      refresh_token: 'rotated-secret',
      expires_in: 3600,
      scope: scopes,
    });
  const userResponse = () =>
    json({
      uuid: 'creator-id',
      handle: 'creator',
      displayName: 'Creator',
      isCreator: true,
      avatarUrl: 'https://example.com/avatar.png',
    });
  const publish = (details = post()) =>
    provider.post('creator-id', 'access-secret', [details], {} as any);

  it('uses the documented PKCE authorize URL, minimal scopes and callback', async () => {
    const { url, state, codeVerifier } = await provider.generateAuthUrl();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://auth.fanvue.com/oauth2/auth'
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'https://studio.example.com/integrations/social/fanvue',
      response_type: 'code',
      scope: scopes,
      state,
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      code_challenge_method: 'S256',
    });
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(url).not.toContain('test-client-secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['FANVUE_CLIENT_ID', 'FANVUE_CLIENT_SECRET'])(
    'fails clearly without %s',
    async (key) => {
      delete process.env[key];
      await expect(provider.generateAuthUrl()).rejects.toThrow(
        'Fanvue requires FANVUE_CLIENT_ID and FANVUE_CLIENT_SECRET'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('exchanges the code with client_secret_basic and maps the creator profile', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(userResponse());
    await expect(
      provider.authenticate({
        code: 'auth-code',
        codeVerifier: 'verifier',
        refresh: 'integration-id',
      })
    ).resolves.toEqual({
      id: 'creator-id',
      name: 'Creator',
      username: 'creator',
      picture: 'https://example.com/avatar.png',
      accessToken: 'access-secret',
      refreshToken: 'rotated-secret',
      expiresIn: 3600,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:test-client-secret').toString('base64')}`
    );
    expect(options.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(Object.fromEntries(options.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier',
      redirect_uri: 'https://studio.example.com/integrations/social/fanvue',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(`${API}/users/me`);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer access-secret',
      'X-Fanvue-API-Version': '2025-06-26',
    });
  });

  it('returns rotated tokens without a fallible profile call after refresh', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await expect(
      provider.refreshToken('old-refresh-secret')
    ).resolves.toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'rotated-secret',
      expiresIn: 3600,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:test-client-secret').toString('base64')}`
    );
    expect(Object.fromEntries(options.body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-secret',
    });
  });

  it('rejects missing rotated refresh tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ access_token: 'access-secret', expires_in: 3600 })
    );
    await expect(
      provider.refreshToken('old-refresh-secret')
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('rejects a grant missing publishing permissions', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        access_token: 'access-secret',
        refresh_token: 'rotated-secret',
        expires_in: 3600,
        scope: 'read:self',
      })
    );
    await expect(
      provider.authenticate({ code: 'code', codeVerifier: 'verifier' })
    ).rejects.toBeInstanceOf(NotEnoughScopes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a grant whose scope field leaves out the system scopes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          access_token: 'access-secret',
          refresh_token: 'rotated-secret',
          expires_in: 3600,
          scope: 'read:self write:post write:media read:media',
        })
      )
      .mockResolvedValueOnce(userResponse());
    await expect(
      provider.authenticate({ code: 'code', codeVerifier: 'verifier' })
    ).resolves.toMatchObject({ id: 'creator-id', refreshToken: 'rotated-secret' });
  });

  it('rejects non-creator accounts', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ uuid: 'fan', isCreator: false }));
    const rejected = provider.authenticate({
      code: 'code',
      codeVerifier: 'verifier',
    });
    await expect(rejected).rejects.toBeInstanceOf(NotEnoughScopes);
    await expect(rejected).rejects.toMatchObject({
      message: expect.stringContaining('creator account'),
    });
  });

  it('registers its settings so scheduled posts validate as Fanvue', () => {
    expect(allProviders()).toContainEqual({ value: FanvueDto, name: 'fanvue' });
  });

  it.each(['subscribers', 'followers-and-subscribers'] as const)(
    'publishes text to %s with versioned headers and preserves a returned URL',
    async (audience) => {
      fetchMock.mockResolvedValueOnce(
        json(
          {
            uuid: 'remote-post',
            url: 'https://www.fanvue.com/returned-post-url',
          },
          201
        )
      );
      await expect(publish(post({ settings: { audience } }))).resolves.toEqual([
        {
          id: 'local-post',
          postId: 'remote-post',
          releaseURL: 'https://www.fanvue.com/returned-post-url',
          status: 'success',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        `${API}/posts`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer access-secret',
            'X-Fanvue-API-Version': '2025-06-26',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'Hello fans', audience }),
        })
      );
    }
  );

  it('does not invent a post URL when none is supplied', async () => {
    fetchMock.mockResolvedValueOnce(json({ uuid: 'remote-post' }, 201));
    await expect(publish()).resolves.toMatchObject([{ releaseURL: '' }]);
  });

  function mockUpload(
    options: { missingEtag?: boolean; status?: string; size?: number } = {}
  ) {
    fetchMock.mockImplementation(
      async (input: string, init: RequestInit = {}) => {
        if (input === 'https://media.example.com/file.mp4') {
          if (init.method === 'HEAD')
            return new Response(null, {
              headers: { 'content-length': String(options.size ?? 7) },
            });
          const range = (init.headers as any).Range;
          return new Response(range === 'bytes=0-3' ? 'abcd' : 'efg', {
            status: 206,
          });
        }
        if (input === `${API}/media/uploads`)
          return json({
            mediaUuid: 'media-id',
            uploadId: 'upload/id',
            partSize: 4,
            maxParts: 256,
            totalParts: 2,
          });
        if (input === `${API}/media/uploads/upload%2Fid/parts/urls?from=1&to=2`)
          return json({
            partSize: 4,
            parts: [
              { partNumber: 1, url: 'https://uploads.example.com/1' },
              { partNumber: 2, url: 'https://uploads.example.com/2' },
            ],
          });
        if (input.startsWith('https://uploads.example.com/'))
          return new Response(null, {
            headers: options.missingEtag
              ? {}
              : { etag: `"etag-${input.slice(-1)}"` },
          });
        if (input === `${API}/media/uploads/upload%2Fid`)
          return json({ status: 'processing' });
        if (input === `${API}/media/media-id`)
          return json({ status: options.status || 'ready' });
        if (input === `${API}/posts`) return json({ uuid: 'remote-post' }, 201);
        throw new Error('Unexpected mocked request');
      }
    );
  }
  const mediaPost = () =>
    post({
      media: [{ type: 'video', path: 'https://media.example.com/file.mp4' }],
      settings: { audience: 'followers-and-subscribers', price: 399 },
    });

  it.each(['image', 'video'] as const)(
    'uploads %s parts, completes with ETags, waits for readiness, then publishes',
    async (type) => {
      mockUpload();
      const details = mediaPost();
      details.media[0].type = type;
      await publish(details);
      expect(
        fetchMock.mock.calls.map(([url, init]) => [url, init.method || 'GET'])
      ).toEqual([
        ['https://media.example.com/file.mp4', 'HEAD'],
        [`${API}/media/uploads`, 'POST'],
        [`${API}/media/uploads/upload%2Fid/parts/urls?from=1&to=2`, 'GET'],
        ['https://media.example.com/file.mp4', 'GET'],
        ['https://uploads.example.com/1', 'PUT'],
        ['https://media.example.com/file.mp4', 'GET'],
        ['https://uploads.example.com/2', 'PUT'],
        [`${API}/media/uploads/upload%2Fid`, 'PATCH'],
        [`${API}/media/media-id`, 'GET'],
        [`${API}/posts`, 'POST'],
      ]);
      const calls = fetchMock.mock.calls;
      expect(JSON.parse(calls[1][1].body)).toEqual({
        name: 'file.mp4',
        filename: 'file.mp4',
        mediaType: type,
        sizeBytes: 7,
      });
      expect(calls[4][1].body.toString()).toBe('abcd');
      expect(calls[6][1].body.toString()).toBe('efg');
      expect(calls[4][1].headers).toBeUndefined();
      expect(calls[6][1].headers).toBeUndefined();
      expect(calls[4][1].dispatcher).toBeDefined();
      expect(JSON.parse(calls[7][1].body)).toEqual({
        parts: [
          { PartNumber: 1, ETag: '"etag-1"' },
          { PartNumber: 2, ETag: '"etag-2"' },
        ],
      });
      expect(JSON.parse(calls[9][1].body)).toEqual({
        text: 'Hello fans',
        audience: 'followers-and-subscribers',
        mediaUuids: ['media-id'],
        price: 399,
      });
      for (const [url, init] of calls.filter(([url]) => url.startsWith(API))) {
        expect(init.headers['X-Fanvue-API-Version']).toBe('2025-06-26');
      }
      expect(timer).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects missing part ETags before completing or publishing', async () => {
    mockUpload({ missingEtag: true });
    await expect(publish(mediaPost())).rejects.toThrow('ETag');
    expect(
      fetchMock.mock.calls.some(([, init]) => init.method === 'PATCH')
    ).toBe(false);
  });

  it.each(['error', 'processing'])(
    'does not publish media left in %s',
    async (status) => {
      mockUpload({ status });
      await expect(publish(mediaPost())).rejects.toBeInstanceOf(BadBody);
      expect(fetchMock.mock.calls.some(([url]) => url === `${API}/posts`)).toBe(
        false
      );
      expect(timer).toHaveBeenCalledTimes(status === 'error' ? 1 : 60);
    }
  );

  it('reports a processing failure on the final poll without publishing', async () => {
    mockUpload({ status: 'processing' });
    const implementation = fetchMock.getMockImplementation()!;
    let polls = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (url === `${API}/media/media-id` && ++polls === 60) {
        return json({ status: 'error' });
      }
      return implementation(url, init);
    });
    await expect(publish(mediaPost())).rejects.toThrow('could not process');
    expect(polls).toBe(60);
    expect(fetchMock.mock.calls.some(([url]) => url === `${API}/posts`)).toBe(
      false
    );
  });

  it('rejects oversized media before creating an upload session', async () => {
    mockUpload({ size: 1610612737 });
    await expect(publish(mediaPost())).rejects.toThrow('1.5 GiB');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    post({ settings: { audience: 'followers' as any } }),
    post({ settings: { audience: 'subscribers', price: 299 } }),
    post({ settings: { audience: 'subscribers', price: 300.5 } }),
    post({ settings: { audience: 'subscribers', price: 300 } }),
    post({ message: '' }),
    post({ message: 'a'.repeat(5001) }),
    post({
      media: [{ type: 'audio' as any, path: 'https://example.com/a.mp3' }],
    }),
  ])(
    'rejects invalid post input before any network calls (%#)',
    async (details) => {
      await expect(publish(details)).rejects.toBeInstanceOf(BadBody);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('rejects comments without silently dropping them', async () => {
    await expect(
      provider.post('creator', 'secret', [post(), post()], {} as any)
    ).rejects.toThrow('without comments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates settings server-side and requires media for paid posts at scheduling time', async () => {
    for (const price of [0, 299, 300.5, '300', NaN, Infinity]) {
      expect(
        (
          await validate(
            plainToInstance(FanvueDto, { audience: 'subscribers', price })
          )
        ).length
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(FanvueDto, { audience: 'subscribers', price: 300 })
      )
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(FanvueDto, { audience: 'followers-and-subscribers' })
      )
    ).toEqual([]);
    expect(
      await provider.checkValidity([[]], {
        audience: 'subscribers',
        price: 300,
      })
    ).toContain('require');
    expect(provider.maxLength()).toBe(5000);
  });

  it.each([401, 403])(
    'maps API status %s to refresh-needed',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        json({ error: 'Unauthorized access-secret' }, status)
      );
      await expect(publish()).rejects.toBeInstanceOf(RefreshToken);
    }
  );

  it('maps rejected post requests to bad-body', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Validation failed' }, 400));
    await expect(publish()).rejects.toBeInstanceOf(BadBody);
  });

  it.each(['oauth', 'malformed'])(
    'keeps credentials out of %s failures and serialized details',
    async (kind) => {
      fetchMock.mockResolvedValueOnce(
        kind === 'oauth'
          ? json(
              {
                error: 'invalid_grant',
                error_description: 'The refresh token is invalid',
              },
              400
            )
          : new Response('not json')
      );
      try {
        await provider.refreshToken('old-refresh-secret');
        throw new Error('Expected failure');
      } catch (error: any) {
        expect(error.message).not.toBe('Expected failure');
        const serialized = error.message + JSON.stringify(error);
        for (const value of [
          'test-client-secret',
          Buffer.from('client-id:test-client-secret').toString('base64'),
          'old-refresh-secret',
        ])
          expect(serialized).not.toContain(value);
      }
    }
  );
});
