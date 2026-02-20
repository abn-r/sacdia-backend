import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
export declare class HealthController {
    private readonly prisma;
    private readonly cacheManager;
    constructor(prisma: PrismaService, cacheManager: Cache);
    check(): Promise<{
        status: string;
        timestamp: string;
        uptime: number;
        dependencies: {
            database: {
                ok: boolean;
                error?: undefined;
            } | {
                ok: boolean;
                error: string;
            };
            cache: {
                ok: boolean;
                error?: undefined;
            } | {
                ok: boolean;
                error: string;
            };
            fcm: {
                configured: boolean;
                initialized: boolean;
            };
            sentry: {
                configured: boolean;
            };
        };
    }>;
    private checkDatabase;
    private checkCache;
    private isFcmConfigured;
}
