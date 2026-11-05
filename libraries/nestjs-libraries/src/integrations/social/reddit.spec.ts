import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync } from 'fs';
import { RedditProvider } from './reddit.provider';
import { RedditSettingsDto } from '../../dtos/posts/providers-settings/reddit.dto';
const agent =
  'web:net.linkself.social:1.0 (LinkSelf Social; https://linkself.net)';
const entry = {
  value: {
    subreddit: '/r/test',
    title: 'Title',
    type: 'self',
    is_flair_required: false,
  },
};
const json = (value: unknown) => new Response(JSON.stringify(value));

describe('Reddit posting policy', () => {
  it.each([0, 1, 2])('requires exactly one subreddit (%s)', async (count) => {
    const errors = await validate(
      plainToInstance(RedditSettingsDto, {
        subreddit: Array(count).fill(entry),
      })
    );
    expect(errors.length === 0).toBe(count === 1);
  });
  it('offers an add control only while no subreddit is selected', () => {
    const source = readFileSync(
      'apps/frontend/src/components/new-launch/providers/reddit/reddit.provider.tsx',
      'utf8'
    );
    expect(source).toContain('if (fields.length === 0) append({});');
    expect(source).toMatch(
      /fields.length === 0 &&\s*<Button onClick={addField}/
    );
  });
  it('identifies token exchange, refresh and identity requests', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) =>
        json(
          String(url).includes('access_token')
            ? {
                access_token: 'token',
                refresh_token: 'refresh',
                expires_in: 3600,
                scope: 'read identity submit flair',
              }
            : { id: 'owner', name: 'Owner' }
        )
      );
    try {
      const provider = new RedditProvider();
      await provider.authenticate({ code: 'code', codeVerifier: '' });
      await provider.refreshToken('refresh');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      fetchMock.mock.calls.forEach(([, options]) =>
        expect(options?.headers).toMatchObject({ 'User-Agent': agent })
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('identifies search, restrictions, submission, status and comment requests', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) => {
        const target = String(url);
        if (target.includes('/subreddits/search'))
          return json({ data: { children: [] } });
        if (target.endsWith('/about'))
          return json({ data: { submission_type: 'self' } });
        if (target.includes('post_requirements'))
          return json({ is_flair_required: false });
        if (target.includes('link_flair_v2')) return json([]);
        if (target.includes('/submitted'))
          return json({
            data: {
              children: [
                {
                  data: {
                    subreddit: 'test',
                    title: 'Title',
                    created_utc: Date.now() / 1000,
                    id: 'published',
                  },
                },
              ],
            },
          });
        if (target.endsWith('/api/submit'))
          return json({ json: { data: { id: 'published' } } });
        if (target.endsWith('/api/comment'))
          return json({
            json: {
              data: {
                things: [{ data: { id: 'comment', permalink: '/comment' } }],
              },
            },
          });
        throw new Error('Unexpected request');
      });
    try {
      const provider = new RedditProvider();
      await provider.subreddits('token', { word: 'test' });
      await provider.restrictions('token', { subreddit: '/r/test' });
      const [pending] = await provider.postPending('id', 'token', [
        { id: 'post', message: 'hello', settings: { subreddit: [entry] } },
      ] as any);
      const check = await provider.checkPostStatus(
        'token',
        pending.pendingData,
        { profile: 'owner' } as any
      );
      if (check.status !== 'ready')
        throw new Error('Expected ready submission');
      await provider.finalizePost('token', check.pendingData, {} as any);
      await provider.checkPostStatus(
        'token',
        {
          ...check.pendingData,
          armed: { ...check.pendingData.armed, submitted: true },
        },
        { profile: 'owner' } as any
      );
      await provider.comment(
        '',
        'published',
        '',
        'token',
        [{ id: 'comment', message: 'hello' }] as any,
        {} as any
      );
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
      fetchMock.mock.calls.forEach(([, options]) =>
        expect(options?.headers).toMatchObject({ 'User-Agent': agent })
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
