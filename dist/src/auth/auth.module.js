"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const config_1 = require("@nestjs/config");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const oauth_controller_1 = require("./oauth.controller");
const oauth_service_1 = require("./oauth.service");
const jwt_strategy_1 = require("./strategies/jwt.strategy");
const authorization_context_service_1 = require("../common/services/authorization-context.service");
const supabase_service_1 = require("../common/supabase.service");
const mfa_controller_1 = require("./mfa.controller");
const sessions_controller_1 = require("./sessions.controller");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule.register({ defaultStrategy: 'jwt' }),
            jwt_1.JwtModule.registerAsync({
                inject: [config_1.ConfigService],
                useFactory: (configService) => ({
                    secret: configService.get('SUPABASE_JWT_SECRET'),
                    signOptions: {
                        expiresIn: '7d',
                    },
                }),
            }),
        ],
        controllers: [
            auth_controller_1.AuthController,
            mfa_controller_1.MfaController,
            sessions_controller_1.SessionsController,
            oauth_controller_1.OAuthController,
        ],
        providers: [
            auth_service_1.AuthService,
            oauth_service_1.OAuthService,
            jwt_strategy_1.JwtStrategy,
            supabase_service_1.SupabaseService,
            authorization_context_service_1.AuthorizationContextService,
        ],
        exports: [
            auth_service_1.AuthService,
            oauth_service_1.OAuthService,
            jwt_strategy_1.JwtStrategy,
            passport_1.PassportModule,
            authorization_context_service_1.AuthorizationContextService,
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map