import { TwitterApi } from 'twitter-api-v2';
import { XProvider } from './x.provider';
import { DiscordProvider } from './discord.provider';
import { DribbbleProvider } from './dribbble.provider';
import { FacebookProvider } from './facebook.provider';
import { FanvueProvider } from './fanvue.provider';
import { GmbProvider } from './gmb.provider';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { KickProvider } from './kick.provider';
import { LinkedinProvider } from './linkedin.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { MastodonProvider } from './mastodon.provider';
import { MastodonCustomProvider } from './mastodon.custom.provider';
import { MeweProvider } from './mewe.provider';
import { PinterestProvider } from './pinterest.provider';
import { RedditProvider } from './reddit.provider';
import { SlackProvider } from './slack.provider';
import { ThreadsProvider } from './threads.provider';
import { TiktokProvider } from './tiktok.provider';
import { TiktokBusinessProvider } from './tiktok.business.provider';
import { TumblrProvider } from './tumblr.provider';
import { TwitchProvider } from './twitch.provider';
import { VkProvider } from './vk.provider';
import { WhopProvider } from './whop.provider';
import { YoutubeProvider } from './youtube.provider';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; jest.restoreAllMocks(); });
const providers: [string, new () => any][] = [
  ['discord', DiscordProvider],
  ['dribbble', DribbbleProvider],
  ['facebook', FacebookProvider],
  ['fanvue', FanvueProvider],
  ['gmb', GmbProvider],
  ['instagram', InstagramProvider],
  ['instagram-standalone', InstagramStandaloneProvider],
  ['kick', KickProvider],
  ['linkedin', LinkedinProvider],
  ['linkedin-page', LinkedinPageProvider],
  ['mastodon', MastodonProvider],
  ['mewe', MeweProvider],
  ['pinterest', PinterestProvider],
  ['reddit', RedditProvider],
  ['slack', SlackProvider],
  ['threads', ThreadsProvider],
  ['tiktok', TiktokProvider],
  ['tiktok-business', TiktokBusinessProvider],
  ['tumblr', TumblrProvider],
  ['twitch', TwitchProvider],
  ['vk', VkProvider],
  ['whop', WhopProvider],
  ['youtube', YoutubeProvider],
];

describe.each([
  ['', 'https://studio.test'],
  ['/dashboard/studio', 'https://linkself.net'],
  ['/dashboard/studio', 'https://linkself.net/dashboard/studio/'],
])('OAuth callback prefix %s with frontend %s', (base, frontend) => {
  beforeEach(() => {
    process.env.LINKSELF_BASE_PATH = base;
    process.env.FRONTEND_URL = frontend;
    process.env.FANVUE_CLIENT_ID = 'test-client';
    process.env.FANVUE_CLIENT_SECRET = 'test-secret';
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('OAuth URL construction must not use the network');
    });
  });
  it('builds the X OAuth callback before the SDK request', async () => {
    process.env.X_API_KEY = 'test-key';
    process.env.X_API_SECRET = 'test-secret';
    delete process.env.X_URL;
    const authLink = jest.spyOn(TwitterApi.prototype, 'generateAuthLink').mockResolvedValue({
      url: 'https://x.test/authorize', oauth_token: 'test-token', oauth_token_secret: 'test-secret',
    } as any);
    await new XProvider().generateAuthUrl();
    expect(authLink).toHaveBeenCalledWith(new URL(frontend).origin + base + '/integrations/social/x', expect.any(Object));
  });
  it('uses the same prefixed callback in the token exchange', async () => {
    await expect(new LinkedinProvider().authenticate({ code: 'code', codeVerifier: 'verifier' })).rejects.toThrow('must not use the network');
    const options = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(options.body.get('redirect_uri')).toBe(new URL(frontend).origin + base + '/integrations/social/linkedin');
  });
  it.each(providers)('%s keeps redirect_uri inside Studio', async (id, Provider) => {
    const { url } = await new Provider().generateAuthUrl();
    const params = new URL(url).searchParams;
    const callback = params.get('redirect_uri');
    const expected = new URL(frontend).origin + base + '/integrations/social/' + id;
    // TikTok Business retains its registered trailing slash in both modes.
    expect(callback).toBe(expected + (id === 'tiktok-business' ? '/' : ''));
  });
  it('keeps any-server Mastodon on its own callback in the link and the token exchange', async () => {
    const callback = new URL(frontend).origin + base + '/integrations/social/mastodon-custom';
    const external = { instanceUrl: 'https://social.example', client_id: 'cid', client_secret: 'secret' } as any;
    const { url } = await new MastodonCustomProvider().generateAuthUrl(undefined, external);
    expect(new URL(url).origin).toBe('https://social.example');
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(callback);
    await expect(new MastodonCustomProvider().authenticate({ code: 'code', codeVerifier: 'verifier' }, external)).rejects.toThrow();
    const [target, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(target).toBe('https://social.example/oauth/token');
    expect(options.body.get('redirect_uri')).toBe(callback);
  });
  it('registers any-server Mastodon apps as LinkSelf Social with that callback', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => ({ json: async () => ({ client_id: 'cid', client_secret: 'secret', id: '1' }) }));
    await expect(new MastodonCustomProvider().externalUrl('https://social.example')).resolves.toEqual({ client_id: 'cid', client_secret: 'secret' });
    const [target, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(target).toBe('https://social.example/api/v1/apps');
    expect(options.body.get('client_name')).toBe('LinkSelf Social');
    expect(options.body.get('redirect_uris')).toBe(new URL(frontend).origin + base + '/integrations/social/mastodon-custom');
  });
});
