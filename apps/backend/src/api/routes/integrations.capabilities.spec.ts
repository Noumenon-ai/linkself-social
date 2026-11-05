import { IntegrationsController } from './integrations.controller';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);

describe('Integration list capabilities', () => {
  it.each([
    [{}, false],
    [{ postAnalytics: jest.fn() }, true],
    [
      { postAnalytics: jest.fn(), postAnalyticsEnabled: (): boolean => false },
      false,
    ],
    [
      { postAnalytics: jest.fn(), postAnalyticsEnabled: (): boolean => true },
      true,
    ],
    [{ postAnalyticsEnabled: (): boolean => true }, false],
  ])(
    'derives post analytics from provider capabilities: %p',
    async (capabilities, expected) => {
      const manager = {
        getSocialIntegration: jest
          .fn()
          .mockReturnValue({ editor: 'normal', ...capabilities }),
      };
      const service = {
        getIntegrationsList: jest.fn().mockResolvedValue([
          {
            id: 'channel',
            name: 'Channel',
            providerIdentifier: 'test-provider',
            postingTimes: '[]',
            token: 'private-token',
            refreshToken: 'private-refresh',
            customInstanceDetails: 'private-details',
          },
        ]),
      };
      const controller = new IntegrationsController(
        manager as never,
        service as never,
        {} as never,
        {} as never
      );
      const result = await controller.getIntegrationList({
        id: 'org',
      } as never);
      expect(service.getIntegrationsList).toHaveBeenCalledWith('org');
      expect(manager.getSocialIntegration).toHaveBeenCalledWith(
        'test-provider'
      );
      expect(result.integrations[0].hasPostAnalytics).toBe(expected);
      expect(result.integrations[0]).not.toHaveProperty('token');
      expect(result.integrations[0]).not.toHaveProperty('refreshToken');
      expect(result.integrations[0]).not.toHaveProperty(
        'customInstanceDetails'
      );
    }
  );
});

describe('Integration list pictures', () => {
  const originalLinkselfUrl = process.env.LINKSELF_URL;
  afterEach(() => {
    if (originalLinkselfUrl === undefined) delete process.env.LINKSELF_URL;
    else process.env.LINKSELF_URL = originalLinkselfUrl;
  });

  it.each([
    ['https://linkself.net', null, ''],
    ['https://linkself.net', '', ''],
    [undefined, null, '/no-picture.jpg'],
    ['', '', '/no-picture.jpg'],
    ['https://linkself.net', 'https://example.com/avatar.jpg', 'https://example.com/avatar.jpg'],
    [undefined, 'https://example.com/avatar.jpg', 'https://example.com/avatar.jpg'],
  ])('returns the picture fallback for mode %s and picture %s', async (linkselfUrl, picture, expected) => {
    if (linkselfUrl === undefined) delete process.env.LINKSELF_URL;
    else process.env.LINKSELF_URL = linkselfUrl;
    const controller = new IntegrationsController(
      { getSocialIntegration: jest.fn().mockReturnValue({ editor: 'normal' }) } as never,
      { getIntegrationsList: jest.fn().mockResolvedValue([
        { id: 'channel', providerIdentifier: 'test-provider', postingTimes: '[]', picture },
      ]) } as never,
      {} as never,
      {} as never
    );
    const result = await controller.getIntegrationList({ id: 'org' } as never);
    expect(result.integrations[0].picture).toBe(expected);
  });
});
