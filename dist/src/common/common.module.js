"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommonModule = void 0;
const common_1 = require("@nestjs/common");
const cache_manager_1 = require("@nestjs/cache-manager");
const authorization_context_service_1 = require("./services/authorization-context.service");
const token_blacklist_service_1 = require("./services/token-blacklist.service");
const session_management_service_1 = require("./services/session-management.service");
const mfa_service_1 = require("./services/mfa.service");
const ip_whitelist_guard_1 = require("./guards/ip-whitelist.guard");
const r2_file_storage_service_1 = require("./services/r2-file-storage.service");
const file_storage_service_1 = require("./services/file-storage.service");
function isPlaceholderRedisUrl(value) {
    return ['YOUR_PASSWORD', 'YOUR_REGION', 'YOUR_PORT'].some((token) => value.includes(token));
}
let CommonModule = class CommonModule {
};
exports.CommonModule = CommonModule;
exports.CommonModule = CommonModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            cache_manager_1.CacheModule.registerAsync({
                isGlobal: true,
                useFactory: async () => {
                    const rawRedisUrl = process.env.REDIS_URL?.trim();
                    if (rawRedisUrl) {
                        if (isPlaceholderRedisUrl(rawRedisUrl)) {
                            console.warn('⚠️  REDIS_URL contains placeholder values. Skipping Redis connection.');
                        }
                        else {
                            let redisClient;
                            try {
                                new URL(rawRedisUrl);
                                const { redisInsStore } = await import('cache-manager-redis-yet');
                                const { createClient } = await import('redis');
                                console.log('🔄 Attempting to connect to Redis...');
                                const redisOptions = {
                                    url: rawRedisUrl,
                                    socket: {
                                        connectTimeout: 5000,
                                        reconnectStrategy: () => false,
                                    },
                                };
                                if (rawRedisUrl.startsWith('rediss://')) {
                                    redisOptions.socket.tls = true;
                                }
                                redisClient = createClient(redisOptions);
                                redisClient.on('error', (err) => {
                                    const message = err instanceof Error ? err.message : String(err);
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
                                    ttl: 86400000,
                                };
                            }
                            catch (error) {
                                if (redisClient?.isOpen) {
                                    await redisClient
                                        .disconnect()
                                        .catch(() => undefined);
                                }
                                const message = error instanceof Error ? error.message : 'Unknown error';
                                console.warn('⚠️  Redis connection failed:', message);
                                console.warn('📦 Falling back to in-memory cache (development mode)');
                            }
                        }
                    }
                    console.log('💾 Using in-memory cache');
                    return {
                        ttl: 86400000,
                        max: 10000,
                    };
                },
            }),
        ],
        providers: [
            token_blacklist_service_1.TokenBlacklistService,
            session_management_service_1.SessionManagementService,
            mfa_service_1.MfaService,
            authorization_context_service_1.AuthorizationContextService,
            ip_whitelist_guard_1.IpWhitelistGuard,
            r2_file_storage_service_1.R2FileStorageService,
            {
                provide: file_storage_service_1.FILE_STORAGE_SERVICE,
                useExisting: r2_file_storage_service_1.R2FileStorageService,
            },
        ],
        exports: [
            cache_manager_1.CacheModule,
            token_blacklist_service_1.TokenBlacklistService,
            session_management_service_1.SessionManagementService,
            mfa_service_1.MfaService,
            authorization_context_service_1.AuthorizationContextService,
            ip_whitelist_guard_1.IpWhitelistGuard,
            file_storage_service_1.FILE_STORAGE_SERVICE,
        ],
    })
], CommonModule);
//# sourceMappingURL=common.module.js.map