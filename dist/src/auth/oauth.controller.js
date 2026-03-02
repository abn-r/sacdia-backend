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
exports.OAuthController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const oauth_service_1 = require("./oauth.service");
const oauth_initiate_dto_1 = require("./dto/oauth-initiate.dto");
const oauth_callback_dto_1 = require("./dto/oauth-callback.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let OAuthController = class OAuthController {
    oauthService;
    constructor(oauthService) {
        this.oauthService = oauthService;
    }
    async googleSignIn(dto) {
        return await this.oauthService.initiateGoogleSignIn(dto.redirectUrl);
    }
    async appleSignIn(dto) {
        return await this.oauthService.initiateAppleSignIn(dto.redirectUrl);
    }
    async handleCallback(query) {
        return await this.oauthService.handleCallback(query);
    }
    async getConnectedProviders(req) {
        return await this.oauthService.getConnectedProviders(req.user.user_id);
    }
    async disconnectProvider(provider, req) {
        return await this.oauthService.disconnectProvider(req.user.user_id, provider);
    }
};
exports.OAuthController = OAuthController;
__decorate([
    (0, common_1.Post)('google'),
    (0, swagger_1.ApiOperation)({
        summary: 'Iniciar autenticación con Google',
        description: 'Retorna URL de OAuth de Google. Frontend debe redirigir al usuario a esta URL.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'URL de OAuth generada',
        schema: {
            example: {
                url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 500, description: 'Error al iniciar OAuth' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oauth_initiate_dto_1.OAuthInitiateDto]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "googleSignIn", null);
__decorate([
    (0, common_1.Post)('apple'),
    (0, swagger_1.ApiOperation)({
        summary: 'Iniciar autenticación con Apple',
        description: 'Retorna URL de OAuth de Apple. Frontend debe redirigir al usuario a esta URL.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'URL de OAuth generada',
        schema: {
            example: {
                url: 'https://appleid.apple.com/auth/authorize?client_id=...',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 500, description: 'Error al iniciar OAuth' }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oauth_initiate_dto_1.OAuthInitiateDto]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "appleSignIn", null);
__decorate([
    (0, common_1.Get)('callback'),
    (0, swagger_1.ApiOperation)({
        summary: 'Manejar callback de OAuth',
        description: 'Procesa el callback de Google/Apple después de autenticación exitosa. ' +
            'Auto-crea usuario si es primera vez. Retorna accessToken y datos de usuario.',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'access_token',
        required: true,
        description: 'Access token de Supabase',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'refresh_token',
        required: false,
        description: 'Refresh token de Supabase',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'provider',
        required: false,
        description: 'Provider usado (google, apple)',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Autenticación exitosa',
        schema: {
            example: {
                accessToken: 'eyJhbGc...',
                refreshToken: 'v1.abc...',
                user: {
                    id: 'uuid-123',
                    email: 'user@gmail.com',
                    name: 'Juan',
                    paternal_last_name: 'Pérez',
                    maternal_last_name: 'González',
                    avatar: 'https://lh3.googleusercontent.com/...',
                    google_connected: true,
                    apple_connected: false,
                },
                needsPostRegistration: true,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'Token de OAuth inválido',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oauth_callback_dto_1.OAuthCallbackDto]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "handleCallback", null);
__decorate([
    (0, common_1.Get)('providers'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener providers conectados',
        description: 'Retorna los providers de OAuth (Google, Apple, Facebook) conectados al usuario.',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Providers conectados',
        schema: {
            example: {
                google_connected: true,
                apple_connected: false,
                fb_connected: false,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'No autenticado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "getConnectedProviders", null);
__decorate([
    (0, common_1.Delete)(':provider'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Desconectar un provider',
        description: 'Desconecta un provider de OAuth (google, apple, fb) del usuario. ' +
            'Nota: Esto solo actualiza el flag en BD, no desvincula la cuenta en Supabase.',
    }),
    (0, swagger_1.ApiParam)({
        name: 'provider',
        description: 'Provider a desconectar',
        enum: ['google', 'apple', 'fb'],
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Provider desconectado',
        schema: {
            example: {
                success: true,
                message: 'Provider desconectado exitosamente',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Provider inválido' }),
    (0, swagger_1.ApiResponse)({ status: 401, description: 'No autenticado' }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('provider')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "disconnectProvider", null);
exports.OAuthController = OAuthController = __decorate([
    (0, swagger_1.ApiTags)('OAuth'),
    (0, common_1.Controller)('auth/oauth'),
    __metadata("design:paramtypes", [oauth_service_1.OAuthService])
], OAuthController);
//# sourceMappingURL=oauth.controller.js.map