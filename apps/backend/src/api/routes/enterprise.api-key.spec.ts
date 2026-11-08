import { Logger } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validateSync } from 'class-validator';
import { sign } from 'jsonwebtoken';
import { EnterpriseController } from './enterprise.controller';
import { EnterpriseApiKeyRequestDto } from '@gitroom/nestjs-libraries/dtos/enterprise/enterprise.api-key.dto';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));

describe('Enterprise API key contract', () => {
  const env = { ...process.env };
  const now = 1794139200;
  let controller: EnterpriseController;
  let service: OrganizationService;
  let organization: { id: string; apiKey: string; deletedAt: Date | null };
  let model: { findFirst: jest.Mock; update: jest.Mock };
  let log: jest.SpyInstance;
  const claims = () => ({
    organizationId: 'org',
    iat: now,
    exp: now + 60,
    jti: 'request-id',
  });
  const token = (payload: object, noTimestamp = false) =>
    sign(payload, process.env.JWT_SECRET!, { noTimestamp });
  const request = (payload: object = claims()) =>
    controller.getApiKey({ params: token(payload) });
  const invalid = { status: 400, message: 'Invalid API key token' };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now * 1000);
    process.env.JWT_SECRET = 'api-key-test-secret';
    process.env.LINKSELF_URL = 'https://linkself.test';
    organization = { id: 'org', apiKey: 'current-key', deletedAt: null };
    model = {
      findFirst: jest.fn(async ({ where }) =>
        where.id === organization.id && where.deletedAt === organization.deletedAt
          ? { ...organization }
          : null
      ),
      update: jest.fn(async ({ data }) => Object.assign(organization, data)),
    };
    const repository = new OrganizationRepository(
      { model: { organization: model } } as never,
      {} as never,
      {} as never
    );
    service = new OrganizationService(repository, {} as never);
    controller = new EnterpriseController(
      {} as never,
      service,
      {} as never,
      {} as never,
      {} as never
    );
    const used = new Set<string>();
    (ioRedis.set as jest.Mock).mockReset().mockImplementation(async (key) => {
      if (used.has(key)) return null;
      used.add(key);
      return 'OK';
    });
    log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [message] of log.mock.calls) {
      expect([
        'Enterprise API key request rejected: invalid token',
        'Enterprise API key request rejected: invalid claims',
        'Enterprise API key request rejected: replayed token or replay store unavailable',
        'Enterprise API key request rejected: organization unavailable',
      ]).toContain(message);
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.env = { ...env };
  });

  it('returns only the current key with HTTP 200', async () => {
    expect(await request()).toEqual({ apiKey: 'current-key' });
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { id: 'org', deletedAt: null },
      select: { apiKey: true },
    });
    expect(model.update).not.toHaveBeenCalled();
    expect(ioRedis.set).toHaveBeenCalledWith(
      'enterprise-api-key:request-id', '1', 'EX', 120, 'NX'
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.getApiKey)).toBe(200);
    expect(Reflect.getMetadata(PATH_METADATA, controller.getApiKey)).toBe('/api-key');
    expect(log).not.toHaveBeenCalled();
  });

  it('returns only the new key after normal rotation', async () => {
    const before = await request();
    await service.updateApiKey('org');
    const after = await request({ ...claims(), jti: 'next-request' });
    expect(after).toEqual({ apiKey: organization.apiKey });
    expect(after.apiKey).not.toBe(before.apiKey);
    expect(model.update).toHaveBeenCalledTimes(1);
    expect(model.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['expired', { exp: now - 1 }],
    ['expires now', { exp: now }],
    ['too long', { exp: now + 61 }],
    ['issue time beyond the clock allowance', { iat: now + 31, exp: now + 60 }],
    ['nonpositive duration', { iat: now, exp: now }],
    ['fractional issue time', { iat: now - 0.5 }],
    ['fractional expiry', { exp: now + 59.5 }],
    ['empty organization', { organizationId: '' }],
    ['non-string organization', { organizationId: 3 }],
    ['empty request ID', { jti: '' }],
    ['login claims', { providerName: 'LOCAL' }],
    ['SSO claims', { orgId: 'org', redirect: '/settings' }],
    ['invite claims', { orgId: 'org' }],
    ['reset claims', { expires: now + 60 }],
    ['time limit claims', { timeLimit: 'tomorrow' }],
    ['limits claims', { orgId: 'org', plan: 'free', channels: 3, postsPerMonth: 30, mcp: false }],
    ['additional limits claims', { plan: 'free', channels: 3 }],
  ])('refuses %s', async (_, overrides) => {
    await expect(request({ ...claims(), ...overrides })).rejects.toMatchObject(invalid);
    expect(ioRedis.set).not.toHaveBeenCalled();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('accepts a small clock difference between LinkSelf and the studio', async () => {
    await expect(request({ ...claims(), iat: now + 5, exp: now + 60, jti: 'skewed-clock' })).resolves.toEqual({ apiKey: organization.apiKey });
  });

  it.each(Object.keys(claims()))('requires %s', async (field) => {
    const payload: any = claims();
    delete payload[field];
    await expect(controller.getApiKey({
      params: token(payload, field === 'iat'),
    })).rejects.toMatchObject(invalid);
    expect(ioRedis.set).not.toHaveBeenCalled();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a repeated request ID', async () => {
    await request();
    await expect(request()).rejects.toMatchObject(invalid);
    expect(model.findFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts only one concurrent use of a request ID', async () => {
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(model.findFirst).toHaveBeenCalledTimes(1);
  });

  it('refuses requests when the request store is unavailable', async () => {
    (ioRedis.set as jest.Mock).mockRejectedValue(new Error('store unavailable'));
    await expect(request()).rejects.toMatchObject(invalid);
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a different signature', async () => {
    await expect(controller.getApiKey({
      params: sign(claims(), 'different-secret'),
    })).rejects.toMatchObject(invalid);
    expect(ioRedis.set).not.toHaveBeenCalled();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('requires HS256', async () => {
    await expect(controller.getApiKey({
      params: sign(claims(), process.env.JWT_SECRET!, { algorithm: 'HS384' }),
    })).rejects.toMatchObject(invalid);
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('refuses unknown organizations with the generic response', async () => {
    await expect(request({ ...claims(), organizationId: 'unknown' })).rejects.toMatchObject(invalid);
  });

  it('refuses deleted organizations with the generic response', async () => {
    organization.deletedAt = new Date();
    await expect(request()).rejects.toMatchObject(invalid);
  });

  it('uses the generic response when the organization store is unavailable', async () => {
    model.findFirst.mockRejectedValue(new Error('store unavailable'));
    await expect(request()).rejects.toMatchObject(invalid);
  });

  it.each([undefined, ''])('is absent in upstream mode (%s)', async (url) => {
    if (url === undefined) delete process.env.LINKSELF_URL;
    else process.env.LINKSELF_URL = url;
    await expect(request()).rejects.toMatchObject({ status: 404 });
    await expect(controller.getApiKey({ params: '' })).rejects.toMatchObject({ status: 404 });
    expect(ioRedis.set).not.toHaveBeenCalled();
    expect(model.findFirst).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses a missing params body', async () => {
    await expect(controller.getApiKey({} as any)).rejects.toMatchObject(invalid);
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('validates the request DTO', () => {
    expect(validateSync(Object.assign(new EnterpriseApiKeyRequestDto(), {
      params: token(claims()),
    }))).toHaveLength(0);
    for (const params of [undefined, '', 3]) {
      expect(validateSync(Object.assign(new EnterpriseApiKeyRequestDto(), { params }))).toHaveLength(1);
    }
  });

  it('gates upstream requests before body validation', () => {
    const [guard] = Reflect.getMetadata(GUARDS_METADATA, controller.getApiKey);
    expect(guard.canActivate()).toBe(true);
    delete process.env.LINKSELF_URL;
    expect(() => guard.canActivate()).toThrow('Not Found');
  });
});
