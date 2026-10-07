import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

type PosthogProperties = Record<string, string | number | boolean>;

@Injectable()
export class PosthogService implements OnModuleDestroy {
  private readonly logger = new Logger(PosthogService.name);
  private readonly client: PostHog | null;

  constructor(config: ConfigService) {
    const token = config.get<string>('POSTHOG_PROJECT_TOKEN')?.trim() ?? '';
    const host =
      config.get<string>('POSTHOG_HOST')?.trim() || 'https://us.i.posthog.com';

    if (!token) {
      this.client = null;
      return;
    }

    this.client = new PostHog(token, { host });
  }

  capture(event: string, distinctId: string, properties?: PosthogProperties) {
    if (!this.client || distinctId.length === 0) {
      return;
    }

    this.client.capture({
      distinctId,
      event,
      properties,
    });
  }

  async onModuleDestroy() {
    if (!this.client) {
      return;
    }

    try {
      await this.client._shutdown();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`PostHog shutdown failed: ${message}`);
    }
  }
}
