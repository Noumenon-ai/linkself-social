import { PrismaRepository } from '../prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { OrganizationLimitsRepository } from './organization.limits.repository';
import {
  OrganizationLimitsService,
  LINKSELF_FREE_LIMITS,
} from './organization.limits.service';
import { IntegrationRepository } from '../integrations/integration.repository';
import { IntegrationService } from '../integrations/integration.service';
import { PostsService } from '../posts/posts.service';
import { SettingsController } from '@gitroom/backend/api/routes/settings.controller';

jest.mock('../../../upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('../../../redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('../../../integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('../../../integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class {},
}));
jest.mock('../organizations/organization.service', () => ({
  OrganizationService: class {},
}));
jest.mock('../media/media.service', () => ({ MediaService: class {} }));
jest.mock('../notifications/notification.service', () => ({
  NotificationService: class {},
}));
jest.mock('../../../short-linking/short.link.service', () => ({
  ShortLinkService: class {},
}));
jest.mock('../../../openai/openai.service', () => ({
  OpenaiService: class {},
}));



// Load the installed sanitizer through Node's native ESM-compatible loader.
jest.mock('isomorphic-dompurify', () =>
  (process as any).getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('isomorphic-dompurify')
);

describe('Organization limits', () => {
  const env = { ...process.env };
  let saved: any;
  let channels: any[];
  let posts: any[];
  let model: any;
  let repository: OrganizationLimitsRepository;
  let service: OrganizationLimitsService;
  let integrationService: IntegrationService;
  let postService: PostsService;
  let postRepository: any;
  const now = new Date('2026-11-15T12:00:00Z');
  const claims = (channels = 3) => ({
    orgId: 'org',
    plan: 'free' as const,
    channels,
    postsPerMonth: 30,
    mcp: false,
    iat: now.getTime() / 1000,
    exp: now.getTime() / 1000 + 60,
    jti: 'id',
  });
  const postBody = (count = 1, id?: string) =>
    ({
      type: 'draft',
      shortLink: false,
      date: now.toISOString(),
      tags: [],
      posts: Array.from({ length: count }, (_, index) => ({
        integration: { id: `channel-${index}` },
        settings: { __type: 'test' },
        value: [{ id, content: 'hello', image: [] }],
      })),
    } as any);

  beforeEach(() => {
    process.env.LINKSELF_URL = 'https://linkself.test';
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    jest.useFakeTimers().setSystemTime(now);
    saved = null;
    channels = [];
    posts = [];
    const live = (row: any, where: any) =>
      row.organizationId === where.organizationId && !row.deletedAt;
    model = {
      organizationLimits: {
        findUnique: jest.fn(async () => saved),
        upsert: jest.fn(async ({ create, update }) => {
          saved = saved ? { ...saved, ...update } : create;
          return { organizationId: 'org' };
        }),
      },
      organization: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'org' ? { id: 'org' } : null
        ),
      },
      integration: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = channels.find(
            (row) =>
              row.organizationId ===
                where.organizationId_internalId.organizationId &&
              row.internalId === where.organizationId_internalId.internalId
          );
          if (existing) return Object.assign(existing, update);
          const row = {
            id: 'new-channel',
            disabled: false,
            deletedAt: null,
            ...create,
          };
          channels.push(row);
          return row;
        }),
        count: jest.fn(
          async ({ where }) =>
            channels.filter(
              (row) =>
                live(row, where) &&
                (where.disabled === undefined ||
                  row.disabled === where.disabled)
            ).length
        ),
        findFirst: jest.fn(async ({ where }) =>
          channels.find(
            (row) =>
              live(row, where) &&
              (where.id === undefined || row.id === where.id) &&
              (where.internalId === undefined ||
                row.internalId === where.internalId)
          )
        ),
        findMany: jest.fn(async ({ where, take }) =>
          channels
            .filter(
              (row) =>
                live(row, where) &&
                (where.disabled === undefined ||
                  row.disabled === where.disabled)
            )
            .slice(0, take)
        ),
        update: jest.fn(async ({ where, data }) =>
          Object.assign(
            channels.find((row) => row.id === where.id),
            data
          )
        ),
        updateMany: jest.fn(async ({ where, data }) =>
          channels
            .filter(
              (row) =>
                live(row, where) &&
                (where.disabled === undefined ||
                  row.disabled === where.disabled)
            )
            .forEach((row) => Object.assign(row, data))
        ),
      },
      post: {
        count: jest.fn(
          async ({ where }) =>
            posts.filter(
              (row) =>
                live(row, where) &&
                row.createdAt >= where.createdAt.gte &&
                row.createdAt < where.createdAt.lt
            ).length
        ),
        findMany: jest.fn(async ({ where }) =>
          posts.filter(
            (row) =>
              live(row, where) &&
              where.OR.some(
                (condition: any) =>
                  condition.id?.in.includes(row.id) ||
                  condition.group?.in.includes(row.group)
              )
          )
        ),
      },
    };
    const prisma = new PrismaRepository(model);
    repository = new OrganizationLimitsRepository(
      prisma,
      prisma,
      prisma,
      prisma
    );
    const integrations = new IntegrationRepository(
      prisma,
      prisma,
      prisma,
      prisma,
      prisma,
      prisma
    );
    service = new OrganizationLimitsService(repository, integrations);
    integrationService = new IntegrationService(
      integrations,
      {} as never,
      {
        isEnabledProvider: () => true,
        getMigrationTarget: (): string | undefined => undefined,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      service
    );
    postRepository = {
      createOrUpdatePost: jest.fn(async (_state, org, _date, body) => {
        const id = body.value[0].id || `created-${posts.length}`;
        if (!posts.some((row) => row.id === id))
          posts.push({
            id,
            organizationId: org,
            deletedAt: null,
            createdAt: now,
          });
        return { posts: [{ id, state: 'DRAFT' }] };
      }),
    };
    postService = new PostsService(
      postRepository,
      { getSocialIntegration: () => ({}) } as never,
      integrationService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service
    );
    jest
      .spyOn(postService as any, 'detachStaleAnchors')
      .mockResolvedValue(undefined);
    jest
      .spyOn(postService as any, 'startWorkflow')
      .mockResolvedValue(undefined);
  });
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });

  const fillChannels = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${i}`,
      internalId: `${i}`,
      providerIdentifier: 'test',
      organizationId: 'org',
      deletedAt: null,
      disabled: false,
    }));
  const fillPosts = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${i}`,
      integrationId: 'channel-0',
      organizationId: 'org',
      deletedAt: null,
      createdAt: now,
    }));

  it.each([false, true])(
    'rejects deleted pending page selections (deleted during provider request: %s)',
    async (duringRequest) => {
      const pending = {
        id: 'pending',
        organizationId: 'org',
        inBetweenSteps: true,
        providerIdentifier: 'test',
        token: 'private',
      };
      const getIntegrationById = jest
        .fn()
        .mockResolvedValueOnce({
          ...pending,
          deletedAt: duringRequest ? null : now,
        })
        .mockResolvedValueOnce({ ...pending, deletedAt: now });
      const updateIntegration = jest.fn();
      const fetchPageInformation = jest
        .fn()
        .mockResolvedValue({ id: 'selected' });
      const integration = new IntegrationService(
        { getIntegrationById, updateIntegration } as never,
        {} as never,
        { getSocialIntegration: () => ({ fetchPageInformation }) } as never,
        {} as never,
        {} as never,
        {} as never,
        service
      );
      await expect(
        integration.saveProviderPage('org', 'pending', {})
      ).rejects.toMatchObject({ status: 404 });
      expect(updateIntegration).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'passes disabled-state preservation through page reconnects (LinkSelf: %s)',
    async (linkself) => {
      if (!linkself) delete process.env.LINKSELF_URL;
      const pending = {
        id: 'pending',
        inBetweenSteps: true,
        providerIdentifier: 'test',
        token: 'token',
      };
      const updateIntegration = jest.fn().mockResolvedValue({ id: 'page' });
      const integration = new IntegrationService(
        {
          getIntegrationById: jest.fn().mockResolvedValue(pending),
          checkForDeletedOnceAndUpdate: jest.fn(),
          updateIntegration,
        } as never,
        {} as never,
        {
          getSocialIntegration: () => ({
            fetchPageInformation: async () => ({ id: 'page', name: 'Page' }),
          }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        service
      );
      await expect(
        integration.saveProviderPage('org', 'pending', {})
      ).resolves.toEqual({ success: true });
      expect(updateIntegration).toHaveBeenCalledWith(
        'pending',
        expect.objectContaining({
          organizationId: 'org',
          internalId: 'page',
          inBetweenSteps: false,
        }),
        linkself
      );
    }
  );

  it('uses one Free default without inserting rows', async () => {
    expect(await service.get('org')).toEqual(LINKSELF_FREE_LIMITS);
    expect(model.organizationLimits.upsert).not.toHaveBeenCalled();
  });
  it('keeps upstream unlimited without LINKSELF_URL, even with a stored row', async () => {
    delete process.env.LINKSELF_URL;
    saved = claims(0);
    expect(await service.get('org')).toEqual({
      plan: 'unlimited',
      channels: -1,
      postsPerMonth: -1,
      mcp: true,
    });
    await service.assertCanConnect('org');
    await service.assertCanCreatePosts('org', postBody(50));
    await service.assertMcp('org');
    expect(model.organizationLimits.findUnique).not.toHaveBeenCalled();
  });
  it('upserts idempotently without persisting token claims', async () => {
    await service.set(claims());
    await service.set(claims());
    expect(saved).toEqual({
      organizationId: 'org',
      plan: 'free',
      channels: 3,
      postsPerMonth: 30,
      mcp: false,
    });
    expect(model.organizationLimits.upsert).toHaveBeenCalledTimes(2);
    expect(model.integration.updateMany).not.toHaveBeenCalled();
  });
  it('refuses new connections at the limit including disabled channels', async () => {
    channels = fillChannels(3);
    channels[0].disabled = true;
    await expect(
      integrationService.assertCanConnect('org', 'test')
    ).rejects.toMatchObject({
      status: 403,
      message:
        'Your LinkSelf plan includes 3 channels. Upgrade in LinkSelf to connect more.',
    });
  });
  it('allows only an owned live reconnect at the limit', async () => {
    channels = fillChannels(3);
    await expect(
      integrationService.assertCanConnect('org', 'test', '0')
    ).resolves.toBeUndefined();
    channels.push({
      ...channels[0],
      internalId: 'foreign',
      organizationId: 'other',
    });
    await expect(
      integrationService.assertCanConnect('org', 'test', 'foreign')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not count deleted channels or other organizations', async () => {
    channels = fillChannels(3);
    channels[0].deletedAt = now;
    channels.push({ ...channels[1], organizationId: 'other' });
    await expect(
      integrationService.assertCanConnect('org', 'test')
    ).resolves.toBeUndefined();
    expect(await repository.countChannels('org')).toBe(2);
  });
  it('reconnects a downgrade-disabled channel at the limit without enabling it', async () => {
    channels = fillChannels(5);
    await service.set(claims(3));
    const disabled = channels.find((row) => row.disabled);
    await expect(
      integrationService.assertCanConnect('org', 'test', disabled.internalId)
    ).resolves.toBeUndefined();
    await integrationService.createOrUpdateIntegration(
      undefined,
      false,
      'org',
      'Reconnected',
      undefined,
      'social',
      disabled.internalId,
      'test',
      'new-token'
    );
    expect(disabled.disabled).toBe(true);
    expect(disabled.token).toBe('new-token');
    expect(channels).toHaveLength(5);
    expect(channels.filter((row) => !row.disabled)).toHaveLength(3);
  });
  it('disables extras and re-enables on an increase that accommodates all channels', async () => {
    channels = fillChannels(5);
    await service.set(claims(3));
    expect(channels.filter((row) => row.disabled)).toHaveLength(2);
    await service.set(claims(10));
    expect(channels.filter((row) => row.disabled)).toHaveLength(0);
    expect(channels).toHaveLength(5);
    expect(model.integration.updateMany).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed upgrade retryable without a transaction', async () => {
    channels = fillChannels(5);
    await service.set(claims(3));
    model.integration.updateMany.mockRejectedValueOnce(
      new Error('write failed')
    );
    await expect(service.set(claims(10))).rejects.toThrow('write failed');
    expect(saved.channels).toBe(3);
    expect(channels.filter((row) => row.disabled)).toHaveLength(2);
    await service.set(claims(10));
    expect(saved.channels).toBe(10);
    expect(channels.filter((row) => row.disabled)).toHaveLength(0);
  });
  it('does not re-enable manually disabled channels on an identical update', async () => {
    channels = fillChannels(3);
    channels[0].disabled = true;
    await service.set(claims(3));
    await service.set(claims(3));
    expect(channels[0].disabled).toBe(true);
  });
  it('prevents manual enabling beyond the active-channel allowance', async () => {
    channels = fillChannels(4);
    channels[3].disabled = true;
    await expect(
      integrationService.enableChannel('org', 100, '3')
    ).rejects.toMatchObject({ status: 403 });
    expect(channels[3].disabled).toBe(true);
    expect(model.integration.update).not.toHaveBeenCalled();
  });
  it('allows enabling with room and leaves an already-enabled channel enabled at the limit', async () => {
    channels = fillChannels(3);
    channels[2].disabled = true;
    await integrationService.enableChannel('org', 100, '2');
    expect(channels[2].disabled).toBe(false);
    await expect(
      integrationService.enableChannel('org', 100, '2')
    ).resolves.toBeUndefined();
  });
  it.each(['WEB', 'API', 'MCP', 'AUTOPOST'])('normalizes stored content from %s', async (source) => {
    const body = postBody();
    body.posts[0].value[0].content = '<p onclick="void(0)">Hello<strong> there</strong></p><script>void(0)</script>';
    await postService.createPost('org', body, source as any);
    const stored = postRepository.createOrUpdatePost.mock.calls[0][3].value[0].content;
    expect(stored).toBe('<p>Hello<strong> there</strong></p>');
  });

  it('refuses at the monthly limit on the common creation path', async () => {
    posts = fillPosts(30);
    await expect(
      postService.createPost('org', postBody(), 'WEB')
    ).rejects.toMatchObject({
      status: 403,
      message:
        'Your LinkSelf plan includes 30 posts a month. Upgrade in LinkSelf for unlimited posts.',
    });
    expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
  });
  it.each(['WEB', 'API', 'MCP'])(
    'counts N channel rows before any write (%s)',
    async (source) => {
      posts = fillPosts(29);
      await expect(
        postService.createPost('org', postBody(2), source as any)
      ).rejects.toMatchObject({ status: 403 });
      expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
      await expect(
        postService.createPost('org', postBody(1), source as any)
      ).resolves.toHaveLength(1);
    }
  );
  it.each(['draft', 'schedule', 'update'])(
    'allows existing post edits and reschedules in %s mode',
    async (type) => {
      posts = fillPosts(30);
      postRepository.getPostById = jest.fn(async () => ({ state: 'DRAFT' }));
      await expect(
        postService.createPost('org', { ...postBody(1, '0'), type }, 'WEB')
      ).resolves.toHaveLength(1);
    }
  );
  it('does not trust update mode or an unowned id as an exemption', async () => {
    posts = fillPosts(30);
    posts.push({ ...posts[0], id: 'foreign', organizationId: 'other' });
    await expect(
      postService.createPost(
        'org',
        { ...postBody(1, 'foreign'), type: 'update' },
        'API'
      )
    ).rejects.toMatchObject({ status: 403 });
  });
  it('allows editing an owned group without existing post IDs at the limit', async () => {
    posts = fillPosts(30);
    posts[0].group = 'existing-group';
    const body = postBody();
    body.posts[0].group = 'existing-group';
    await expect(
      postService.createPost('org', body, 'WEB')
    ).resolves.toHaveLength(1);
    expect(model.post.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        deletedAt: null,
        OR: [{ id: { in: [] } }, { group: { in: ['existing-group'] } }],
      },
      select: { id: true, group: true, integrationId: true },
    });
  });
  it.each(['foreign', 'deleted', 'other-channel'])(
    'does not exempt a %s group',
    async (kind) => {
      posts = fillPosts(30);
      posts.push({
        ...posts[0],
        id: 'extra',
        group: 'unowned-group',
        ...(kind === 'foreign' ? { organizationId: 'other' } : {}),
        ...(kind === 'deleted' ? { deletedAt: now } : {}),
        ...(kind === 'other-channel' ? { integrationId: 'channel-1' } : {}),
      });
      const body = postBody();
      body.posts[0].group = 'unowned-group';
      await expect(
        postService.createPost('org', body, 'WEB')
      ).rejects.toMatchObject({ status: 403 });
      expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
    }
  );
  it('counts only new entries in a mixed edit and create request', async () => {
    posts = fillPosts(29);
    const body = postBody(2);
    body.posts[0].value[0].id = '0';
    await expect(
      postService.createPost('org', body, 'API')
    ).resolves.toHaveLength(2);
    expect(posts).toHaveLength(30);
  });
  it('allows recurring republishes of an owned post at the limit', async () => {
    posts = fillPosts(30);
    posts[0].intervalInDays = 7;
    posts[0].state = 'PUBLISHED';
    const body = {
      ...postBody(1, '0'),
      type: 'schedule',
      republish: true,
      inter: 7,
    };
    await expect(
      postService.createPost('org', body, 'WEB')
    ).resolves.toHaveLength(1);
    expect(model.post.count).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'still counts new posts with republish enabled (mixed request: %s)',
    async (mixed) => {
      posts = fillPosts(30);
      const body = {
        ...postBody(mixed ? 2 : 1),
        type: 'schedule',
        republish: true,
      };
      if (mixed) body.posts[0].value[0].id = '0';
      await expect(
        postService.createPost('org', body, 'API')
      ).rejects.toMatchObject({ status: 403 });
      expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
    }
  );
  it('returns immediately when the repository saves no posts', async () => {
    postRepository.createOrUpdatePost.mockResolvedValueOnce({ posts: [] });
    await expect(
      postService.createPost('org', postBody(2), 'WEB')
    ).resolves.toEqual([]);
    expect(postRepository.createOrUpdatePost).toHaveBeenCalledTimes(1);
    expect((postService as any).startWorkflow).not.toHaveBeenCalled();
  });
  it('counts non-deleted rows by UTC creation month, independent of publish date', async () => {
    posts = fillPosts(1);
    posts.push(
      { ...posts[0], createdAt: new Date('2026-10-31T23:59:59.999Z') },
      { ...posts[0], createdAt: new Date('2026-12-01T00:00:00Z') },
      { ...posts[0], deletedAt: now },
      { ...posts[0], organizationId: 'other' },
      {
        ...posts[0],
        createdAt: new Date('2026-11-01T00:00:00Z'),
        publishDate: new Date('2027-01-01'),
      }
    );
    expect(await service.countPosts('org')).toBe(2);
  });
  it('permits unlimited posts and MCP from stored limits', async () => {
    saved = { plan: 'pro', channels: 25, postsPerMonth: -1, mcp: true };
    await expect(service.assertMcp('org')).resolves.toBeUndefined();
    await expect(
      service.assertCanCreatePosts('org', postBody(50))
    ).resolves.toBeUndefined();
  });
  it('refuses MCP on Free', async () => {
    await expect(service.assertMcp('org')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('MCP'),
    });
  });
  it('returns usage only for the authenticated organization', async () => {
    channels = [
      ...fillChannels(2),
      { ...fillChannels(1)[0], organizationId: 'other' },
    ];
    posts = [...fillPosts(3), { ...fillPosts(1)[0], organizationId: 'other' }];
    const controller = new SettingsController({} as never, service);
    expect(await controller.getLimits({ id: 'org' } as any)).toEqual({
      ...LINKSELF_FREE_LIMITS,
      channelsUsed: 2,
      postsUsed: 3,
    });
    expect(model.organizationLimits.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org' } })
    );
    expect(model.integration.count).toHaveBeenCalledWith({
      where: { organizationId: 'org', deletedAt: null },
    });
  });
});
