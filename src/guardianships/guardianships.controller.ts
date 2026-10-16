import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  sessionContextFromRequest,
  type SessionContextRequest,
} from '../auth/session-request-context';
import { namedThrottle } from '../config/throttler.helpers';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import {
  CreateDependentDto,
  IssueLinkCodeDto,
  RedeemLinkCodeDto,
  RevokeGuardianshipDto,
} from './dto';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { GuardianshipsService } from './guardianships.service';
import { LinkCodesService } from './link-codes.service';

type CurrentUserPayload = { sub: string };

const HOUR_MS = 3_600_000;

/** 5 redeems per 15 minutes and 20 per day, per user. */
const REDEEM_THROTTLE = {
  short: { ttl: 15 * 60_000, limit: 5 },
  medium: { ttl: 15 * 60_000, limit: 5 },
  long: { ttl: 24 * HOUR_MS, limit: 20 },
};

/**
 * Guardian-facing endpoints. None declares an `@ActingScope`, so every route
 * here is denied while acting (a guardian manages family from their OWN
 * profile; the app also sends these requests without `X-Acting-For`).
 * Ownership is enforced inside the services, hence `@SkipPermissions`.
 */
@ApiTags('guardianships')
@Controller('guardianships')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class GuardianshipsController {
  constructor(
    private readonly guardianships: GuardianshipsService,
    private readonly linkCodes: LinkCodesService,
    private readonly lifecycle: GuardianshipLifecycleService,
  ) {}

  @Get('me/dependents')
  @ApiOperation({ summary: 'List the dependents of the current guardian' })
  @ApiResponse({ status: 200, description: '{ dependents, limits }' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return {
      status: 'success',
      data: await this.guardianships.listForGuardian(user.sub),
    };
  }

  @Post('me/dependents')
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 10 }))
  @ApiOperation({
    summary: 'Register a minor without an account (step 0)',
    description:
      'Creates the minor, the primary pending guardianship and the legal acceptance on behalf of the minor in one transaction.',
  })
  @ApiResponse({ status: 201, description: 'DependentSummary' })
  @ApiResponse({
    status: 422,
    description:
      'GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE, GUARDIANSHIP_GUARDIAN_NOT_ADULT or GUARDIANSHIP_GUARDIAN_BIRTHDAY_REQUIRED',
  })
  @ApiResponse({
    status: 409,
    description: 'GUARDIANSHIP_DEPENDENT_LIMIT_REACHED',
  })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateDependentDto,
    @Req() req: SessionContextRequest,
  ) {
    return {
      status: 'success',
      data: await this.guardianships.createDependent(
        user.sub,
        dto,
        sessionContextFromRequest(req),
      ),
    };
  }

  @Get('me/dependents/:dependentId')
  @ApiOperation({ summary: 'Detail of one dependent with its guardians' })
  @ApiResponse({ status: 200, description: 'DependentDetail' })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
  ) {
    return {
      status: 'success',
      data: await this.guardianships.getDetailForGuardian(
        user.sub,
        dependentId,
      ),
    };
  }

  @Post('me/dependents/:dependentId/link-codes')
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 10 }))
  @ApiOperation({
    summary: 'Issue a code to invite a second guardian (72h)',
  })
  @ApiResponse({ status: 201, description: '{ code, expires_at }' })
  @ApiResponse({
    status: 409,
    description: 'GUARDIANSHIP_GUARDIAN_LIMIT_REACHED',
  })
  async issueLinkCode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @Body() _dto: IssueLinkCodeDto,
  ) {
    return {
      status: 'success',
      data: await this.linkCodes.issueSecondGuardianCode(user.sub, dependentId),
    };
  }

  @Post('link-codes/redeem')
  @Throttle(REDEEM_THROTTLE)
  @ApiOperation({
    summary: 'Redeem a link code and become a guardian of the minor',
  })
  @ApiResponse({ status: 201, description: 'DependentSummary' })
  @ApiResponse({ status: 400, description: 'GUARDIANSHIP_LINK_CODE_INVALID' })
  @ApiResponse({ status: 409, description: 'GUARDIANSHIP_ALREADY_GUARDIAN' })
  @ApiResponse({ status: 429, description: 'GUARDIANSHIP_LINK_CODE_LOCKED' })
  async redeem(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RedeemLinkCodeDto,
  ) {
    return {
      status: 'success',
      data: await this.linkCodes.redeem(user.sub, dto),
    };
  }

  @Get('me/deletion-impact')
  @ApiOperation({
    summary: 'What happens to each dependent if this account is deleted',
  })
  @ApiResponse({ status: 200, description: '{ dependents: [...] }' })
  async deletionImpact(@CurrentUser() user: CurrentUserPayload) {
    return {
      status: 'success',
      data: await this.lifecycle.deletionImpact(user.sub),
    };
  }

  @Post(':guardianshipId/revoke')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Leave a guardianship, or remove a secondary guardian (primary)',
  })
  @ApiResponse({
    status: 200,
    description: '{ guardianship_id, consent_status, dependent_outcome }',
  })
  @ApiResponse({ status: 403, description: 'GUARDIANSHIP_REVOKE_FORBIDDEN' })
  async revoke(
    @CurrentUser() user: CurrentUserPayload,
    @Param('guardianshipId', ParseUUIDPipe) guardianshipId: string,
    @Body() dto: RevokeGuardianshipDto,
  ) {
    return {
      status: 'success',
      data: await this.lifecycle.revoke(user.sub, guardianshipId, dto.reason),
    };
  }
}
