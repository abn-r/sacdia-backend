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
});
