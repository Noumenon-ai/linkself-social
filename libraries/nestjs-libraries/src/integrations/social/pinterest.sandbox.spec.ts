import { PinterestProvider } from '@gitroom/nestjs-libraries/integrations/social/pinterest.provider';

describe('Pinterest API address', () => {
  const saved = process.env.PINTEREST_API_URL;
  let urls: string[];
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    urls = [];
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input: any) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith('/v5/oauth/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'token',
              refresh_token: 'refresh',
              expires_in: 2592000,
              scope:
                'boards:read,boards:write,pins:read,pins:write,user_accounts:read',
            })
          );
        }
        if (url.endsWith('/v5/user_account')) {
          return new Response(
            JSON.stringify({ id: '42', username: 'linkself' })
          );
        }
        if (url.includes('/v5/boards')) {
          return new Response(
            JSON.stringify({ items: [{ id: '7', name: 'LinkSelf' }] })
          );
        }
        if (url.endsWith('/v5/pins')) {
          return new Response(JSON.stringify({ id: '99' }), { status: 201 });
        }
        return new Response('{}', { status: 404 });
      });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    if (saved === undefined) {
      delete process.env.PINTEREST_API_URL;
    } else {
      process.env.PINTEREST_API_URL = saved;
    }
  });

  it('uses the production API when nothing is set', async () => {
    delete process.env.PINTEREST_API_URL;
    await new PinterestProvider().boards('token');
    expect(urls).toEqual(['https://api.pinterest.com/v5/boards?page_size=250']);
  });

  it('sends the sign-in code, profile and board calls to the sandbox when set', async () => {
    process.env.PINTEREST_API_URL = 'https://api-sandbox.pinterest.com/';
    const provider = new PinterestProvider();
    await expect(
      provider.authenticate({ code: 'c', codeVerifier: 'v', refresh: '' })
    ).resolves.toMatchObject({ id: '42', accessToken: 'token' });
    await expect(provider.boards('token')).resolves.toEqual([
      { id: '7', name: 'LinkSelf' },
    ]);
    expect(urls).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
      'https://api-sandbox.pinterest.com/v5/boards?page_size=250',
    ]);
  });

  it('keeps the authorize page on www.pinterest.com in the sandbox', async () => {
    process.env.PINTEREST_API_URL = 'https://api-sandbox.pinterest.com';
    const { url } = await new PinterestProvider().generateAuthUrl();
    expect(url.startsWith('https://www.pinterest.com/oauth/?')).toBe(true);
  });

  it('creates the pin in the sandbox', async () => {
    process.env.PINTEREST_API_URL = 'https://api-sandbox.pinterest.com';
    await expect(
      new PinterestProvider().finalizePost(
        'token',
        {
          mediaId: '',
          message: 'hello',
          settings: { board: '7' },
          imagePaths: ['https://example.com/a.jpg'],
          attempting: true,
          confirmed: true,
        } as any,
        {} as any
      )
    ).resolves.toMatchObject({ status: 'completed', postId: '99' });
    expect(urls).toEqual(['https://api-sandbox.pinterest.com/v5/pins']);
  });

  it.each([
    'https://evil.example.com',
    'http://api-sandbox.pinterest.com',
    'https://api-sandbox.pinterest.com.evil.example',
  ])('refuses %s before any request carries the app secret', async (value) => {
    process.env.PINTEREST_API_URL = value;
    await expect(
      new PinterestProvider().authenticate({
        code: 'c',
        codeVerifier: 'v',
        refresh: '',
      })
    ).rejects.toThrow('PINTEREST_API_URL must be');
    expect(urls).toEqual([]);
  });
});
