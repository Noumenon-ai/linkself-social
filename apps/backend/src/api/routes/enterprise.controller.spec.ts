import { Logger } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { Response } from 'express';
import { EnterpriseController } from './enterprise.controller';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);

describe('Enterprise browser login', () => {
  const env = { ...process.env };
  const now = 1793016000;
  const user = {
    id: 'owner',
    providerName: 'LOCAL',
    password: 'private',
    activated: true,
    deletedAt: null as Date | null,
  };
  let controller: EnterpriseController;
  let response: Response;
  let orgs: { getOrgByApiKey: jest.Mock; getOrganizationOwner: jest.Mock };
  let log: jest.SpyInstance;
  const claims = () => ({
    apiKey: 'private-key',
    jti: 'one-time-id',
    iat: now,
    exp: now + 60,
  });
  const token = (payload: object) => sign(payload, process.env.JWT_SECRET!);
  const rejected = () => {
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://social.linkself.net/auth/login?error=sso'
    );
    expect(response.cookie).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toMatch(/private-key|one-time-id|@/);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now * 1000);
    process.env.JWT_SECRET = 'enterprise-test-secret';
    process.env.FRONTEND_URL = 'https://social.linkself.net';
    delete process.env.NOT_SECURED;
    orgs = {
      getOrgByApiKey: jest
        .fn()
        .mockResolvedValue({ id: 'org', deletedAt: null as Date | null }),
      getOrganizationOwner: jest.fn().mockResolvedValue(user),
    };
    controller = new EnterpriseController(
      {} as never,
      orgs as never,
      {} as never,
      {} as never
    );
    response = {
      cookie: jest.fn(),
      header: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;
    (ioRedis.set as jest.Mock).mockReset().mockResolvedValue('OK');
    log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.env = { ...env };
  });

  it('signs the owner without a password and sets the normal secured session cookies', async () => {
    await controller.login(
      token({ ...claims(), redirect: '/settings' }),
      response
    );
    expect(ioRedis.set).toHaveBeenCalledWith(
      'enterprise-login:one-time-id',
      '1',
      'EX',
      120,
      'NX'
    );
    expect(orgs.getOrgByApiKey).toHaveBeenCalledWith('private-key');
    expect(orgs.getOrganizationOwner).toHaveBeenCalledWith('org');
    const cookies = (response.cookie as jest.Mock).mock.calls;
    expect(verify(cookies[0][1], process.env.JWT_SECRET!)).toEqual({
      id: 'owner',
      providerName: 'LOCAL',
      activated: true,
      deletedAt: null as Date | null,
      iat: now,
    });
    const options = {
      domain: '.linkself.net',
      secure: true,
      httpOnly: true,
      sameSite: 'none',
      expires: new Date((now + 365 * 86400) * 1000),
    };
    expect(cookies).toEqual([
      ['auth', expect.any(String), options],
      ['showorg', 'org', options],
    ]);
    expect(user.password).toBe('private');
    expect(response.header).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://social.linkself.net/settings'
    );
  });

  it('preserves NOT_SECURED cookie and response header behavior', async () => {
    process.env.NOT_SECURED = 'true';
    await controller.login(token(claims()), response);
    expect(response.cookie).toHaveBeenCalledWith('showorg', 'org', {
      domain: '.linkself.net',
      expires: expect.any(Date),
    });
    expect(response.header).toHaveBeenCalledWith('auth', expect.any(String));
    expect(response.header).toHaveBeenCalledWith('showorg', 'org');
  });

  it('rejects a replayed jti', async () => {
    (ioRedis.set as jest.Mock)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);
    const jwt = token(claims());
    await controller.login(jwt, response);
    jest.clearAllMocks();
    await controller.login(jwt, response);
    rejected();
    expect(orgs.getOrgByApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ['missing exp', { exp: undefined }],
    ['missing iat', { iat: undefined }],
    ['over 60 seconds', { exp: now + 61 }],
    ['expired', { exp: now - 1 }],
    ['future iat', { iat: now + 10 }],
    ['empty apiKey', { apiKey: '' }],
    ['missing jti', { jti: undefined }],
    ['login shape', { providerName: 'LOCAL' }],
    ['invite shape', { orgId: 'org' }],
    ['reset shape', { expires: now + 60 }],
  ])('rejects %s', async (_, overrides) => {
    const payload = { ...claims(), ...overrides };
    const encodedPayload = JSON.parse(JSON.stringify(payload));
    const jwt = sign(encodedPayload, process.env.JWT_SECRET!, {
      noTimestamp: 'iat' in overrides && overrides.iat === undefined,
    });
    await controller.login(jwt, response);
    rejected();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    await controller.login(sign(claims(), 'wrong-secret'), response);
    rejected();
  });

  it.each([null, { id: 'org', deletedAt: new Date() }])(
    'rejects unknown or deleted organizations: %p',
    async (org) => {
      orgs.getOrgByApiKey.mockResolvedValue(org);
      await controller.login(token(claims()), response);
      rejected();
    }
  );

  it.each([
    null,
    { ...user, deletedAt: new Date() },
    { ...user, activated: false },
  ])('rejects unavailable owners: %p', async (owner) => {
    orgs.getOrganizationOwner.mockResolvedValue(owner);
    await controller.login(token(claims()), response);
    rejected();
  });

  it('fails closed when Redis is unavailable without logging exception data', async () => {
    (ioRedis.set as jest.Mock).mockRejectedValue(new Error('private-key'));
    await controller.login(token(claims()), response);
    rejected();
  });

  it.each([
    undefined,
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/\nunsafe',
    '/' + 'a'.repeat(200),
    42,
  ])('falls back for redirect %p', async (redirect) => {
    await controller.login(token({ ...claims(), redirect }), response);
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://social.linkself.net/launches'
    );
  });
});
