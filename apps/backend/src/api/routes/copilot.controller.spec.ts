import { Logger } from '@nestjs/common';
import { copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import { CopilotController } from './copilot.controller';

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn(),
  OpenAIAdapter: jest.fn(),
  copilotRuntimeNodeHttpEndpoint: jest.fn(),
}));
jest.mock('@ag-ui/mastra', () => ({ MastraAgent: {} }));
jest.mock('@mastra/core/di', () => ({ RequestContext: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({
    SubscriptionService: class {},
  })
);

describe('Copilot without an AI key', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([undefined, ''])(
    'answers both endpoints with 503 for key %s',
    async (key) => {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      const mastra = { mastra: jest.fn() };
      const controller = new CopilotController({} as never, mastra as never);
      for (const endpoint of ['chatAgent', 'agent'] as const) {
        const response = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };
        await controller[endpoint](
          { body: { method: 'agent/run' } } as never,
          response as never,
          {} as never
        );
        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.json).toHaveBeenCalledWith({
          message: 'AI is not configured',
        });
      }
      expect(mastra.mastra).not.toHaveBeenCalled();
      expect(copilotRuntimeNodeHttpEndpoint).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, ''])(
    'answers chat discovery quietly without a key (%s)',
    (key) => {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      new CopilotController({} as never, {} as never).chatAgent(
        { body: { method: 'info' } } as never,
        response as never
      );
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ agents: {} });
      expect(Logger.warn).not.toHaveBeenCalled();
      expect(copilotRuntimeNodeHttpEndpoint).not.toHaveBeenCalled();
    }
  );

  it.each(['info', 'agent/run'])(
    'still dispatches configured %s requests',
    (method) => {
      process.env.OPENAI_API_KEY = 'test-key';
      const handler = jest.fn();
      (copilotRuntimeNodeHttpEndpoint as jest.Mock).mockReturnValue(handler);
      const request = { body: { method } } as never;
      const response = {} as never;
      new CopilotController({} as never, {} as never).chatAgent(
        request,
        response
      );
      expect(handler).toHaveBeenCalledWith(request, response);
    }
  );
});
