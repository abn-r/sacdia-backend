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
exports.FcmTokensService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let FcmTokensService = class FcmTokensService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async registerToken(userId, dto) {
        const existing = await this.prisma.user_fcm_tokens.findFirst({
            where: { token: dto.token },
        });
        if (existing) {
            return this.prisma.user_fcm_tokens.update({
                where: { fcm_token_id: existing.fcm_token_id },
                data: {
                    user_id: userId,
                    active: true,
                    last_used: new Date(),
                    device_type: dto.device_type,
                    device_name: dto.device_name,
                },
            });
        }
        return this.prisma.user_fcm_tokens.create({
            data: {
                user_id: userId,
                token: dto.token,
                device_type: dto.device_type,
                device_name: dto.device_name,
                active: true,
            },
        });
    }
    async unregisterToken(token, userId) {
        const existing = await this.prisma.user_fcm_tokens.findFirst({
            where: { token },
        });
        if (!existing) {
            throw new common_1.NotFoundException('FCM token not found');
        }
        if (existing.user_id !== userId) {
            throw new common_1.ForbiddenException('You can only unregister your own tokens');
        }
        await this.prisma.user_fcm_tokens.updateMany({
            where: { token, user_id: userId, active: true },
            data: { active: false },
        });
        return {
            success: true,
            message: 'FCM token unregistered successfully',
        };
    }
    async getUserTokens(userId) {
        return this.prisma.user_fcm_tokens.findMany({
            where: {
                user_id: userId,
                active: true,
            },
        });
    }
    async cleanupOldTokens() {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const result = await this.prisma.user_fcm_tokens.deleteMany({
            where: {
                last_used: {
                    lt: ninetyDaysAgo,
                },
            },
        });
        return { deletedCount: result.count };
    }
};
exports.FcmTokensService = FcmTokensService;
exports.FcmTokensService = FcmTokensService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FcmTokensService);
//# sourceMappingURL=fcm-tokens.service.js.map