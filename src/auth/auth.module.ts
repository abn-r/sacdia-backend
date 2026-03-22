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
import { BetterAuthModule } from '../better-auth/better-auth.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // JwtModule here is registered for JwtStrategy and any helpers that need
    // token verification. Production auth uses BETTER_AUTH_SECRET (HS256) via
    // JwtStrategy — aligned with BetterAuthService.signJwt().
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('BETTER_AUTH_SECRET') ?? '',
        signOptions: {
          expiresIn: '1h',
          algorithm: 'HS256',
        },
      }),
    }),
    // BetterAuthModule provides BetterAuthService (Option C JWT signing + BA ops)
    BetterAuthModule,
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
    // SupabaseService: kept for any remaining Supabase-dependent operations.
    // OAuthService fully migrated to BetterAuthService (W3-008 Part 3).
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
