import { MCPServer } from '@mastra/mcp';
import { startMcp } from './start.mcp';
import { MastraService } from './mastra.service';
import { LoadToolsService } from './load.tools.service';
import { OrganizationService } from '../database/prisma/organizations/organization.service';
import { OAuthService } from '../database/prisma/oauth/oauth.service';
import { OrganizationLimitsService } from '../database/prisma/organization-limits/organization.limits.service';

jest.mock('@mastra/mcp', () => ({ MCPServer: jest.fn() }));
jest.mock('./mastra.service', () => ({ MastraService: class {} }));
jest.mock('./load.tools.service', () => ({ LoadToolsService: class {} }));
jest.mock('./mcp.relay.service', () => ({ McpRelayService: class {} }));
jest.mock('../database/prisma/organizations/organization.service', () => ({
  OrganizationService: class {},
}));
jest.mock('../database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
  selfHostedRelayEnabled: () => false,
}));
jest.mock('../upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ publicUrl: () => 'https://media.test' }),
    clippingEnabled: () => false,
  },
}));
jest.mock('./ui/upload.widget', () => ({
  UPLOAD_WIDGET_URI: 'ui://upload',
  uploadWidgetHtml: () => '',
}));
jest.mock('./ui/clipping.widget', () => ({
  CLIPPING_WIDGET_URI: 'ui://clipping',
  clippingWidgetHtml: () => '',
}));
jest.mock('./oauth-middleware', () => ({
  createOAuthMiddleware:
    ({ oauth }: any) =>
    async (req: any) => {
      const tokenValidation = await oauth.validateToken(
        req.headers.authorization.replace('Bearer ', '')
      );
      return { proceed: tokenValidation.valid, tokenValidation };
    },
}));

describe('MCP organization limits on every transport', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://studio.test';
    process.env.LINKSELF_URL = 'https://linkself.test';
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it.each(
    [
      '/mcp',
      '/mcp/:id',
      '/sse/:id',
      '/message/:id',
      '/mcp-oauth',
      '/mcp-oauth-chatgpt',
      '/mcp-oauth-claude',
      '/mcp-oauth-dynamic',
    ].flatMap((path) =>
      [false, true].flatMap((allowed) => ['', '/dashboard/studio'].map((base) => [path, allowed, base] as const))
    )
  )('%s permits MCP only when mcp is true (%s)', async (path, allowed, base) => {
    process.env.LINKSELF_BASE_PATH = base;
    process.env.FRONTEND_URL = 'https://studio.test';
    const startHTTP = jest.fn();
    const startSSE = jest.fn();
    (MCPServer as jest.Mock).mockImplementation(() => ({
      startHTTP,
      startSSE,
    }));
    const get = jest.fn(async () => ({
      plan: allowed ? 'pro' : 'free',
      channels: 3,
      postsPerMonth: 30,
      mcp: allowed,
    }));
    const limits = new OrganizationLimitsService({ get } as never, {} as never);
    const routes = new Map<string, Function>();
    const orgs = { getOrgByApiKey: jest.fn(async () => ({ id: 'key-org' })) };
    const oauth = {
      getOrgByOAuthToken: jest.fn(async () => ({
        organization: { id: 'oauth-org' },
      })),
    };
    const app = {
      get: (type: unknown) =>
        type === OrganizationLimitsService
          ? limits
          : type === OrganizationService
          ? orgs
          : type === OAuthService
          ? oauth
          : type === LoadToolsService
          ? { loadTools: async () => ({}) }
          : type === MastraService
          ? {}
          : {},
      use: (paths: string | string[], handler: Function) =>
        (Array.isArray(paths) ? paths : [paths]).forEach((route) =>
          routes.set(route, handler)
        ),
    };
    await startMcp(app as never);
    const isOauth = path.startsWith('/mcp-oauth');
    const req = {
      method: 'POST',
      path: '/',
      baseUrl: path,
      params: { id: 'api-key' },
      originalUrl: path.replace(':id', 'api-key'),
      headers: { authorization: `Bearer ${isOauth ? 'pos_token' : 'api-key'}` },
      rawHeaders: [] as string[],
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
      send: jest.fn(),
      setHeader: jest.fn(),
    };
    await routes.get(path)!(req, res, jest.fn());
    expect(get).toHaveBeenCalledWith(isOauth ? 'oauth-org' : 'key-org');
    if (allowed) {
      expect(startHTTP.mock.calls.length + startSSE.mock.calls.length).toBe(1);
      expect(res.status).not.toHaveBeenCalledWith(403);
      if (startSSE.mock.calls.length) {
        const args = startSSE.mock.calls[0][0];
        const prefix = base ? base + '/api' : '';
        expect(args.url.href).toBe('https://studio.test' + prefix + req.originalUrl);
        expect(args.ssePath).toBe(prefix + '/sse/api-key');
        expect(args.messagePath).toBe(prefix + '/message/api-key');
      }
    } else {
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: expect.stringContaining('Upgrade in LinkSelf'),
      });
      expect(startHTTP).not.toHaveBeenCalled();
      expect(startSSE).not.toHaveBeenCalled();
    }
  });
});
