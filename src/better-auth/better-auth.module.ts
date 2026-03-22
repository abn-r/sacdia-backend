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
 * after successful BA auth operations (see BetterAuthService.signJwt).
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
  exports: [BetterAuthService],
})
export class BetterAuthModule {}
