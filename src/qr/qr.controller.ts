import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { QrMemberTokenDto } from './dto/qr-token.dto';
import { ScanQrDto, ScanResponseDto } from './dto/scan-qr.dto';
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

  @Post('scan')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('attendance:manage')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Validate a scanned member QR and optionally register attendance',
    description:
      'Decodes and verifies the HS256 token, rejects if signature/audience/' +
      'version/expiry fail. Returns the scanned member\'s identity. ' +
      'When `activity_id` is provided, appends the member to the activity\'s ' +
      '`attendees` (idempotent) and fires the `activity.attended` achievement ' +
      'event. Requires `attendance:manage`.',
  })
  @ApiResponse({ status: 200, type: ScanResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid/expired QR or missing JWT' })
  @ApiResponse({ status: 403, description: 'Caller lacks attendance:manage' })
  @ApiResponse({ status: 404, description: 'Member or activity not found' })
  scan(@Body() dto: ScanQrDto): Promise<ScanResponseDto> {
    return this.qrService.scanMemberToken(dto.token, dto.activity_id);
  }
}
