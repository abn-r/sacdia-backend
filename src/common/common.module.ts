import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthorizationContextService } from './services/authorization-context.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { SessionManagementService } from './services/session-management.service';
import { MfaService } from './services/mfa.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { R2FileStorageService } from './services/r2-file-storage.service';
import { FILE_STORAGE_SERVICE } from './services/file-storage.service';
import { BetterAuthModule } from '../better-auth/better-auth.module';

function isPlaceholderRedisUrl(value: string): boolean {
  return ['YOUR_PASSWORD', 'YOUR_REGION', 'YOUR_PORT'].some((token) =>
    value.includes(token),
  );
}

@Global()
@Module({
  imports: [
    // ==========================================
    // CACHE - Para Token Blacklist y Sessions
    // ==========================================
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const rawRedisUrl = process.env.REDIS_URL?.trim();

        // Si REDIS_URL está configurado, intentar usar Upstash Redis
        if (rawRedisUrl) {
          if (isPlaceholderRedisUrl(rawRedisUrl)) {
            console.warn(
              '⚠️  REDIS_URL contains placeholder values. Skipping Redis connection.',
            );
          } else {
            try {
              new URL(rawRedisUrl);

              const { default: KeyvRedis } = await import('@keyv/redis');
              console.log('🔄 Attempting to connect to Redis...');

              const keyvRedis = new KeyvRedis(rawRedisUrl);

              console.log('✅ Redis cache connected successfully');
              return {
                stores: [keyvRedis],
                ttl: 86400000, // 24 horas en ms
              };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : 'Unknown error';
              console.warn('⚠️  Redis connection failed:', message);
              console.warn(
                '📦 Falling back to in-memory cache (development mode)',
              );
            }
          }
        }

        // Fallback a in-memory cache para desarrollo local
        console.log('💾 Using in-memory cache');
        return {
          ttl: 86400000,
        };
      },
    }),
    // BetterAuthModule provides BetterAuthService (used by MfaService for TOTP operations).
    BetterAuthModule,
  ],
  providers: [
    // ==========================================
    // SERVICIOS DE SEGURIDAD
    // ==========================================
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    AuthorizationContextService,
    PermissionsGuard,
    R2FileStorageService,
    {
      provide: FILE_STORAGE_SERVICE,
      useExisting: R2FileStorageService,
    },
  ],
  exports: [
    CacheModule,
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    AuthorizationContextService,
    PermissionsGuard,
    FILE_STORAGE_SERVICE,
  ],
})
export class CommonModule {}
