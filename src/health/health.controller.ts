import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Cache } from 'cache-manager';
import { firebaseAdmin } from '../config/firebase-admin.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles, Public } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Public ping — returns ok if API is reachable',
    description:
      'Lightweight liveness probe. Returns HTTP 200 with a timestamp whenever the Node process is running. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'API is reachable',
    schema: {
      example: { status: 'ok', timestamp: '2026-05-11T00:00:00.000Z' },
    },
  })
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('details')
  @UseGuards(JwtAuthGuard, GlobalRolesGuard)
  @GlobalRoles('admin', 'super-admin')
  @SkipPermissions()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Detailed health status (admin only)',
    description:
      'Returns database pool, cache, FCM and Sentry status. ' +
      'The overall status is "ok" when both database and cache are reachable, "degraded" otherwise. ' +
      'Requires admin or super-admin global role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Health details for all infrastructure dependencies',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-05-11T00:00:00.000Z',
        uptime: 12345.6,
        dependencies: {
          database: {
            ok: true,
            pool: {
              max: 20,
              total: 6,
              idle: 2,
              active: 4,
              waiting: 0,
              utilization: 0.2,
            },
          },
          cache: {
            ok: true,
            catalogs: {
              hits: 120,
              misses: 8,
              coalescedLoads: 2,
              errors: 0,
              invalidations: 14,
            },
          },
          fcm: { configured: true, initialized: true },
          sentry: { configured: true },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not have admin or super-admin global role',
  })
  async details() {
    const dbStatus = await this.checkDatabase();
    const cacheStatus = await this.checkCache();
    const fcmConfigured = this.isFcmConfigured();
    const sentryConfigured = Boolean(process.env.SENTRY_DSN);

    const dependencies = {
      database: dbStatus,
      cache: cacheStatus,
      fcm: {
        configured: fcmConfigured,
        initialized: firebaseAdmin.getApps().length > 0,
      },
      sentry: {
        configured: sentryConfigured,
      },
    };

    const overallStatus = dbStatus.ok && cacheStatus.ok ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies,
    };
  }

  private async checkDatabase() {
    const pool = this.prisma.getPoolMetrics();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, pool };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown DB error',
        pool,
      };
    }
  }

  private async checkCache() {
    const key = `health:cache:${Date.now()}`;
    const catalogs = this.catalogCache.getMetrics();
    try {
      await this.cacheManager.set(key, 'ok', 5_000);
      const value = await this.cacheManager.get<string>(key);
      return { ok: value === 'ok', catalogs };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown cache error',
        catalogs,
      };
    } finally {
      await this.cacheManager.del(key).catch(() => undefined);
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
