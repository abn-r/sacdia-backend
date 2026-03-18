import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Cache } from 'cache-manager';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API status' })
  async check() {
    const dbStatus = await this.checkDatabase();
    const cacheStatus = await this.checkCache();
    const fcmConfigured = this.isFcmConfigured();
    const sentryConfigured = Boolean(process.env.SENTRY_DSN);

    const dependencies = {
      database: dbStatus,
      cache: cacheStatus,
      fcm: {
        configured: fcmConfigured,
        initialized: firebaseAdmin.apps.length > 0,
      },
      sentry: {
        configured: sentryConfigured,
      },
    };

    const overallStatus = dbStatus.ok ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies,
    };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown DB error',
      };
    }
  }

  private async checkCache() {
    const key = `health:cache:${Date.now()}`;
    try {
      await this.cacheManager.set(key, 'ok', 5_000);
      const value = await this.cacheManager.get<string>(key);
      return { ok: value === 'ok' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown cache error',
      };
    }
  }

  private isFcmConfigured(): boolean {
    const hasJsonCredentials =
      this.hasConfiguredValue(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
      ) || this.hasConfiguredValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

    const hasLegacyCredentials =
      this.hasConfiguredValue(process.env.FIREBASE_PROJECT_ID) &&
      this.hasConfiguredValue(process.env.FIREBASE_PRIVATE_KEY) &&
      this.hasConfiguredValue(process.env.FIREBASE_CLIENT_EMAIL);

    return hasJsonCredentials || hasLegacyCredentials;
  }

  private hasConfiguredValue(value?: string): boolean {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;

    const placeholderPatterns = [
      /YOUR_/i,
      /your-project-id/i,
      /firebase-adminsdk-xxxxx/i,
      /YOUR_PRIVATE_KEY_HERE/i,
    ];

    return !placeholderPatterns.some((pattern) => pattern.test(trimmed));
  }
}
