import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { SupabaseService } from '../common/supabase.service';
import { MfaController } from './mfa.controller';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // JwtModule is registered here only for test helpers that use jwtService.sign().
    // Production auth uses JWKS (ES256) via jwt.strategy.ts — this secret is not used at runtime.
    // SUPABASE_JWT_SECRET is optional; falls back to empty string when not set.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('SUPABASE_JWT_SECRET') ?? '',
        signOptions: {
          expiresIn: '7d',
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    MfaController,
    SessionsController,
    OAuthController,
  ],
  providers: [
    AuthService,
    OAuthService,
    JwtStrategy,
    SupabaseService,
    AuthorizationContextService,
  ],
  exports: [
    AuthService,
    OAuthService,
    JwtStrategy,
    PassportModule,
    AuthorizationContextService,
  ],
})
export class AuthModule {}
