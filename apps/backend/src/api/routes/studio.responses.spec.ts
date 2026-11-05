import { Writable } from 'stream';
import { PublicController } from './public.controller';
import { UsersController } from './users.controller';
import { studioRequestPolicy } from '../../services/auth/studio.request.policy';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.insert.service', () => ({
  AgentGraphInsertService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/services/payment/payment.service', () => ({
  PaymentService: class {},
}));
jest.mock('@gitroom/backend/services/auth/auth.service', () => ({
  AuthService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator',
  () => ({
    IsSafeWebhookUrl: () => () => {},
    isSafePublicHttpsUrl: async () => true,
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({ ssrfSafeDispatcher: {} })
);

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe.each(['', '/dashboard/studio'])(
  'Studio response policy %s',
  (base) => {
    beforeEach(() => {
      process.env.LINKSELF_BASE_PATH = base;
      process.env.FRONTEND_URL = 'https://studio.test' + base;
      process.env.LINKSELF_URL = 'https://linkself.test';
    });
    it.each(['text/html', 'image/svg+xml', 'video/mp4'])(
      'keeps the media response type for case %#',
      async (type) => {
        const response = Object.assign(
          new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          }),
          {
            setHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
          }
        );
        jest
          .spyOn(global, 'fetch')
          .mockResolvedValue(
            new Response('<p>content</p>', {
              headers: { 'Content-Type': type },
            })
          );
        const controller = new PublicController(
          {} as any,
          {} as any,
          {} as any,
          {} as any
        );
        await controller.streamFile(
          { url: 'https://media.test/file.mp4' } as any,
          response as any,
          { on: jest.fn() } as any
        );
        expect(response.setHeader).toHaveBeenCalledWith(
          'Content-Type',
          'video/mp4'
        );
        expect(response.setHeader).toHaveBeenCalledWith(
          'X-Content-Type-Options',
          'nosniff'
        );
        expect(response.setHeader).toHaveBeenCalledWith(
          'Content-Security-Policy',
          "default-src 'none'; sandbox"
        );
      }
    );
    it.each([
      '/user/delete-account',
      '/user/api-key/rotate',
      '/auth/login',
      '/integrations/social-connect/test',
    ])('checks request origin case %#', (path) => {
      const response: any = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();
      studioRequestPolicy(
        {
          method: 'POST',
          path,
          headers: { origin: 'https://other.test', authorization: 'unused' },
        } as any,
        response,
        next
      );
      expect(response.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
    it.each([
      '/public/v1/posts',
      '/enterprise/limits',
      '/enterprise/delete-channel',
    ])('preserves server route case %#', (path) => {
      const response: any = { setHeader: jest.fn() };
      const next = jest.fn();
      studioRequestPolicy(
        {
          method: 'POST',
          path,
          headers: { origin: 'https://server.test' },
        } as any,
        response,
        next
      );
      expect(next).toHaveBeenCalled();
    });
    it.each([undefined, 'https://studio.test'])(
      'accepts local requests case %#',
      (origin) => {
        const next = jest.fn();
        studioRequestPolicy(
          {
            method: 'POST',
            path: '/user/personal',
            headers: { origin },
          } as any,
          { setHeader: jest.fn() } as any,
          next
        );
        expect(next).toHaveBeenCalled();
      }
    );
    it('loads the current studio user in LinkSelf mode', async () => {
      const controller = new UsersController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const result = await controller.getSelf(
        { id: 'user' } as any,
        { id: 'org', users: [{ role: 'USER' }] } as any,
        { cookies: {}, headers: {} } as any
      );
      expect(result.id).toBe('user');
      expect(result.orgId).toBe('org');
    });
    it('keeps account management in LinkSelf', async () => {
      const users = { getDeleteAccountInfo: jest.fn(), deleteUser: jest.fn() };
      const controller = new UsersController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        users as any,
        {} as any
      );
      await expect(
        controller.deleteAccount(
          { id: 'user' } as any,
          { cookies: {}, headers: {} } as any,
          {} as any
        )
      ).rejects.toMatchObject({ status: 403 });
      expect(users.deleteUser).not.toHaveBeenCalled();
    });
  }
);

it('keeps upstream request behavior', () => {
  delete process.env.LINKSELF_URL;
  const next = jest.fn();
  const response: any = { setHeader: jest.fn() };
  studioRequestPolicy(
    {
      method: 'POST',
      path: '/user/personal',
      headers: { origin: 'https://other.test' },
    } as any,
    response,
    next
  );
  expect(next).toHaveBeenCalled();
  expect(response.setHeader).not.toHaveBeenCalled();
});
