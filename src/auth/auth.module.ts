import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { MfaController } from './mfa.controller';
import { MfaGuard } from '../common/guards/mfa.guard';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { BetterAuthModule } from '../better-auth/better-auth.module';
import { SocialSignInModule } from './social-sign-in/social-sign-in.module';
import { LegalModule } from '../legal/legal.module';
import { ActingForModule } from './acting-for/acting-for.module';
import { GuardianshipsModule } from '../guardianships/guardianships.module';

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
          expiresIn: '8h',
          algorithm: 'HS256',
        },
      }),
    }),
    // BetterAuthModule provides BetterAuthService (Option C JWT signing + BA ops)
    BetterAuthModule,
    // Native Google/Apple sign-in (verifiers + Apple token client)
    SocialSignInModule,
    // LegalService: register validates/records acceptance, /auth/me exposes status.
    // Dependency is Auth -> Legal only (LegalModule never imports AuthModule).
    LegalModule,
    // ActingForResolver (principal substitution in JwtStrategy) + epoch cache.
    ActingForModule,
    // GuardianshipLifecycleService: account deletion detaches the guardian's
    // dependents in the same transaction. Dependency is Auth -> Guardianships
    // only (GuardianshipsModule never imports AuthModule).
    GuardianshipsModule,
  ],
  controllers: [
    AuthController,
    MfaController,
    SessionsController,
    OAuthController,
  ],
  providers: [
    AuthService,
    AccountDeletionService,
    OAuthService,
    JwtStrategy,
    AuthorizationContextService,
    MfaGuard,
    SessionsService,
  ],
  exports: [
    AuthService,
    AccountDeletionService,
    OAuthService,
    JwtStrategy,
    PassportModule,
    AuthorizationContextService,
    MfaGuard,
    SessionsService,
  ],
})
export class AuthModule {}
