import { sign } from 'jsonwebtoken';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { EnterpriseController } from './enterprise.controller';
import { OrganizationLimitsService } from '@gitroom/nestjs-libraries/database/prisma/organization-limits/organization.limits.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
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
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));

describe('Enterprise limits contract', () => {
  const env = { ...process.env };
  const now = 1793016000;
  let repository: any;
  let controller: EnterpriseController;
  const claims = () => ({
    orgId: 'org',
    plan: 'free',
    channels: 3,
    postsPerMonth: 30,
    mcp: false,
    iat: now,
    exp: now + 60,
    jti: 'request-id',
  });
  const token = (payload: object, noTimestamp = false) =>
    sign(payload, process.env.JWT_SECRET!, { noTimestamp });
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now * 1000);
    process.env.JWT_SECRET = 'limits-test-secret';
    process.env.LINKSELF_URL = 'https://linkself.test';
    repository = {
      exists: jest.fn().mockResolvedValue({ id: 'org' }),
      get: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      countChannels: jest.fn().mockResolvedValue(0),
    };
    const service = new OrganizationLimitsService(repository, {} as never);
    controller = new EnterpriseController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service
    );
  });
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });

  it('answers 200 with ok true and accepts an idempotent repeated token', async () => {
    const body = { params: token(claims()) };
    expect(await controller.setLimits(body)).toEqual({ ok: true });
    expect(await controller.setLimits(body)).toEqual({ ok: true });
    expect(repository.upsert).toHaveBeenCalledTimes(2);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        EnterpriseController.prototype.setLimits
      )
    ).toBe(200);
  });
  it('rejects a bad signature', async () => {
    await expect(
      controller.setLimits({ params: sign(claims(), 'wrong') })
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it('rejects algorithms other than HS256', async () => {
    await expect(
      controller.setLimits({
        params: sign(claims(), process.env.JWT_SECRET!, { algorithm: 'HS384' }),
      })
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    ['expired', { exp: now - 1 }],
    ['expires now', { exp: now }],
    ['too long', { exp: now + 61 }],
    ['future iat', { iat: now + 1 }],
    ['empty org', { orgId: '' }],
    ['wrong plan', { plan: 'ultimate' }],
    ['numeric channel string', { channels: '3' }],
    ['fractional channels', { channels: 1.5 }],
    ['negative channels', { channels: -2 }],
    ['overflow channels', { channels: 2147483648 }],
    ['wrong posts type', { postsPerMonth: '30' }],
    ['wrong mcp type', { mcp: 'true' }],
    ['empty jti', { jti: '' }],
    ['login token', { providerName: 'LOCAL' }],
    ['reset token', { expires: now + 60 }],
  ])('rejects %s', async (_, override) => {
    await expect(
      controller.setLimits({ params: token({ ...claims(), ...override }) })
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it.each(Object.keys(claims()))('rejects missing %s', async (field) => {
    const payload: any = claims();
    delete payload[field];
    await expect(
      controller.setLimits({ params: token(payload, field === 'iat') })
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it('rejects an unknown organization', async () => {
    repository.exists.mockResolvedValue(null);
    await expect(
      controller.setLimits({ params: token(claims()) })
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it('rejects a missing params body', async () => {
    await expect(controller.setLimits({} as any)).rejects.toMatchObject({
      status: 400,
    });
  });
});
