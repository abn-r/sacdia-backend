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
var JwtStrategy_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const config_1 = require("@nestjs/config");
const token_blacklist_service_1 = require("../../common/services/token-blacklist.service");
let JwtStrategy = JwtStrategy_1 = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    configService;
    tokenBlacklistService;
    logger = new common_1.Logger(JwtStrategy_1.name);
    constructor(configService, tokenBlacklistService) {
        const jwtSecret = configService.get('SUPABASE_JWT_SECRET');
        if (!jwtSecret) {
            throw new Error('SUPABASE_JWT_SECRET is missing. JWT validation cannot be initialized.');
        }
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: jwtSecret,
            passReqToCallback: true,
        });
        this.configService = configService;
        this.tokenBlacklistService = tokenBlacklistService;
    }
    async validate(req, payload) {
        const token = this.extractToken(req);
        if (token && (await this.tokenBlacklistService.isBlacklisted(token))) {
            this.logger.warn(JSON.stringify({
                event: 'auth_jwt_revoked_token',
                sub: payload.sub,
            }));
            throw new common_1.UnauthorizedException('revoked');
        }
        if (payload.sub &&
            payload.iat &&
            (await this.tokenBlacklistService.isUserBlacklisted(payload.sub, payload.iat))) {
            this.logger.warn(JSON.stringify({
                event: 'auth_jwt_user_blacklisted',
                sub: payload.sub,
            }));
            throw new common_1.UnauthorizedException('revoked');
        }
        return {
            sub: payload.sub,
            userId: payload.sub,
            user_id: payload.sub,
            email: payload.email,
        };
    }
    extractToken(req) {
        const authHeader = req.headers?.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.slice('Bearer '.length).trim();
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = JwtStrategy_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        token_blacklist_service_1.TokenBlacklistService])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map