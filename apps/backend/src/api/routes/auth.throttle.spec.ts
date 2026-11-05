import { validate } from 'class-validator';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { AuthProviderManager } from '../../services/auth/providers/providers.manager';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerSignInGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { AuthController } from './auth.controller';

jest.mock('@gitroom/backend/services/auth/auth.service', () => ({
  AuthService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/farcaster.provider',
  () => ({ FarcasterProvider: class {} })
);

describe('Sign-in form throttling', () => {
  let storage: ThrottlerStorageService;
  let guard: ThrottlerSignInGuard;

  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    guard = new ThrottlerSignInGuard(
      { throttlers: [{ ttl: 3600000, limit: 90 }] },
      storage,
      new Reflector()
    );
    await guard.onModuleInit();
  });

  afterEach(() => storage.onApplicationShutdown());

  const attempt = (handler: string, headers: Record<string, string>) =>
    guard.canActivate({
      getClass: () => AuthController,
      getHandler: () => (AuthController.prototype as any)[handler],
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ headers, ip: '172.18.0.1' }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as any);

  const exhaust = async (handler: string, headers: Record<string, string>) => {
    for (let i = 0; i < 10; i++) {
      await expect(attempt(handler, headers)).resolves.toBe(true);
    }
  };

  const tracker = (req: Record<string, any>) =>
    (guard as any).getTracker(req) as Promise<string>;

  it('allows 10 login attempts per address, then answers 429', async () => {
    await exhaust('login', { 'cf-connecting-ip': '198.51.100.7' });
    await expect(
      attempt('login', { 'cf-connecting-ip': '198.51.100.7' })
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      attempt('login', { 'cf-connecting-ip': '198.51.100.8' })
    ).resolves.toBe(true);
  });

  it('ignores a client supplied x-forwarded-for behind Cloudflare', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt('login', {
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': `10.0.0.${i}, 198.51.100.7`,
      });
    }
    await expect(
      attempt('login', {
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': '10.9.9.9, 198.51.100.7',
      })
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('counts an IPv6 /64 as one client', async () => {
    for (let i = 1; i <= 10; i++) {
      await attempt('login', {
        'cf-connecting-ip': `2001:db8:1:2::${i.toString(16)}`,
      });
    }
    await expect(
      attempt('login', {
        'cf-connecting-ip': '2001:db8:1:2:ffff:ffff:ffff:ffff',
      })
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      attempt('login', { 'cf-connecting-ip': '2001:db8:1:3::1' })
    ).resolves.toBe(true);
  });

  it('keeps separate budgets for login and register', async () => {
    await exhaust('login', { 'cf-connecting-ip': '198.51.100.7' });
    await expect(
      attempt('login', { 'cf-connecting-ip': '198.51.100.7' })
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      attempt('register', { 'cf-connecting-ip': '198.51.100.7' })
    ).resolves.toBe(true);
  });

  it('normalizes addresses before counting', async () => {
    await expect(
      tracker({ headers: { 'cf-connecting-ip': '::ffff:198.51.100.7' } })
    ).resolves.toBe('198.51.100.7');
    await expect(
      tracker({ headers: { 'cf-connecting-ip': 'FE80::1%eth0' } })
    ).resolves.toBe('fe80:0:0:0::/64');
    await expect(
      tracker({
        headers: { 'cf-connecting-ip': '2001:DB8:0:0:8:800:200C:417A' },
      })
    ).resolves.toBe('2001:db8:0:0::/64');
  });

  it('without Cloudflare uses the hop the nearest proxy appended, then the socket', async () => {
    await expect(
      tracker({
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
        ip: '127.0.0.1',
      })
    ).resolves.toBe('203.0.113.9');
    await expect(
      tracker({ headers: { 'x-forwarded-for': ' , ,' }, ip: '127.0.0.1' })
    ).resolves.toBe('127.0.0.1');
    await expect(tracker({ headers: {} })).resolves.toBe('unknown');
  });

  it.each(['register', 'login'])(
    'limits %s to 10 attempts per 15 minutes',
    (handler) => {
      const method = (AuthController.prototype as any)[handler];
      expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(
        ThrottlerSignInGuard
      );
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', method)).toBe(10);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', method)).toBe(900000);
    }
  );

  it.each([
    'canRegister',
    'forgot',
    'forgotReturn',
    'activate',
    'resendActivation',
  ])('leaves %s as upstream', (handler) => {
    const method = (AuthController.prototype as any)[handler];
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toBeUndefined();
  });
});

describe('Authentication input handling', () => {
  it.each([LoginUserDto, CreateOrgUserDto])('validates provider values for form %#', async (Dto) => {
    const dto = Object.assign(new Dto(), { provider: '<b>unknown</b>', password: 'password', email: 'test@example.test', company: 'Test' });
    expect((await validate(dto)).some((error) => error.property === 'provider')).toBe(true);
  });
  it('returns a fixed provider error', () => {
    const manager = new AuthProviderManager({} as any);
    expect(() => manager.getProvider('<b>unknown</b>')).toThrow('Auth provider not found');
  });
  it.each(['login', 'register'] as const)('uses plain error responses for %s', async (method) => {
    const service = { getOrgFromCookie: jest.fn(), routeAuth: jest.fn().mockRejectedValue(new Error('<b>unavailable</b>')) };
    const controller = new AuthController(service as any, {} as any);
    const response: any = { status: jest.fn().mockReturnThis(), type: jest.fn().mockReturnThis(), send: jest.fn() };
    await controller[method]({ cookies: {} } as any, {} as any, response, '', '');
    expect(response.type).toHaveBeenCalledWith('text/plain');
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
