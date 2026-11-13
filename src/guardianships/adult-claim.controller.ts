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
import { Public } from '../common/decorators';
import { resolveClientIp, type ClientIpRequest } from '../config/client-ip';
import { namedThrottle } from '../config/throttler.helpers';
import { AdultClaimService } from './adult-claim.service';
import { RedeemAdultClaimDto } from './dto';

/**
 * Public: the person has no account yet. Throttled per IP (10/hour) on top of
 * the IP failure counter (10 wrong codes in 24h => 429 even for a valid code).
 */
@ApiTags('guardianships')
@Controller('auth/adult-claim')
export class AdultClaimController {
  constructor(private readonly claims: AdultClaimService) {}

  @Public()
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 10 }))
  @ApiOperation({
    summary:
      'A released adult without an account claims it with an access code',
    description:
      'Creates the credential and stores the email in one transaction. No tokens are returned: the person logs in normally and accepts the terms on the release screen.',
  })
  @ApiResponse({ status: 200, description: '{ status: "success" }' })
  @ApiResponse({
    status: 400,
    description:
      'GUARDIANSHIP_LINK_CODE_INVALID (uniform) or a validation error (weak password, bad email)',
  })
  @ApiResponse({ status: 404, description: 'FAMILY_ADULT_CLAIM_NOT_RELEASED' })
  @ApiResponse({
    status: 409,
    description: 'FAMILY_ADULT_CLAIM_EMAIL_UNAVAILABLE',
  })
  @ApiResponse({
    status: 429,
    description: 'GUARDIANSHIP_LINK_CODE_LOCKED or throttled',
  })
  async redeem(@Body() dto: RedeemAdultClaimDto, @Req() req: ClientIpRequest) {
    return this.claims.redeem(dto, resolveClientIp(req));
  }
}
