import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthorizationResource } from '../common/decorators/authorization-resource.decorator';
import { QrMemberTokenDto } from './dto/qr-token.dto';
import { ScanQrDto, ScanResponseDto } from './dto/scan-qr.dto';
import {
  QrCardResponseDto,
  QrMeResponseDto,
  QrValidationResponseDto,
} from './dto/qr-credential.dto';
import { QrService } from './qr.service';

@ApiTags('qr')
@Controller('qr')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QrController {
  constructor(private readonly qrService: QrService) {}

  private setNoCacheHeaders(res: Response): void {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  @Get('member/token')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Issue a short-lived QR token for the authenticated member',
    description:
      "Returns a HS256 JWT (24 h TTL) embedding the caller's `user_id`. " +
      'The client encodes this string as the QR payload. ' +
      'Scan endpoints validate the signature and enforce audience `sacdia:qr-member`.',
  })
  @ApiResponse({ status: 200, type: QrMemberTokenDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or expired JWT',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  getMemberToken(@Req() req: Request): QrMemberTokenDto {
    const user = req.user as { user_id: string };
    return this.qrService.generateMemberToken(user.user_id);
  }

  @Get('me')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Get the authenticated user QR metadata',
    description:
      'Returns the current token, expiry, resolved authorization and the ' +
      'visual member metadata used by the app card.',
  })
  @ApiResponse({ status: 200, type: QrMeResponseDto })
  async getMe(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QrMeResponseDto> {
    const user = req.user as { user_id: string };
    this.setNoCacheHeaders(res);
    return this.qrService.getMyQr(user.user_id);
  }

  @Get('me/card')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Get the QR card payload for the authenticated user',
    description:
      'Returns the QR token plus the visual fields required by the mobile ' +
      'and web clients to render the virtual card.',
  })
  @ApiResponse({ status: 200, type: QrCardResponseDto })
  async getCard(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QrCardResponseDto> {
    const user = req.user as { user_id: string };
    this.setNoCacheHeaders(res);
    return this.qrService.getMyCard(user.user_id);
  }

  @Get('me/card.pdf')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Generate a PDF version of the authenticated user QR card',
    description:
      'Returns a printable PDF with the virtual card metadata and the token ' +
      'as text fallback. The backend does not render a QR bitmap.',
  })
  @ApiResponse({ status: 200, description: 'PDF document' })
  @Header('Content-Type', 'application/pdf')
  async getCardPdf(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const user = req.user as { user_id: string };
    const buffer = await this.qrService.generateMyCardPdf(user.user_id);

    this.setNoCacheHeaders(res);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="qr-credential.pdf"',
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post('validate')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('qr:validate')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Validate a scanned QR token with the canonical QR contract',
    description:
      'Validates the HS256 token, resolves the member and optionally records ' +
      'attendance when `activity_id` is present.',
  })
  @ApiResponse({ status: 200, type: QrValidationResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid/expired QR or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Caller lacks qr:validate' })
  @ApiResponse({ status: 404, description: 'Member or activity not found' })
  validate(
    @Req() req: Request,
    @Body() dto: ScanQrDto,
  ): Promise<QrValidationResponseDto> {
    const user = req.user as { user_id: string };
    return this.qrService.validateMemberQr(
      dto.token,
      user.user_id,
      dto.activity_id,
    );
  }

  @Post('scan')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('attendance:manage')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: 'Legacy alias for QR validation + attendance capture',
    description:
      'Keeps the historical `/qr/scan` contract alive while internally using ' +
      'the same QR verification path as `/qr/validate`.',
  })
  @ApiResponse({ status: 200, type: ScanResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid/expired QR or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Caller lacks attendance:manage' })
  @ApiResponse({ status: 404, description: 'Member or activity not found' })
  scan(@Req() req: Request, @Body() dto: ScanQrDto): Promise<ScanResponseDto> {
    const user = req.user as { user_id: string };
    return this.qrService.scanMemberToken(
      dto.token,
      user.user_id,
      dto.activity_id,
    );
  }
}
