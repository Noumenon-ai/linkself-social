import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

describe('TikTok dashboard creator info', () => {
  const token = 'test-only-access-token';
  const data = {
    creator_nickname: 'Creator',
    creator_username: 'creator',
    creator_avatar_url: 'https://example.com/avatar.jpg',
    privacy_level_options: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    comment_disabled: true,
    duet_disabled: false,
    stitch_disabled: true,
    max_video_post_duration_sec: 300,
  };
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data, error: { code: 'ok' } }))
      );
  });

  afterEach(() => fetchMock.mockRestore());

  it('maps every creator field and uses the required request', async () => {
    await expect(new TiktokProvider().creatorInfo(token)).resolves.toEqual({
      canPost: true,
      nickname: 'Creator',
      username: 'creator',
      avatarUrl: 'https://example.com/avatar.jpg',
      privacyLevelOptions: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: true,
      duetDisabled: false,
      stitchDisabled: true,
      maxVideoPostDurationSec: 300,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      })
    );
  });

  it.each([
    ['spam_risk_too_many_posts', 'daily post limit'],
    ['spam_risk_user_banned_from_posting', 'banned from posting'],
    ['reached_active_user_cap', 'daily posting quota'],
  ])('returns a notice without disconnecting for %s', async (code, reason) => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: code === 'reached_active_user_cap' ? null : undefined,
          error: { code },
        })
      )
    );
    await expect(new TiktokProvider().creatorInfo(token)).resolves.toEqual({
      canPost: false,
      reason: expect.stringContaining(reason),
      nickname: '',
      username: '',
      avatarUrl: '',
      privacyLevelOptions: [],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: null,
    });
  });

  it('refreshes an invalid token through the existing fetch wrapper', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'access_token_invalid' } }),
        { status: 401 }
      )
    );
    await expect(
      new TiktokProvider().creatorInfo(token)
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it.each(['unexpected_error', 'toString'])(
    'throws BadBody for unknown code %s',
    async (code) => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code } }))
      );
      await expect(
        new TiktokProvider().creatorInfo(token)
      ).rejects.toBeInstanceOf(BadBody);
    }
  );

  it('exposes creatorInfo only to dashboard functions', () => {
    expect(
      Reflect.getMetadata(
        'custom:dashboard_function',
        TiktokProvider.prototype,
        'creatorInfo'
      )
    ).toBe(true);
    const tools =
      Reflect.getMetadata('custom:tool', TiktokProvider.prototype) ?? [];
    expect(
      tools.some(
        (tool: { methodName: string }) => tool.methodName === 'creatorInfo'
      )
    ).toBe(false);
    expect(
      Reflect.getMetadata(
        'custom:tool',
        TiktokProvider.prototype,
        'creatorInfo'
      )
    ).toBeUndefined();
  });

  it('does not return credentials or extra response fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { ...data, access_token: token },
          access_token: token,
          error: { code: 'ok', message: token },
        })
      )
    );
    const result = await new TiktokProvider().creatorInfo(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('error');
    expect(result).not.toHaveProperty('data');
  });

  it('uses null when TikTok omits the video duration limit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { ...data, max_video_post_duration_sec: undefined },
          error: { code: 'ok' },
        })
      )
    );
    await expect(
      new TiktokProvider().creatorInfo(token)
    ).resolves.toMatchObject({
      maxVideoPostDurationSec: null,
    });
  });
});

describe('TikTok settings validation', () => {
  const payload = {
    title: 'A video',
    content_posting_method: 'DIRECT_POST',
    privacy_level: 'PUBLIC_TO_EVERYONE',
    duet: false,
    stitch: false,
    comment: true,
    autoAddMusic: 'no',
    brand_content_toggle: false,
    brand_organic_toggle: false,
    video_made_with_ai: false,
  };
  const errorsFor = async (changes: Record<string, unknown> = {}) =>
    validate(plainToInstance(TikTokDto, { ...payload, ...changes }));
  const messagesFor = async (changes: Record<string, unknown>) =>
    (await errorsFor(changes)).flatMap((error) =>
      Object.values(error.constraints ?? {})
    );

  it('requires a privacy choice for direct posts', async () => {
    expect(await messagesFor({ privacy_level: undefined })).toContain(
      'Choose who can see this video'
    );
  });

  it('accepts upload mode without a privacy choice', async () => {
    expect(
      await errorsFor({
        content_posting_method: 'UPLOAD',
        privacy_level: undefined,
      })
    ).toEqual([]);
  });

  it('requires a brand selection when disclosure is enabled', async () => {
    expect(await messagesFor({ disclose: true })).toContain(
      'You need to indicate if your content promotes yourself, a third party, or both'
    );
  });

  it.each([
    { brand_organic_toggle: true },
    { brand_content_toggle: true },
    { brand_organic_toggle: true, brand_content_toggle: true },
  ])('accepts disclosure with a brand selection: %j', async (brands) => {
    expect(await errorsFor({ disclose: true, ...brands })).toEqual([]);
  });

  it('accepts old clients without disclosure', async () => {
    expect(await errorsFor()).toEqual([]);
  });

  it('requires a boolean disclosure value', async () => {
    expect(await errorsFor({ disclose: 'true' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'disclose' }),
      ])
    );
  });

  it('ignores disclosure brand selection for upload mode', async () => {
    expect(
      await errorsFor({ disclose: true, content_posting_method: 'UPLOAD' })
    ).toEqual([]);
  });

  it('rejects private branded content on direct posts', async () => {
    expect(
      await messagesFor({
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toContain('Branded content visibility cannot be set to private.');
  });

  it('allows private branded content settings in upload mode', async () => {
    expect(
      await errorsFor({
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
        content_posting_method: 'UPLOAD',
      })
    ).toEqual([]);
  });

  it('keeps a complete previously valid payload valid', async () => {
    expect(
      await errorsFor({
        duet: true,
        stitch: true,
        brand_content_toggle: true,
        brand_organic_toggle: true,
        video_made_with_ai: true,
        music: {
          id: 'track',
          title: 'Track',
          artist: 'Artist',
          image: 'cover.jpg',
          audio_volume: 50,
          video_volume: 100,
        },
        location: { id: 'place', name: 'Place', address: 'Address' },
      })
    ).toEqual([]);
  });

  it('rejects values outside the privacy allowlist', async () => {
    expect(
      await messagesFor({ privacy_level: "EVERYONE'; DROP TABLE" })
    ).toContain('Choose who can see this video');
  });
});
