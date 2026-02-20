"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const openapi = require("@nestjs/swagger");
const cache_manager_1 = require("@nestjs/cache-manager");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const firebase_admin_module_1 = require("../config/firebase-admin.module");
const prisma_service_1 = require("../prisma/prisma.service");
let HealthController = class HealthController {
    prisma;
    cacheManager;
    constructor(prisma, cacheManager) {
        this.prisma = prisma;
        this.cacheManager = cacheManager;
    }
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
                initialized: firebase_admin_module_1.firebaseAdmin.apps.length > 0,
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
    async checkDatabase() {
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            return { ok: true };
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown DB error',
            };
        }
    }
    async checkCache() {
        const key = `health:cache:${Date.now()}`;
        try {
            await this.cacheManager.set(key, 'ok', 5_000);
            const value = await this.cacheManager.get(key);
            return { ok: value === 'ok' };
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown cache error',
            };
        }
    }
    isFcmConfigured() {
        return Boolean(process.env.FIREBASE_PROJECT_ID &&
            process.env.FIREBASE_PRIVATE_KEY &&
            process.env.FIREBASE_CLIENT_EMAIL);
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Check API status' }),
    openapi.ApiResponse({ status: 200 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "check", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, common_1.Controller)('health'),
    __param(1, (0, common_1.Inject)(cache_manager_1.CACHE_MANAGER)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], HealthController);
//# sourceMappingURL=health.controller.js.map