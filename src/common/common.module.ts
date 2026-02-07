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
        // Si REDIS_URL está configurado, intentar usar Upstash Redis
        if (process.env.REDIS_URL) {
          try {
            const { redisStore } = await import('cache-manager-redis-yet');
            console.log('🔄 Attempting to connect to Redis...');
            
            const store = await redisStore({
              url: process.env.REDIS_URL,
              socket: {
                connectTimeout: 5000, // 5 segundos timeout
                reconnectStrategy: false, // No reintentar en desarrollo
              },
            });
            
            console.log('✅ Redis cache connected successfully');
            return {
              store,
              ttl: 86400000, // 24 horas en ms
            };
          } catch (error) {
            console.warn('⚠️  Redis connection failed:', error.message);
            console.warn('📦 Falling back to in-memory cache (development mode)');
            // Continuar con fallback en lugar de fallar
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
