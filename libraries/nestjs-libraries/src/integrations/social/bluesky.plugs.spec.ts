import { BskyAgent } from '@atproto/api';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { BlueskyProvider } from './bluesky.provider';

jest.mock('@atproto/api', () => ({
  BskyAgent: jest.fn(),
  RichText: class {
    text: string;
    facets: unknown[] = [];
    constructor({ text }: { text: string }) {
      this.text = text;
    }
  },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn() }));

describe('Bluesky plug thresholds', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['autoRepostPost', 'repost', undefined, false],
    ['autoRepostPost', 'repost', 9, false],
    ['autoRepostPost', 'repost', 10, true],
    ['autoRepostPost', 'repost', 11, true],
    ['autoPlugPost', 'post', undefined, false],
    ['autoPlugPost', 'post', 9, false],
    ['autoPlugPost', 'post', 10, true],
    ['autoPlugPost', 'post', 11, true],
  ] as const)(
    '%s with %s and %s likes returns %s',
    async (method, action, likes, expected) => {
      const agent = {
        login: jest.fn(),
        getPostThread: jest.fn().mockResolvedValue({
          data: {
            thread: {
              post: { likeCount: likes, uri: 'post-uri', cid: 'post-cid' },
            },
          },
        }),
        repost: jest.fn(),
        post: jest.fn(),
      };
      (BskyAgent as unknown as jest.Mock).mockReturnValue(agent);
      jest.spyOn(AuthService, 'fixedDecryption').mockReturnValue(
        JSON.stringify({
          service: 'https://example.test',
          identifier: 'account',
          password: 'secret',
        })
      );
      await expect(
        new BlueskyProvider()[method](
          { customInstanceDetails: 'encrypted' } as never,
          'post-uri',
          { likesAmount: '10', post: 'A follow-up post' }
        )
      ).resolves.toBe(expected);
      expect(agent[action]).toHaveBeenCalledTimes(expected ? 1 : 0);
      if (expected && action === 'repost') {
        expect(agent.repost).toHaveBeenCalledWith('post-uri', 'post-cid');
      }
      if (expected && action === 'post') {
        expect(agent.post).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'A follow-up post',
            reply: {
              root: { uri: 'post-uri', cid: 'post-cid' },
              parent: { uri: 'post-uri', cid: 'post-cid' },
            },
          })
        );
      }
    }
  );
});
