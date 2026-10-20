import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SkipPermissions } from '../../common/decorators/skip-permissions.decorator';
import { PairDeviceDto } from '../../guardianships/dto/pair-device.dto';
import { DevicePairingService } from '../../guardianships/device-pairing.service';
import {
  sessionContextFromRequest,
  type SessionContextRequest,
} from '../session-request-context';

/** 5 per minute and 20 per hour per IP (the daily failure cap is in the service). */
const PAIR_THROTTLE = {
  short: { ttl: 60_000, limit: 5 },
  medium: { ttl: 3_600_000, limit: 20 },
  long: { ttl: 3_600_000, limit: 20 },
};

/**
 * Public entry of a child's phone: it redeems the QR token a verified guardian
 * created. Nothing here authenticates a user; the token is the credential. The
 * body is redacted from every log, and every token problem answers the same 400.
 */
@ApiTags('auth')
@Controller('auth/device')
@SkipPermissions()
export class DeviceAuthController {
  constructor(private readonly pairing: DevicePairingService) {}

  @Public()
  @Post('pair')
  @HttpCode(HttpStatus.OK)
  @Throttle(PAIR_THROTTLE)
  @ApiOperation({
    summary: "Link a child's phone with the QR token",
    description:
      'Public. Redeems the single-use token in ONE transaction (re-validating the family, the age and the 2-device cap) and returns the device session. Unknown, expired, consumed, revoked, changed-since or feature-off all answer the same 400 DEVICE_PAIRING_TOKEN_INVALID. 5/min and 20/h per IP; 30 failures a day per IP is 429.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ accessToken (device JWT, 1h), refreshToken, expiresAt, tokenType, device { linked_device_id, label }, user { id, name, avatar } }',
  })
  @ApiResponse({ status: 400, description: 'DEVICE_PAIRING_TOKEN_INVALID' })
  @ApiResponse({
    status: 409,
    description: 'DEVICE_LIMIT_REACHED {max_devices}',
  })
  @ApiResponse({ status: 429, description: 'Throttled or AUTH_LOGIN_LOCKED' })
  async pair(@Body() dto: PairDeviceDto, @Req() req: SessionContextRequest) {
    return {
      status: 'success',
      data: await this.pairing.pair(dto, sessionContextFromRequest(req)),
    };
  }
}
