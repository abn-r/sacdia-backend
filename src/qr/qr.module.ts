import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AchievementsModule } from '../achievements/achievements.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CoordinationModule } from '../coordination/coordination.module';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { resolveQrJwtSecret } from './qr-jwt-secret';

@Module({
  imports: [
    PrismaModule,
    AchievementsModule,
    CoordinationModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: resolveQrJwtSecret(configService),
        signOptions: {
          expiresIn: '24h',
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [QrController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
