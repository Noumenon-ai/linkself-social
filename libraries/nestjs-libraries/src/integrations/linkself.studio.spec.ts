import { HttpException } from '@nestjs/common';
import { ProviderNotEnabled } from './provider.not.enabled';
import { sign } from 'jsonwebtoken';
import {
  IntegrationManager,
  socialIntegrationList,
} from './integration.manager';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from './refresh.integration.service';
import { PinterestProvider } from './social/pinterest.provider';
import { IntegrationsController } from '@gitroom/backend/api/routes/integrations.controller';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { EnterpriseController } from '@gitroom/backend/api/routes/enterprise.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { ioRedis } from '../redis/redis.service';

// Nostr's ESM cryptography is unrelated to connection policy.
jest.mock('nostr-tools', () => ({ SimplePool: class {} }));

jest.mock('../redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('../upload/multer.stream.engine', () => ({
  streamUploadOptions: () => ({}),
}));
jest.mock('../upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));
jest.mock('../database/prisma/integrations/integration.repository', () => ({
  IntegrationRepository: class {},
}));
jest.mock('../database/prisma/autopost/autopost.repository', () => ({
  AutopostRepository: class {},
}));
jest.mock('../database/prisma/notifications/notification.service', () => ({
  NotificationService: class {},
}));
jest.mock('../database/prisma/organizations/organization.service', () => ({
  OrganizationService: class {},
}));
jest.mock('../database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('../database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock('../database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock('../database/prisma/admin-stats/admin-stats.service', () => ({
  AdminStatsService: class {},
}));
jest.mock('../database/prisma/clipping/clipping.service', () => ({
  ClippingService: class {},
}));
jest.mock('../database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));

const org = { id: 'org' } as any;
const channel = {
  id: 'channel',
  internalId: 'account',
  organizationId: org.id,
  providerIdentifier: 'pinterest',
  type: 'social',
  token: 'token',
  refreshToken: 'refresh',
  tokenExpiration: new Date('2099-01-01'),
  refreshNeeded: false,
};

describe('LinkSelf provider policy and analytics', () => {
  const env = { ...process.env };
  let manager: IntegrationManager;
  let service: IntegrationService;
  let refresh: RefreshIntegrationService;
  let repository: any;
  let notifications: any;
  let orgs: any;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LINKSELF_ENABLED_PROVIDERS;
    delete process.env.HIDDEN_PROVIDERS;
    delete process.env.MIGRATE_PROVIDERS;
    delete process.env.PINTEREST_API_URL;
    process.env.JWT_SECRET = 'test-only-secret';
    manager = new IntegrationManager();
    repository = {
      getIntegrationsList: jest.fn().mockResolvedValue([{ ...channel }]),
      getIntegrationByInternalId: jest
        .fn()
        .mockImplementation(async (organizationId, internalId) =>
          organizationId === org.id && internalId === channel.internalId
            ? { ...channel }
            : null
        ),
      getIntegrationById: jest.fn().mockResolvedValue({ ...channel }),
      refreshNeeded: jest.fn(),
      disconnectChannel: jest.fn(),
      deleteChannel: jest.fn(),
      createOrUpdateIntegration: jest.fn(),
    };
    notifications = { inAppNotification: jest.fn() };
    service = new IntegrationService(
      repository,
      {} as never,
      manager,
      notifications,
      undefined as never,
      {} as never,
      {
        assertCanConnect: jest.fn(),
        assertCanEnable: jest.fn(),
      } as never
    );
    refresh = new RefreshIntegrationService(manager, service, {} as never);
    (service as any)._refreshIntegrationService = refresh;
    orgs = {
      getOrgById: jest.fn().mockResolvedValue(org),
      getOrgByApiKey: jest.fn().mockResolvedValue(org),
    };
    (ioRedis.get as jest.Mock).mockImplementation(async (key: string) => {
      if (key.startsWith('organization:')) return org.id;
      if (key.startsWith('login:')) return 'verifier';
      return null;
    });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Unexpected network request'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  it.each([undefined, '', '   '])(
    'preserves upstream catalog and connection behavior for %p',
    async (value) => {
      if (value !== undefined) process.env.LINKSELF_ENABLED_PROVIDERS = value;
      const result = await manager.getAllIntegrations();
      expect(result.social.map((p) => p.identifier)).toEqual(
        socialIntegrationList.map((p) => p.identifier)
      );
      await expect(
        service.assertCanConnect(org.id, 'pinterest')
      ).resolves.toBeUndefined();
      expect(repository.getIntegrationsList).not.toHaveBeenCalled();
    }
  );

  it('normalizes spaces and case and retains upstream hidden-provider filtering', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = ' BLUESKY, Pinterest , YOUTUBE ';
    process.env.HIDDEN_PROVIDERS = 'youtube';
    const controller = new NoAuthIntegrationsController(
      manager,
      service,
      refresh,
      orgs
    );
    expect(
      (await controller.getIntegrations()).social
        .map((p) => p.identifier)
        .sort()
    ).toEqual(['bluesky', 'pinterest']);
  });

  it('does not enable everything for an unknown or delimiter-only list', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = ', unknown ,';
    expect((await manager.getAllIntegrations()).social).toEqual([]);
    await expect(
      service.assertCanConnect(org.id, 'pinterest')
    ).rejects.toMatchObject({ status: 403 });
  });

  const routes = [
    'studio',
    'public',
    'enterprise',
    'custom-field callback',
    'OAuth callback',
  ] as const;
  it.each(routes)(
    'refuses a new connection through %s before authentication or state writes',
    async (route) => {
      process.env.LINKSELF_ENABLED_PROVIDERS = 'youtube';
      const provider =
        route === 'custom-field callback' ? 'bluesky' : 'pinterest';
      // The custom-field path deliberately does not require a login verifier.
      if (route === 'custom-field callback') {
        (ioRedis.get as jest.Mock).mockImplementation(async (key: string) =>
          key.startsWith('organization:') ? org.id : null
        );
      }
      let request: Promise<unknown>;
      if (route === 'studio') {
        request = new IntegrationsController(
          manager,
          service,
          {} as never,
          refresh
        ).getIntegrationUrl(provider, '', '', '', '', org);
      } else if (route === 'public') {
        request = new PublicIntegrationsController(
          service,
          {} as never,
          {} as never,
          notifications,
          manager,
          refresh,
          {} as never,
          {} as never,
          orgs,
          {} as never,
          {} as never
        ).getIntegrationUrl(provider, '', org);
      } else if (route === 'enterprise') {
        request = new EnterpriseController(
          manager,
          orgs,
          service,
          {} as never,
          {} as never
        ).redirectParams(
          sign(
            { apiKey: 'key', provider, redirectUrl: 'https://example.com' },
            process.env.JWT_SECRET!
          )
        );
      } else {
        request = new NoAuthIntegrationsController(
          manager,
          service,
          refresh,
          orgs
        ).connectSocialMedia(provider, {
          state: 'state',
          code: 'credentials',
        } as any);
      }
      await expect(request).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('not enabled for new connections'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(ioRedis.set).not.toHaveBeenCalled();
      expect(ioRedis.del).not.toHaveBeenCalled();
    }
  );

  it('returns 403 for unknown providers at URL entry points', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    const requests = [
      new IntegrationsController(
        manager,
        service,
        {} as never,
        refresh
      ).getIntegrationUrl('unknown', '', '', '', '', org),
      new PublicIntegrationsController(
        service,
        {} as never,
        {} as never,
        notifications,
        manager,
        refresh,
        {} as never,
        {} as never,
        orgs,
        {} as never,
        {} as never
      ).getIntegrationUrl('unknown', '', org),
      new EnterpriseController(
        manager,
        orgs,
        service,
        {} as never,
        {} as never
      ).redirectParams(
        sign(
          {
            apiKey: 'key',
            provider: 'unknown',
            redirectUrl: 'https://example.com',
          },
          process.env.JWT_SECRET!
        )
      ),
    ];
    await Promise.all(
      requests.map((request) =>
        expect(request).rejects.toMatchObject({ status: 403 })
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('rejects a fabricated refresh ID or an unrelated provider', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    await expect(
      service.assertCanConnect(org.id, 'pinterest', 'fake')
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      service.assertCanConnect(org.id, 'youtube', 'account')
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.getIntegrationByInternalId).toHaveBeenCalledWith(org.id, 'fake');
    expect(repository.getIntegrationsList).not.toHaveBeenCalled();
  });

  it('allows an owned existing channel to reconnect while excluded from the catalog', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    const provider = manager.getSocialIntegration('pinterest');
    jest.spyOn(provider, 'generateAuthUrl').mockResolvedValue({
      url: 'https://example.com/oauth',
      state: 'state',
      codeVerifier: 'verifier',
    });
    await expect(
      new IntegrationsController(
        manager,
        service,
        {} as never,
        refresh
      ).getIntegrationUrl('pinterest', 'account', '', '', '', org)
    ).resolves.toEqual({ url: 'https://example.com/oauth' });
    expect(ioRedis.set).toHaveBeenCalledWith(
      'refresh:state',
      'account',
      'EX',
      3600
    );
    expect(manager.getAllowedSocialsIntegrations()).toContain('pinterest');
    expect(manager.getSocialIntegration('pinterest')).toBe(provider);
  });

  it.each([
    'bluesky',
    'wordpress',
    'lemmy',
    'listmonk',
    'medium',
    'devto',
    'hashnode',
    'nostr',
  ])(
    'allows an owned custom-field %s reconnect outside the allowlist',
    async (identifier) => {
      process.env.LINKSELF_ENABLED_PROVIDERS = 'youtube';
      repository.getIntegrationByInternalId.mockResolvedValue({
        ...channel,
        providerIdentifier: identifier,
      });
      const provider = manager.getSocialIntegration(identifier);
      expect(provider.customFields).toBeTruthy();
      const generate = jest
        .spyOn(provider, 'generateAuthUrl')
        .mockResolvedValue({
          url: 'state',
          state: 'state',
          codeVerifier: 'verifier',
        });
      const controller = new IntegrationsController(
        manager,
        service,
        {} as never,
        refresh
      );
      await expect(
        controller.getIntegrationUrl(identifier, 'account', '', '', '', org)
      ).resolves.toEqual({ url: 'state' });
      expect(ioRedis.set).toHaveBeenCalledWith(
        'refresh:state',
        'account',
        'EX',
        3600
      );
      expect(repository.getIntegrationByInternalId).toHaveBeenCalledWith(
        org.id,
        'account'
      );
      expect(repository.getIntegrationsList).not.toHaveBeenCalled();

      generate.mockClear();
      await expect(
        controller.getIntegrationUrl(identifier, '', '', '', '', org)
      ).rejects.toBeInstanceOf(ProviderNotEnabled);
      repository.getIntegrationByInternalId.mockResolvedValue(null);
      await expect(
        controller.getIntegrationUrl(identifier, 'not-owned', '', '', '', org)
      ).rejects.toBeInstanceOf(ProviderNotEnabled);
      repository.getIntegrationByInternalId.mockResolvedValue(channel);
      await expect(
        controller.getIntegrationUrl(identifier, 'account', '', '', '', org)
      ).rejects.toBeInstanceOf(ProviderNotEnabled);
      expect(generate).not.toHaveBeenCalled();
    }
  );

  it('preserves the upstream unknown-provider callback error', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    const gate = jest.spyOn(service, 'assertCanConnect');
    await expect(
      new NoAuthIntegrationsController(
        manager,
        service,
        refresh,
        orgs
      ).connectSocialMedia('unknown', { state: 'state' } as any)
    ).rejects.toThrow('Integration not allowed');
    expect(gate).not.toHaveBeenCalled();
    expect(ioRedis.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rethrows the dedicated enterprise policy exception without an env re-check', async () => {
    const denied = new ProviderNotEnabled('bluesky');
    jest.spyOn(service, 'assertCanConnect').mockRejectedValue(denied);
    const controller = new EnterpriseController(
      manager,
      orgs,
      service,
      {} as never,
      {} as never
    );
    await expect(
      controller.redirectParams(
        sign(
          {
            apiKey: 'key',
            provider: 'bluesky',
            redirectUrl: 'https://example.com',
          },
          process.env.JWT_SECRET!
        )
      )
    ).rejects.toBe(denied);
    expect(denied.getStatus()).toBe(403);
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('does not refresh, flag or notify for a deleted integration', async () => {
    const provider = manager.getSocialIntegration('pinterest');
    const refreshToken = jest.spyOn(provider, 'refreshToken');
    const lookup = jest.spyOn(manager, 'getSocialIntegration');
    const update = jest.spyOn(service, 'createOrUpdateIntegration');
    const inform = jest.spyOn(service, 'informAboutRefreshError');
    await expect(
      refresh.refresh({ ...channel, deletedAt: new Date() } as any)
    ).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    expect(refreshToken).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
    expect(inform).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('keeps existing channel analytics and deletion available outside the allowlist', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ all: { daily_metrics: [] } }))
    );
    await expect(
      service.checkAnalytics(org, channel.id, '7')
    ).resolves.toHaveLength(5);
    await service.deleteChannel(org.id, channel.id);
    expect(repository.deleteChannel).toHaveBeenCalledWith(org.id, channel.id);
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
  });

  it('keeps existing channel posting available outside the allowlist', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'pin' }), { status: 201 })
    );
    const provider = manager.getSocialIntegration(
      'pinterest'
    ) as PinterestProvider;
    await expect(
      provider.finalizePost(
        'token',
        {
          mediaId: '',
          message: 'hello',
          settings: { board: 'board' },
          imagePaths: ['https://example.com/image.jpg'],
          attempting: true,
          confirmed: true,
        } as any,
        channel as any
      )
    ).resolves.toMatchObject({ status: 'completed', postId: 'pin' });
  });

  it('keeps successful token refresh available outside the allowlist', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'bluesky';
    const provider = manager.getSocialIntegration('pinterest');
    const token = {
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    };
    jest.spyOn(provider, 'refreshToken').mockResolvedValue(token as any);
    const update = jest
      .spyOn(service, 'createOrUpdateIntegration')
      .mockResolvedValue(channel as any);
    await expect(refresh.refresh(channel as any)).resolves.toEqual(token);
    expect(update).toHaveBeenCalled();
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
  });

  it('returns no data for Pinterest 3022 without refreshing or flagging the channel', async () => {
    process.env.PINTEREST_API_URL = 'https://api-sandbox.pinterest.com';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 3022,
          message: 'This endpoint does not support sandbox requests',
        }),
        { status: 400 }
      )
    );
    const refreshSpy = jest.spyOn(refresh, 'refresh');
    await expect(service.checkAnalytics(org, channel.id, '7')).resolves.toEqual(
      []
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
    expect(repository.disconnectChannel).not.toHaveBeenCalled();
    expect(repository.createOrUpdateIntegration).not.toHaveBeenCalled();
    expect(ioRedis.set).toHaveBeenCalledWith(
      `integration:${org.id}:${channel.id}:7`,
      '[]',
      'EX',
      expect.any(Number)
    );
  });

  it('still flags the channel when an expired token cannot be refreshed', async () => {
    repository.getIntegrationById.mockResolvedValue({
      ...channel,
      tokenExpiration: new Date('2000-01-01'),
    });
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 2, message: 'Invalid authentication token.' }),
          { status: 401 }
        )
    );
    await expect(service.checkAnalytics(org, channel.id, '7')).resolves.toEqual(
      []
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(repository.refreshNeeded).toHaveBeenCalledWith(org.id, channel.id);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { code: 3022 }])(
    'returns no-data for a missing Pinterest analytics payload: %p',
    async (data) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(data), { status: 400 })
      );
      await expect(
        new PinterestProvider().analytics('id', 'token', 7)
      ).resolves.toEqual([]);
    }
  );
});

describe.each(['', '/dashboard/studio'])('Studio connection sessions %s', (base) => {
  const env = { ...process.env };
  let service: IntegrationService;
  const data = new Map<string, string>();
  const session = (id: string) => sign({ id, providerName: 'LOCAL' }, process.env.JWT_SECRET!);
  beforeEach(() => {
    process.env.LINKSELF_URL = 'https://linkself.test';
    process.env.LINKSELF_BASE_PATH = base;
    process.env.JWT_SECRET = 'test-session-secret';
    data.clear();
    (ioRedis.get as jest.Mock).mockImplementation(async (key) => data.get(key) || null);
    (ioRedis.set as jest.Mock).mockImplementation(async (key, value, _ex, _ttl, nx) => {
      if (nx && data.has(key)) return null;
      data.set(key, value); return 'OK';
    });
    (ioRedis.del as jest.Mock).mockImplementation(async (...keys) => keys.forEach((key) => data.delete(key)));
    service = new IntegrationService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });
  afterEach(() => { process.env = { ...env }; jest.clearAllMocks(); });
  it.each(['devto', 'hashnode', 'wordpress', 'listmonk', 'nostr', 'lemmy'])('%s authentication refusal creates no channel', async (identifier) => {
    await service.bindConnectionSession('state', session('one'));
    data.set('organization:state', 'org');
    data.set('connection-provider:state', identifier);
    const provider = { customFields: (): any[] => [], authenticate: jest.fn().mockResolvedValue('Invalid credentials') };
    const manager = { getAllowedSocialsIntegrations: () => [identifier], getSocialIntegration: () => provider };
    jest.spyOn(service, 'assertCanConnect').mockResolvedValue(undefined);
    const create = jest.spyOn(service, 'createOrUpdateIntegration');
    const controller = new NoAuthIntegrationsController(manager as any, service, {} as any, { getOrgById: async () => ({id: 'org'}) } as any);
    await expect(controller.connectSocialMedia(identifier, {state: 'state', code: 'code', timezone: '0'}, {
      cookies: { [base ? 'linkself_studio_auth' : 'auth']: session('one') }, headers: {},
    } as any)).rejects.toMatchObject({message: 'Invalid credentials'});
    expect(provider.authenticate).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
  it('matches the initiating session', async () => {
    await service.bindConnectionSession('state', session('one'));
    await expect(service.assertConnectionSession('state', session('one'))).resolves.toBeUndefined();
    await expect(service.assertConnectionSession('state', session('two'))).rejects.toMatchObject({ status: 403 });
    await expect(service.assertConnectionSession('state')).rejects.toMatchObject({ status: 403 });
  });
  it('does not replace an existing session binding', async () => {
    await service.bindConnectionSession('state', session('one'));
    await expect(service.bindConnectionSession('state', session('two'))).rejects.toMatchObject({ status: 403 });
  });
  it('requires a valid session before the public callback', async () => {
    await service.bindConnectionSession('state', session('one'));
    const provider = { authenticate: jest.fn() };
    const manager = { getAllowedSocialsIntegrations: () => ['test'], getSocialIntegration: () => provider };
    const controller = new NoAuthIntegrationsController(manager as any, service, {} as any, {} as any);
    await expect(controller.connectSocialMedia('test', { state: 'state', code: 'code', timezone: '0' }, {
      cookies: { [base ? 'linkself_studio_auth' : 'auth']: session('two') }, headers: {},
    } as any)).rejects.toMatchObject({ status: 403 });
    expect(provider.authenticate).not.toHaveBeenCalled();
  });
  it('requires the session for page selection', async () => {
    data.set('organization:state', 'org');
    await service.bindConnectionSession('state', session('one'));
    const controller = new NoAuthIntegrationsController({} as any, service, {} as any, {} as any);
    await expect(controller.saveProviderPage('page', { state: 'state' }, { cookies: {}, headers: {} } as any)).rejects.toMatchObject({ status: 403 });
  });
  it('starts an enterprise connection only in its workspace', async () => {
    data.set('organization:state', 'org');
    data.set('connection-url:state', 'https://provider.test/connect');
    await expect(service.startConnectionSession('other', 'state', session('one'))).rejects.toMatchObject({ status: 403 });
    expect(await service.startConnectionSession('org', 'state', session('one'))).toEqual({ url: 'https://provider.test/connect' });
    await expect(service.startConnectionSession('org', 'state', session('one'))).rejects.toMatchObject({ status: 400 });
  });
  it('allows only explicitly issued server credential states', async () => {
    await expect(service.assertConnectionSession('state', undefined, true)).rejects.toMatchObject({ status: 403 });
    data.set('connection-server:state', 'credentials');
    await expect(service.assertConnectionSession('state', undefined, true)).resolves.toBeUndefined();
    await expect(service.assertConnectionSession('state', undefined, false)).rejects.toMatchObject({ status: 403 });
  });
  it('finishes page selection with the initiating session and consumes its state', async () => {
    await service.bindConnectionSession('state', session('one'));
    data.set('organization:state', 'org');
    data.set('connection-page:state', 'page');
    data.set('connection-page-state:page', 'state');
    const save = jest.spyOn(service, 'saveProviderPage').mockResolvedValue({ success: true });
    await expect(service.completeConnectionPage('org', 'page', {}, session('two'))).rejects.toMatchObject({ status: 403 });
    await expect(service.completeConnectionPage('org', 'other', { state: 'state' }, session('one'))).rejects.toMatchObject({ status: 403 });
    expect(save).not.toHaveBeenCalled();
    await expect(service.completeConnectionPage('org', 'page', {}, session('one'))).resolves.toEqual({ success: true });
    await expect(service.completeConnectionPage('org', 'page', { state: 'state' }, session('one'))).rejects.toMatchObject({ status: 403 });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('normalizes enterprise return paths while preserving local navigation', () => {
    process.env.FRONTEND_URL = 'https://studio.test' + base;
    expect(service.enterpriseReturnPath('https://studio.test/settings?tab=apps')).toBe('/settings?tab=apps');
    expect(service.enterpriseReturnPath('https://linkself.test/dashboard/social')).toBe('/launches');
    expect(() => service.enterpriseReturnPath('https://other.test/settings')).toThrow();
  });
  it.each(['https://other.test', '//other.test', '/%5cother.test'])('validates stored return path case %#', (path) => {
    expect(() => service.validateReturnPath(path)).toThrow();
  });
});
