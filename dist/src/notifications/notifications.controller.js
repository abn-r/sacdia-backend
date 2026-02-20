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
exports.FcmTokensController = exports.NotificationsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const notifications_service_1 = require("./notifications.service");
const fcm_tokens_service_1 = require("./fcm-tokens.service");
const class_validator_1 = require("class-validator");
const global_roles_decorator_1 = require("../common/decorators/global-roles.decorator");
const guards_1 = require("../common/guards");
class SendNotificationDto {
    userId;
    title;
    body;
    data;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], SendNotificationDto.prototype, "userId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], SendNotificationDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], SendNotificationDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], SendNotificationDto.prototype, "data", void 0);
class BroadcastNotificationDto {
    title;
    body;
    data;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], BroadcastNotificationDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], BroadcastNotificationDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], BroadcastNotificationDto.prototype, "data", void 0);
class RegisterFcmTokenDto {
    token;
    device_type;
    device_name;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RegisterFcmTokenDto.prototype, "token", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RegisterFcmTokenDto.prototype, "device_type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RegisterFcmTokenDto.prototype, "device_name", void 0);
let NotificationsController = class NotificationsController {
    notificationsService;
    fcmTokensService;
    constructor(notificationsService, fcmTokensService) {
        this.notificationsService = notificationsService;
        this.fcmTokensService = fcmTokensService;
    }
    async sendToUser(dto) {
        return this.notificationsService.sendToUser(dto);
    }
    async broadcast(dto) {
        return this.notificationsService.broadcast(dto);
    }
    async sendToClub(instanceType, instanceId, dto) {
        return this.notificationsService.sendToClubMembers(parseInt(instanceId), instanceType, dto);
    }
};
exports.NotificationsController = NotificationsController;
__decorate([
    (0, common_1.Post)('send'),
    (0, swagger_1.ApiOperation)({ summary: 'Send notification to specific user' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SendNotificationDto]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "sendToUser", null);
__decorate([
    (0, common_1.Post)('broadcast'),
    (0, common_1.UseGuards)(guards_1.GlobalRolesGuard),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Send notification to all users' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BroadcastNotificationDto]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "broadcast", null);
__decorate([
    (0, common_1.Post)('club/:instanceType/:instanceId'),
    (0, common_1.UseGuards)(guards_1.GlobalRolesGuard),
    (0, global_roles_decorator_1.GlobalRoles)('super_admin', 'admin'),
    (0, swagger_1.ApiOperation)({ summary: 'Send notification to club members' }),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Param)('instanceType')),
    __param(1, (0, common_1.Param)('instanceId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, BroadcastNotificationDto]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "sendToClub", null);
exports.NotificationsController = NotificationsController = __decorate([
    (0, swagger_1.ApiTags)('Notifications'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Controller)('notifications'),
    __metadata("design:paramtypes", [notifications_service_1.NotificationsService,
        fcm_tokens_service_1.FcmTokensService])
], NotificationsController);
let FcmTokensController = class FcmTokensController {
    fcmTokensService;
    constructor(fcmTokensService) {
        this.fcmTokensService = fcmTokensService;
    }
    async registerToken(dto, req) {
        return this.fcmTokensService.registerToken(req.user.sub, dto);
    }
    async unregisterToken(token, req) {
        return this.fcmTokensService.unregisterToken(token, req.user.sub);
    }
    async getMyTokens(req) {
        return this.fcmTokensService.getUserTokens(req.user.sub);
    }
    async getUserTokens(userId) {
        return this.fcmTokensService.getUserTokens(userId);
    }
};
exports.FcmTokensController = FcmTokensController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Register FCM token' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RegisterFcmTokenDto, Object]),
    __metadata("design:returntype", Promise)
], FcmTokensController.prototype, "registerToken", null);
__decorate([
    (0, common_1.Delete)(':token'),
    (0, swagger_1.ApiOperation)({ summary: 'Unregister FCM token' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FcmTokensController.prototype, "unregisterToken", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get current user FCM tokens' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FcmTokensController.prototype, "getMyTokens", null);
__decorate([
    (0, common_1.Get)('user/:userId'),
    (0, common_1.UseGuards)(guards_1.OwnerOrAdminGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get FCM tokens by user ID (owner/admin only)' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('userId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FcmTokensController.prototype, "getUserTokens", null);
exports.FcmTokensController = FcmTokensController = __decorate([
    (0, swagger_1.ApiTags)('FCM Tokens'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Controller)('fcm-tokens'),
    __metadata("design:paramtypes", [fcm_tokens_service_1.FcmTokensService])
], FcmTokensController);
//# sourceMappingURL=notifications.controller.js.map