import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthorizationContextService } from './services/authorization-context.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { SessionManagementService } from './services/session-management.service';
import { MfaService } from './services/mfa.service';
import { IpWhitelistGuard } from './guards/ip-whitelist.guard';
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
            let redisClient: any;
            try {
              // Validación temprana de URL para evitar errores ambiguos.
              new URL(rawRedisUrl);

              const { redisInsStore } = await import('cache-manager-redis-yet');
              const { createClient } = await import('redis');
              console.log('🔄 Attempting to connect to Redis...');

              const redisOptions: any = {
                url: rawRedisUrl,
                socket: {
                  connectTimeout: 5000, // 5 segundos timeout
                  reconnectStrategy: () => false, // No reintentar en desarrollo
                },
              };

              if (rawRedisUrl.startsWith('rediss://')) {
                redisOptions.socket.tls = true;
              }

              redisClient = createClient(redisOptions);

              redisClient.on('error', (err: unknown) => {
                const message =
                  err instanceof Error ? err.message : String(err);
                console.warn('⚠️  Redis runtime error:', message);
              });

              redisClient.on('end', () => {
                console.warn('⚠️  Redis connection ended.');
              });

              await redisClient.connect();

              const store = redisInsStore(redisClient, {
                ttl: 86400000,
              });

              console.log('✅ Redis cache connected successfully');
              return {
                store,
                ttl: 86400000, // 24 horas en ms
              };
            } catch (error) {
              if (redisClient?.isOpen) {
                await redisClient.disconnect().catch(() => undefined);
              }
              const message =
                error instanceof Error ? error.message : 'Unknown error';
              console.warn('⚠️  Redis connection failed:', message);
              console.warn(
                '📦 Falling back to in-memory cache (development mode)',
              );
              // Continuar con fallback en lugar de fallar
            }
          }
        }

        // Fallback a in-memory cache para desarrollo local
        console.log('💾 Using in-memory cache');
        return {
          ttl: 86400000,
          max: 10000,
        };
      },
    }),
    // BetterAuthModule provides 'BETTER_AUTH_INSTANCE' needed by MfaService.
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
    IpWhitelistGuard,
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
    IpWhitelistGuard,
    PermissionsGuard,
    FILE_STORAGE_SERVICE,
  ],
})
export class CommonModule {}
