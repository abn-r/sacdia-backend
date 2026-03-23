import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BetterAuthService } from './better-auth.service';
import { createBetterAuth, BetterAuthInstance } from './better-auth.config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BetterAuthModule
 *
 * Owns the Better Auth instance and the SACDIA JWT signer (Option C).
 *
 * Better Auth emits opaque session tokens — not JWTs.
 * JwtModule here is used exclusively to sign SACDIA's own HS256 bearer tokens
 * after successful auth operations (see BetterAuthService.signJwt).
 *
 * BetterAuthService now bypasses BA's Prisma adapter for user CRUD operations
 * (createUser, signInWithPassword, refreshSession, signOut, resetPasswordForEmail)
 * and writes directly to Prisma using our schema's snake_case field names.
 * This fixes a BA adapter limitation where WRITE operations use BA's internal
 * camelCase field names instead of the mapped snake_case names.
 *
 * BA instance is kept for OAuth (signInSocial, callbackOAuth) and TOTP (future).
 *
 * Secret: BETTER_AUTH_SECRET (separate from the legacy SUPABASE_JWT_SECRET).
 * Expiry: 1h — short-lived; clients must call refresh when it expires.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('BETTER_AUTH_SECRET'),
        signOptions: {
          expiresIn: '1h',
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  providers: [
    {
      provide: 'BETTER_AUTH_INSTANCE',
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): BetterAuthInstance =>
        createBetterAuth(prisma),
    },
    BetterAuthService,
  ],
  exports: [BetterAuthService, 'BETTER_AUTH_INSTANCE'],
})
export class BetterAuthModule {}
