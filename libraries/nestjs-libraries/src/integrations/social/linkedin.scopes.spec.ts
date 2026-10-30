import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';

describe('LinkedIn scopes', () => {
  const organizationScopes = [
    'r_basicprofile',
    'rw_organization_admin',
    'w_organization_social',
    'r_organization_social',
  ];

  it('personal accounts ask only for the self-serve products', async () => {
    const provider = new LinkedinProvider();
    expect(provider.scopes).toEqual(['openid', 'profile', 'w_member_social']);
    const { url } = await provider.generateAuthUrl();
    expect(new URL(url).searchParams.get('scope')).toBe(
      'openid profile w_member_social'
    );
  });

  it('pages keep the organization scopes', () => {
    expect(new LinkedinPageProvider().scopes).toEqual(
      expect.arrayContaining(organizationScopes)
    );
  });

  it('a personal grant without organization scopes is accepted', () => {
    const provider = new LinkedinProvider();
    expect(
      provider.checkScopes(provider.scopes, 'openid,profile,w_member_social')
    ).toBe(true);
  });

  it('connects a personal account without the profile call that needs r_basicprofile', async () => {
    const urls: string[] = [];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input: any) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/oauth/v2/accessToken')) {
          return new Response(
            JSON.stringify({
              access_token: 'token',
              expires_in: 5184000,
              scope: 'openid,profile,w_member_social',
            })
          );
        }
        if (url.includes('/v2/userinfo')) {
          return new Response(
            JSON.stringify({ sub: 'abc123', name: 'Owner', picture: 'p.jpg' })
          );
        }
        return new Response('{"status":403}', { status: 403 });
      });
    try {
      await expect(
        new LinkedinProvider().authenticate({ code: 'c', codeVerifier: 'v' })
      ).resolves.toMatchObject({
        id: 'abc123',
        name: 'Owner',
        accessToken: 'token',
        username: '',
      });
      expect(urls.some((url) => url.includes('/v2/me'))).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('a grant missing the posting scope is still refused', () => {
    const provider = new LinkedinProvider();
    expect(() =>
      provider.checkScopes(provider.scopes, 'openid,profile')
    ).toThrow();
  });
});
