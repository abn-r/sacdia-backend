import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';
import { PosthogService } from './posthog.service';

jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    _shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('PosthogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not open a client when the project token is missing', () => {
    const service = new PosthogService(configWith({}));

    service.capture('investiture_marked_invested', 'user-1', {
      enrollment_id: 1,
    });

    expect(PostHog).not.toHaveBeenCalled();
  });

  it('captures the actor id when the project token is set', async () => {
    const service = new PosthogService(
      configWith({
        POSTHOG_PROJECT_TOKEN: 'phc_test',
        POSTHOG_HOST: 'https://us.i.posthog.com',
      }),
    );

    service.capture('investiture_marked_invested', 'user-1', {
      enrollment_id: 9,
    });

    const client = (PostHog as unknown as jest.Mock).mock.results.at(-1)
      ?.value as {
      capture: jest.Mock;
      _shutdown: jest.Mock;
    };

    expect(client.capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'investiture_marked_invested',
      properties: { enrollment_id: 9 },
    });

    await service.onModuleDestroy();
    expect(client._shutdown).toHaveBeenCalled();
  });

  it('does not create the PostHog client until the first capture', async () => {
    const service = new PosthogService(
      configWith({ POSTHOG_PROJECT_TOKEN: 'phc_test' }),
    );

    expect(PostHog).not.toHaveBeenCalled();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(PostHog).not.toHaveBeenCalled();

    service.capture('event_a', 'user-1');
    service.capture('event_b', 'user-1');

    expect(PostHog).toHaveBeenCalledTimes(1);
    expect(PostHog).toHaveBeenCalledWith('phc_test', {
      host: 'https://us.i.posthog.com',
    });
  });

  it('does not create the client for an empty distinct id', () => {
    const service = new PosthogService(
      configWith({ POSTHOG_PROJECT_TOKEN: 'phc_test' }),
    );

    service.capture('event_a', '');

    expect(PostHog).not.toHaveBeenCalled();
  });
});

describe('PosthogService module loading', () => {
  afterEach(() => {
    jest.dontMock('posthog-node');
  });

  it('does not load posthog-node on import and loads it on first capture', () => {
    jest.resetModules();
    const loaded = jest.fn();
    const capture = jest.fn();
    jest.doMock('posthog-node', () => {
      loaded();
      return { PostHog: jest.fn().mockImplementation(() => ({ capture })) };
    });

    const { PosthogService: Isolated } = require('./posthog.service') as {
      PosthogService: typeof PosthogService;
    };
    const service = new Isolated(configWith({ POSTHOG_PROJECT_TOKEN: 'phc' }));
    expect(loaded).not.toHaveBeenCalled();

    service.capture('event_a', 'user-1');
    service.capture('event_b', 'user-1');

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
