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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const firebase_admin_module_1 = require("../config/firebase-admin.module");
const prisma_service_1 = require("../prisma/prisma.service");
let NotificationsService = class NotificationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    isFcmConfigured() {
        return firebase_admin_module_1.firebaseAdmin.apps.length > 0;
    }
    async sendToUser(dto) {
        if (!this.isFcmConfigured()) {
            return {
                success: false,
                message: 'FCM service is not configured in this environment',
            };
        }
        const tokens = await this.prisma.user_fcm_tokens.findMany({
            where: {
                user_id: dto.userId,
                active: true,
            },
            select: { token: true },
        });
        if (tokens.length === 0) {
            return { success: false, message: 'No active FCM tokens found' };
        }
        const tokenStrings = tokens.map((t) => t.token);
        const response = await firebase_admin_module_1.firebaseAdmin.messaging().sendEachForMulticast({
            tokens: tokenStrings,
            notification: {
                title: dto.title,
                body: dto.body,
            },
            data: dto.data,
        });
        if (response.failureCount > 0) {
            const failedTokens = response.responses
                .map((resp, idx) => (resp.success ? null : tokenStrings[idx]))
                .filter((token) => token !== null);
            if (failedTokens.length > 0) {
                await this.prisma.user_fcm_tokens.updateMany({
                    where: { token: { in: failedTokens } },
                    data: { active: false },
                });
            }
        }
        return {
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount,
        };
    }
    async broadcast(dto) {
        if (!this.isFcmConfigured()) {
            return {
                success: false,
                message: 'FCM service is not configured in this environment',
            };
        }
        const tokens = await this.prisma.user_fcm_tokens.findMany({
            where: { active: true },
            select: { token: true },
        });
        if (tokens.length === 0) {
            return { success: false, message: 'No active tokens' };
        }
        const tokenStrings = tokens.map((t) => t.token);
        const batches = this.chunkArray(tokenStrings, 500);
        let totalSuccess = 0;
        let totalFailure = 0;
        for (const batch of batches) {
            const response = await firebase_admin_module_1.firebaseAdmin.messaging().sendEachForMulticast({
                tokens: batch,
                notification: {
                    title: dto.title,
                    body: dto.body,
                },
                data: dto.data,
            });
            totalSuccess += response.successCount;
            totalFailure += response.failureCount;
        }
        return {
            success: true,
            successCount: totalSuccess,
            failureCount: totalFailure,
        };
    }
    async sendToClubMembers(clubInstanceId, instanceType, dto) {
        if (!this.isFcmConfigured()) {
            return {
                success: false,
                message: 'FCM service is not configured in this environment',
            };
        }
        const columnMap = {
            adventurers: 'club_adv_id',
            pathfinders: 'club_pathf_id',
            master_guilds: 'club_mg_id',
        };
        const members = await this.prisma.club_role_assignments.findMany({
            where: {
                [columnMap[instanceType]]: clubInstanceId,
                active: true,
            },
            select: { user_id: true },
        });
        const userIds = members.map((m) => m.user_id);
        if (userIds.length === 0) {
            return { success: false, message: 'No members found' };
        }
        const tokens = await this.prisma.user_fcm_tokens.findMany({
            where: {
                user_id: { in: userIds },
                active: true,
            },
            select: { token: true },
        });
        if (tokens.length === 0) {
            return { success: false, message: 'No active tokens for club members' };
        }
        const tokenStrings = tokens.map((t) => t.token);
        const batches = this.chunkArray(tokenStrings, 500);
        let totalSuccess = 0;
        let totalFailure = 0;
        for (const batch of batches) {
            const response = await firebase_admin_module_1.firebaseAdmin.messaging().sendEachForMulticast({
                tokens: batch,
                notification: {
                    title: dto.title,
                    body: dto.body,
                },
                data: dto.data,
            });
            totalSuccess += response.successCount;
            totalFailure += response.failureCount;
        }
        return {
            success: true,
            successCount: totalSuccess,
            failureCount: totalFailure,
            memberCount: userIds.length,
        };
    }
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map