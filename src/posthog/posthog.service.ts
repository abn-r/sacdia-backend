import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PostHog } from 'posthog-node';
import { lazyModule } from '../common/utils/lazy-module';

// posthog-node is only needed once an event is captured, so it is required
// (and the client created) on the first capture instead of at boot.
const loadPosthog = lazyModule(
  () => require('posthog-node') as typeof import('posthog-node'),
);

type PosthogProperties = Record<string, string | number | boolean>;

@Injectable()
export class PosthogService implements OnModuleDestroy {
  private readonly logger = new Logger(PosthogService.name);
  private readonly token: string;
  private readonly host: string;
  private client: PostHog | null = null;

  constructor(config: ConfigService) {
    this.token = config.get<string>('POSTHOG_PROJECT_TOKEN')?.trim() ?? '';
    this.host =
      config.get<string>('POSTHOG_HOST')?.trim() || 'https://us.i.posthog.com';
  }

  private getClient(): PostHog | null {
    if (!this.token) {
      return null;
    }

    this.client ??= new (loadPosthog().PostHog)(this.token, {
      host: this.host,
    });
    return this.client;
  }

  capture(event: string, distinctId: string, properties?: PosthogProperties) {
    if (!this.token || distinctId.length === 0) {
      return;
    }

    this.getClient()?.capture({
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
