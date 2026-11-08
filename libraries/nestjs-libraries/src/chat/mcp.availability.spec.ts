import { MCPServer } from '@mastra/mcp';
import { MastraService } from './mastra.service';
import { LoadToolsService } from './load.tools.service';
import { GenerateImageTool } from './tools/generate.image.tool';
import { GenerateVideoTool } from './tools/generate.video.tool';
import { GenerateVideoOptionsTool } from './tools/generate.video.options.tool';
import { VideoFunctionTool } from './tools/video.function.tool';
import { VideoStatusTool } from './tools/video.status.tool';
import { startMcp } from './start.mcp';

jest.mock('./ui/upload.widget', () => ({
  UPLOAD_WIDGET_URI: 'ui://upload',
  uploadWidgetHtml: () => '',
}));
jest.mock('@mastra/mcp', () => ({ MCPServer: jest.fn() }));
jest.mock('@mastra/core/tools', () => ({
  createTool: (tool: unknown) => tool,
}));
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));
jest.mock('@ai-sdk/openai', () => ({ openai: jest.fn() }));
jest.mock('@mastra/memory', () => ({ Memory: class {} }));
jest.mock('./mastra.store', () => ({ pStore: {} }));
jest.mock('./mastra.service', () => ({ MastraService: class {} }));
jest.mock('./mcp.relay.service', () => ({ McpRelayService: class {} }));
jest.mock('./tools/tool.list', () => ({
  toolList: [
    require('./tools/generate.image.tool').GenerateImageTool,
    require('./tools/generate.video.tool').GenerateVideoTool,
    require('./tools/generate.video.options.tool').GenerateVideoOptionsTool,
    require('./tools/video.function.tool').VideoFunctionTool,
    require('./tools/video.status.tool').VideoStatusTool,
  ],
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service',
  () => ({
    OAuthService: class {},
    selfHostedRelayEnabled: () => false,
  })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ publicUrl: () => 'https://media.example.test' }),
    clippingEnabled: () => false,
  },
}));

describe('MCP feature availability', () => {
  const env = { ...process.env };
  const videos = { getAllVideos: jest.fn() };
  const image = new GenerateImageTool({} as never, {} as never);
  const videoTools = [
    new GenerateVideoTool({} as never, videos as never),
    new GenerateVideoOptionsTool(videos as never),
    new VideoFunctionTool(videos as never, {} as never),
    new VideoStatusTool({} as never, videos as never),
  ];
  const instances = [image, ...videoTools];
  const loader = new LoadToolsService({
    get: (target: unknown) =>
      instances.find((instance) => instance.constructor === target),
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    videos.getAllVideos.mockReturnValue([]);
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://social.example.test/api';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it.each([undefined, '', 'test-key'])(
    'filters the image tool for key %s',
    async (key) => {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      expect(image.available()).toBe(!!key);
      const tools = await loader.loadTools();
      expect(Object.keys(tools)).toEqual(key ? ['generateImageTool'] : []);
    }
  );

  it.each([false, true])(
    'filters all four video tools with usable video type: %s',
    async (available) => {
      delete process.env.OPENAI_API_KEY;
      videos.getAllVideos.mockReturnValue(
        available ? [{ title: 'Configured video' }] : []
      );
      for (const tool of videoTools) expect(tool.available()).toBe(available);
      expect(Object.keys(await loader.loadTools()).sort()).toEqual(
        available ? videoTools.map((tool) => tool.name).sort() : []
      );
    }
  );

  it.each([undefined, '', 'test-key'])(
    'registers ask_linkself only with a key: %s',
    async (key) => {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      const agent = { listTools: () => loader.loadTools() };
      const mastra = {
        mastra: jest.fn().mockResolvedValue({ getAgent: () => agent }),
      };
      const app = {
        get: (target: unknown) =>
          target === MastraService
            ? mastra
            : target === LoadToolsService
            ? loader
            : {},
        use: jest.fn(),
      };
      await startMcp(app as never);
      const configs = (MCPServer as jest.Mock).mock.calls.map(
        ([config]) => config
      );
      expect(configs).toHaveLength(3);
      // Mastra exposes agents.linkself as the catch-all ask_linkself tool.
      if (key) {
        expect(configs[0].agents).toEqual({ linkself: agent });
        expect(configs[0].tools).toHaveProperty('generateImageTool');
        expect(mastra.mastra).toHaveBeenCalledTimes(1);
      } else {
        for (const config of configs) {
          expect(config).not.toHaveProperty('agents');
          expect(config.tools).not.toHaveProperty('generateImageTool');
        }
        expect(mastra.mastra).not.toHaveBeenCalled();
      }
      // Directory-facing endpoints never expose the catch-all agent.
      expect(configs[1]).not.toHaveProperty('agents');
      expect(configs[2]).not.toHaveProperty('agents');
    }
  );
});
