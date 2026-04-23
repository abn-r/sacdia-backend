import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { QrMemberTokenDto } from './dto/qr-token.dto';

const QR_MEMBER_AUDIENCE = 'sacdia:qr-member';
const QR_MEMBER_VERSION = 1;
const QR_MEMBER_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class QrService {
  constructor(private readonly jwtService: JwtService) {}

  generateMemberToken(userId: string): QrMemberTokenDto {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + QR_MEMBER_TTL_SECONDS;

    const token = this.jwtService.sign(
      {
        sub: userId,
        aud: QR_MEMBER_AUDIENCE,
        iat,
        exp,
        ver: QR_MEMBER_VERSION,
      },
      {
        algorithm: 'HS256',
      },
    );

    return {
      token,
      expires_at: new Date(exp * 1000).toISOString(),
      expires_in: QR_MEMBER_TTL_SECONDS,
    };
  }
}
