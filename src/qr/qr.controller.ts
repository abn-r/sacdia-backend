import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QrMemberTokenDto } from './dto/qr-token.dto';
import { QrService } from './qr.service';

@ApiTags('qr')
@Controller('qr')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Get('member/token')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Issue a short-lived QR token for the authenticated member',
    description:
      'Returns a HS256 JWT (24 h TTL) embedding the caller\'s `user_id`. ' +
      'The client encodes this string as the QR payload. ' +
      'Scan endpoints validate the signature and enforce audience `sacdia:qr-member`.',
  })
  @ApiResponse({ status: 200, type: QrMemberTokenDto })
  @ApiResponse({ status: 401, description: 'Unauthorized — invalid or expired JWT' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  getMemberToken(@Req() req: Request): QrMemberTokenDto {
    const user = req.user as { user_id: string };
    return this.qrService.generateMemberToken(user.user_id);
  }
}
