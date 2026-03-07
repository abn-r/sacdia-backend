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
var OAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const supabase_service_1 = require("../common/supabase.service");
const auth_token_response_util_1 = require("./utils/auth-token-response.util");
const file_storage_service_1 = require("../common/services/file-storage.service");
let OAuthService = class OAuthService {
    static { OAuthService_1 = this; }
    prisma;
    supabase;
    fileStorage;
    logger = new common_1.Logger(OAuthService_1.name);
    static PRIVATE_ASSET_URL_TTL_SECONDS = 300;
    constructor(prisma, supabase, fileStorage) {
        this.prisma = prisma;
        this.supabase = supabase;
        this.fileStorage = fileStorage;
    }
    async initiateGoogleSignIn(redirectUrl) {
        const { data, error } = await this.supabase.admin.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl || 'https://sacdia.app/auth/callback',
            },
        });
        if (error) {
            this.logger.error(`Google OAuth initiation error: ${error.message}`);
            throw new common_1.InternalServerErrorException('Error al iniciar OAuth con Google');
        }
        return { url: data.url };
    }
    async initiateAppleSignIn(redirectUrl) {
        const { data, error } = await this.supabase.admin.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: redirectUrl || 'https://sacdia.app/auth/callback',
            },
        });
        if (error) {
            this.logger.error(`Apple OAuth initiation error: ${error.message}`);
            throw new common_1.InternalServerErrorException('Error al iniciar OAuth con Apple');
        }
        return { url: data.url };
    }
    async handleCallback(dto) {
        const { data, error } = await this.supabase.admin.auth.getUser(dto.access_token);
        if (error || !data.user) {
            this.logger.warn(`OAuth callback failed: ${error?.message}`);
            throw new common_1.UnauthorizedException('Invalid OAuth callback');
        }
        const supabaseUser = data.user;
        let dbUser = await this.prisma.users.findUnique({
            where: { user_id: supabaseUser.id },
        });
        if (!dbUser) {
            this.logger.log(`Creating new user from OAuth: ${supabaseUser.email}`);
            dbUser = await this.createUserFromOAuth(supabaseUser);
        }
        const identities = supabaseUser.identities || [];
        const googleConnected = identities.some((i) => i.provider === 'google');
        const appleConnected = identities.some((i) => i.provider === 'apple');
        await this.prisma.users.update({
            where: { user_id: supabaseUser.id },
            data: {
                google_connected: googleConnected,
                apple_connected: appleConnected,
            },
        });
        const userPr = await this.prisma.users_pr.findUnique({
            where: { user_id: supabaseUser.id },
        });
        return {
            ...(0, auth_token_response_util_1.buildAuthTokenResponse)({
                accessToken: dto.access_token,
                refreshToken: dto.refresh_token ?? null,
            }),
            user: {
                id: dbUser.user_id,
                email: dbUser.email,
                name: dbUser.name,
                paternal_last_name: dbUser.paternal_last_name,
                maternal_last_name: dbUser.maternal_last_name,
                avatar: await this.resolvePrivateProfilePicture(dbUser.user_image),
                google_connected: googleConnected,
                apple_connected: appleConnected,
            },
            needsPostRegistration: !userPr?.complete,
        };
    }
    async createUserFromOAuth(supabaseUser) {
        return await this.prisma.$transaction(async (tx) => {
            const user = await tx.users.create({
                data: {
                    user_id: supabaseUser.id,
                    email: supabaseUser.email,
                    name: supabaseUser.user_metadata?.name ||
                        supabaseUser.user_metadata?.full_name ||
                        supabaseUser.email.split('@')[0],
                    user_image: supabaseUser.user_metadata?.avatar_url ||
                        supabaseUser.user_metadata?.picture,
                },
            });
            await tx.users_pr.create({
                data: {
                    user_id: user.user_id,
                    complete: false,
                    profile_picture_complete: false,
                    personal_info_complete: false,
                    club_selection_complete: false,
                },
            });
            const userRole = await tx.roles.findFirst({
                where: {
                    role_name: 'user',
                    role_category: 'GLOBAL',
                },
            });
            if (!userRole) {
                throw new common_1.InternalServerErrorException('User role not found');
            }
            await tx.users_roles.create({
                data: {
                    user_id: user.user_id,
                    role_id: userRole.role_id,
                },
            });
            this.logger.log(`User created successfully: ${user.user_id}`);
            return user;
        });
    }
    async getConnectedProviders(userId) {
        const user = await this.prisma.users.findUnique({
            where: { user_id: userId },
            select: {
                google_connected: true,
                apple_connected: true,
                fb_connected: true,
            },
        });
        if (!user) {
            throw new common_1.BadRequestException('Usuario no encontrado');
        }
        return user;
    }
    async disconnectProvider(userId, provider) {
        const validProviders = ['google', 'apple', 'fb'];
        if (!validProviders.includes(provider)) {
            throw new common_1.BadRequestException('Provider inválido. Usa: google, apple, o fb');
        }
        const fieldName = `${provider}_connected`;
        await this.prisma.users.update({
            where: { user_id: userId },
            data: { [fieldName]: false },
        });
        this.logger.log(`Provider ${provider} disconnected for user: ${userId}`);
        return {
            success: true,
            message: 'Provider desconectado exitosamente',
        };
    }
    async resolvePrivateProfilePicture(value) {
        if (!value)
            return null;
        try {
            return await this.fileStorage.getSignedDownloadUrl(file_storage_service_1.StorageBucketAlias.USER_PROFILES, value, {
                expiresInSeconds: OAuthService_1.PRIVATE_ASSET_URL_TTL_SECONDS,
            });
        }
        catch (error) {
            this.logger.warn('Failed to generate signed URL for OAuth profile picture. Returning original value.', error);
            return value;
        }
    }
};
exports.OAuthService = OAuthService;
exports.OAuthService = OAuthService = OAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(file_storage_service_1.FILE_STORAGE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        supabase_service_1.SupabaseService, Object])
], OAuthService);
//# sourceMappingURL=oauth.service.js.map