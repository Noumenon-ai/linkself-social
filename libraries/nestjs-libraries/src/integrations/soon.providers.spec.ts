import { sign } from 'jsonwebtoken';
import {
  IntegrationManager,
  socialIntegrationList,
} from './integration.manager';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { IntegrationsController } from '@gitroom/backend/api/routes/integrations.controller';
import { EnterpriseController } from '@gitroom/backend/api/routes/enterprise.controller';
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

describe('Coming-soon providers', () => {
  const env = { ...process.env };
  const org = { id: 'org' } as any;
  let manager: IntegrationManager;
  let service: IntegrationService;
  let repository: { getIntegrationByInternalId: jest.Mock };
  let generateAuthUrl: jest.SpyInstance;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LINKSELF_URL;
    delete process.env.LINKSELF_SOON_PROVIDERS;
    delete process.env.LINKSELF_ENABLED_PROVIDERS;
    delete process.env.HIDDEN_PROVIDERS;
    delete process.env.MIGRATE_PROVIDERS;
    process.env.JWT_SECRET = 'test-only-secret';
    manager = new IntegrationManager();
    repository = {
      getIntegrationByInternalId: jest.fn().mockResolvedValue(null),
    };
    service = new IntegrationService(
      repository as never,
      {} as never,
      manager,
      {} as never,
      undefined as never,
      {} as never,
      { assertCanConnect: jest.fn() } as never
    );
    generateAuthUrl = jest
      .spyOn(manager.getSocialIntegration('facebook'), 'generateAuthUrl')
      .mockResolvedValue({
        url: 'https://example.test/connect',
        state: 'state',
        codeVerifier: 'verifier',
      });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Unexpected network request'));
  });

  afterEach(() => {
    expect(fetchMock).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  it.each([undefined, '', '   ', ', ,'])(
    'keeps the catalog unchanged for %p',
    async (value) => {
      if (value !== undefined) process.env.LINKSELF_SOON_PROVIDERS = value;
      const result = await manager.getAllIntegrations();
      expect(result.social.map((p) => p.identifier)).toEqual(
        socialIntegrationList.map((p) => p.identifier)
      );
      for (const provider of result.social) {
        expect(provider).not.toHaveProperty('soon');
      }
      expect(manager.isSoonProvider('facebook')).toBe(false);
      expect(manager.isSoonProvider('')).toBe(false);
    }
  );

  it('adds only the soon flag while preserving all catalog metadata and order', async () => {
    const baseline = await manager.getAllIntegrations();
    process.env.LINKSELF_SOON_PROVIDERS =
      ' FACEBOOK, Instagram , THREADS, instagram-standalone ';
    const soon = ['facebook', 'instagram', 'threads', 'instagram-standalone'];
    expect(await manager.getAllIntegrations()).toEqual({
      ...baseline,
      social: baseline.social.map((provider) =>
        soon.includes(provider.identifier)
          ? { ...provider, soon: true }
          : provider
      ),
    });
    expect(manager.isSoonProvider(' Facebook ')).toBe(true);
    expect(manager.isSoonProvider('THREADS')).toBe(true);
    expect(manager.isSoonProvider('bluesky')).toBe(false);
  });

  it('retains enabled and hidden provider filtering', async () => {
    process.env.LINKSELF_ENABLED_PROVIDERS = 'facebook,threads';
    process.env.HIDDEN_PROVIDERS = 'threads';
    process.env.LINKSELF_SOON_PROVIDERS = 'facebook,threads,instagram';
    expect((await manager.getAllIntegrations()).social).toEqual([
      expect.objectContaining({ identifier: 'facebook', soon: true }),
    ]);
  });

  it('applies to arbitrary configured providers', () => {
    process.env.LINKSELF_SOON_PROVIDERS = ' Example-Network ';
    expect(manager.isSoonProvider('example-network')).toBe(true);
    expect(manager.isSoonProvider('facebook')).toBe(false);
  });

  function connect(route: 'studio' | 'enterprise', refresh = '') {
    if (route === 'studio') {
      return new IntegrationsController(
        manager,
        service,
        {} as never,
        {} as never
      ).getIntegrationUrl('facebook', refresh, '', '', '', org);
    }
    return new EnterpriseController(
      manager,
      { getOrgByApiKey: jest.fn().mockResolvedValue(org) } as never,
      service,
      {} as never,
      {} as never
    ).redirectParams(
      sign(
        {
          apiKey: 'key',
          provider: 'facebook',
          refreshId: refresh,
          redirectUrl: '/launches',
          webhookUrl: 'https://example.test/callback',
        },
        process.env.JWT_SECRET!
      )
    );
  }

  describe.each(['studio', 'enterprise'] as const)(
    '%s connection URL',
    (route) => {
      it.each([false, true])(
        'refuses a new soon connection with LinkSelf mode %s',
        async (linkself) => {
          if (linkself) process.env.LINKSELF_URL = 'https://example.test';
          process.env.LINKSELF_SOON_PROVIDERS = ' FACEBOOK ';
          await expect(connect(route)).rejects.toMatchObject({
            status: 400,
            message: 'This network is coming soon',
          });
          expect(generateAuthUrl).not.toHaveBeenCalled();
          expect(ioRedis.set).not.toHaveBeenCalled();
        }
      );

      it('allows an existing channel to reconnect', async () => {
        process.env.LINKSELF_SOON_PROVIDERS = 'facebook';
        repository.getIntegrationByInternalId.mockResolvedValue({
          providerIdentifier: 'facebook',
          deletedAt: null,
        });
        await expect(connect(route, 'account')).resolves.toEqual(
          route === 'studio'
            ? { url: 'https://example.test/connect' }
            : 'https://example.test/connect'
        );
        expect(repository.getIntegrationByInternalId).toHaveBeenCalledWith(
          org.id,
          'account'
        );
        expect(generateAuthUrl).toHaveBeenCalledTimes(1);
        expect(ioRedis.set).toHaveBeenCalledWith(
          'refresh:state',
          'account',
          'EX',
          3600
        );
      });

      it.each([
        null,
        { providerIdentifier: 'facebook', deletedAt: new Date('2026-01-01') },
        { providerIdentifier: 'threads', deletedAt: null },
      ])(
        'requires a live matching channel for a reconnect: %p',
        async (existing) => {
          process.env.LINKSELF_SOON_PROVIDERS = 'facebook';
          repository.getIntegrationByInternalId.mockResolvedValue(existing);
          await expect(connect(route, 'account')).rejects.toMatchObject({
            status: 400,
            message: 'This network is coming soon',
          });
          expect(generateAuthUrl).not.toHaveBeenCalled();
          expect(ioRedis.set).not.toHaveBeenCalled();
        }
      );

      it.each([undefined, 'threads'])(
        'allows new connections when the provider is not soon: %p',
        async (value) => {
          if (value !== undefined) process.env.LINKSELF_SOON_PROVIDERS = value;
          await expect(connect(route)).resolves.toEqual(
            route === 'studio'
              ? { url: 'https://example.test/connect' }
              : 'https://example.test/connect'
          );
          expect(generateAuthUrl).toHaveBeenCalledTimes(1);
        }
      );
    }
  );

  it('leaves the existing callback connection policy unchanged', async () => {
    process.env.LINKSELF_SOON_PROVIDERS = 'facebook';
    await expect(
      service.assertCanConnect(org.id, 'facebook')
    ).resolves.toBeUndefined();
  });
});
