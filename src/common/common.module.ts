import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { SessionManagementService } from './services/session-management.service';
import { MfaService } from './services/mfa.service';
import { IpWhitelistGuard } from './guards/ip-whitelist.guard';

@Global()
@Module({
  imports: [
    // ==========================================
    // CACHE - Para Token Blacklist y Sessions
    // ==========================================
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        // Si REDIS_URL está configurado, usar Upstash Redis
        if (process.env.REDIS_URL) {
          const { redisStore } = await import('cache-manager-redis-yet');
          return {
            store: await redisStore({
              url: process.env.REDIS_URL,
            }),
            ttl: 86400000, // 24 horas en ms
          };
        }
        // Fallback a in-memory cache para desarrollo local
        return {
          ttl: 86400000,
          max: 10000,
        };
      },
    }),
  ],
  providers: [
    // ==========================================
    // SERVICIOS DE SEGURIDAD
    // ==========================================
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    IpWhitelistGuard,
  ],
  exports: [
    CacheModule,
    TokenBlacklistService,
    SessionManagementService,
    MfaService,
    IpWhitelistGuard,
  ],
})
export class CommonModule {}
