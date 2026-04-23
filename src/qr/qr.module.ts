import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('BETTER_AUTH_SECRET');
        if (!secret || secret.length < 32) {
          const logger = new Logger('QrModule');
          logger.error('BETTER_AUTH_SECRET must be at least 32 characters');
          throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
        }
        return {
          secret,
          signOptions: {
            expiresIn: '24h',
            algorithm: 'HS256',
          },
        };
      },
    }),
  ],
  controllers: [QrController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
