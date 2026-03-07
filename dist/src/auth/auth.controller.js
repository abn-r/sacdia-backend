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
exports.AuthController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const register_dto_1 = require("./dto/register.dto");
const login_dto_1 = require("./dto/login.dto");
const reset_password_request_dto_1 = require("./dto/reset-password-request.dto");
const refresh_session_dto_1 = require("./dto/refresh-session.dto");
const logout_dto_1 = require("./dto/logout.dto");
const set_active_club_context_dto_1 = require("./dto/set-active-club-context.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
let AuthController = class AuthController {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    async register(registerDto) {
        return this.authService.register(registerDto);
    }
    async login(loginDto) {
        return this.authService.login(loginDto);
    }
    async refresh(dto, userAgent) {
        return this.authService.refreshSession(dto, { userAgent });
    }
    async logout(authorization, dto = {}, userAgent) {
        return this.authService.logout({
            accessToken: this.extractBearerToken(authorization),
            refreshToken: dto.refreshToken,
            userAgent,
        });
    }
    async requestPasswordReset(dto) {
        return this.authService.requestPasswordReset(dto);
    }
    async getProfile(user) {
        return this.authService.getProfile(user.userId);
    }
    async setActiveContext(user, dto) {
        return this.authService.setActiveClubContext(user.userId, dto);
    }
    async getCompletionStatus(user) {
        return this.authService.getCompletionStatus(user.userId);
    }
    extractBearerToken(authorization) {
        if (!authorization || !authorization.startsWith('Bearer ')) {
            return undefined;
        }
        return authorization.slice('Bearer '.length).trim();
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    (0, swagger_1.ApiOperation)({ summary: 'Registrar nuevo usuario' }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Usuario registrado exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Error en validación o usuario ya existe',
    }),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Iniciar sesión' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Login exitoso, retorna tokens y usuario',
        schema: {
            example: {
                status: 'success',
                data: {
                    accessToken: 'eyJhbGc...',
                    refreshToken: 'v1.abc...',
                    expiresAt: 1900000000,
                    tokenType: 'bearer',
                    user: {
                        id: 'uuid-123',
                        email: 'user@sacdia.app',
                        name: 'Juan',
                        paternal_last_name: 'Perez',
                        maternal_last_name: 'Lopez',
                        avatar: null,
                        roles: ['user'],
                    },
                    needsPostRegistration: false,
                    postRegistrationStatus: null,
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'Credenciales inválidas',
    }),
    openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Refrescar sesión con refresh token' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Tokens renovados exitosamente',
        schema: {
            example: {
                status: 'success',
                data: {
                    accessToken: 'eyJhbGc...',
                    refreshToken: 'v1.abc...',
                    expiresAt: 1900000000,
                    tokenType: 'bearer',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Payload legacy no soportado (`refresh_token` retirado)',
        schema: {
            example: {
                statusCode: 400,
                message: 'refresh_token was removed. Use refreshToken in request body.',
                code: 'LEGACY_SNAKE_CASE_REMOVED',
                removedAt: '2026-03-01',
                use: 'refreshToken',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        description: 'Refresh token inválido o expirado',
    }),
    openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('user-agent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [refresh_session_dto_1.RefreshSessionDto, String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Cerrar sesión' }),
    (0, swagger_1.ApiBody)({
        required: false,
        schema: {
            type: 'object',
            properties: {
                refreshToken: {
                    type: 'string',
                    example: 'v1.abc...',
                    description: 'Refresh token opcional para logout fail-safe cuando el access token ya expiró.',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Sesión cerrada (best effort, no bloquea UX)',
    }),
    openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('user-agent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, logout_dto_1.LogoutDto, String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Post)('password/reset-request'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Solicitar recuperación de contraseña' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Correo de recuperación enviado',
    }),
    openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [reset_password_request_dto_1.ResetPasswordRequestDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "requestPasswordReset", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener perfil del usuario autenticado' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Información del usuario',
        schema: {
            type: 'object',
            properties: {
                status: { type: 'string', example: 'success' },
                data: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', example: 'user-uuid' },
                        email: { type: 'string', example: 'usuario@sacdia.app' },
                        name: { type: 'string', example: 'Juan' },
                        roles: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['user'],
                        },
                        permissions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['read'],
                        },
                        authorization: {
                            type: 'object',
                            description: 'Contrato canónico de autorización resuelto por backend.',
                        },
                        post_register_complete: {
                            type: 'boolean',
                            example: true,
                            description: 'Indica si el usuario completó el post-registro.',
                        },
                    },
                    required: [
                        'user_id',
                        'email',
                        'roles',
                        'permissions',
                        'authorization',
                        'post_register_complete',
                    ],
                },
            },
            required: ['status', 'data'],
        },
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Patch)('me/context'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Cambiar contexto activo de club/instancia del usuario',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Contexto activo actualizado',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'La asignación no pertenece o no está activa para el usuario',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, set_active_club_context_dto_1.SetActiveClubContextDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "setActiveContext", null);
__decorate([
    (0, common_1.Get)('profile/completion-status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener estado del post-registro' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Estado del post-registro del usuario',
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getCompletionStatus", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map