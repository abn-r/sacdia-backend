import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { GuardianSummaryService } from './guardian-summary.service';

/**
 * No `@ActingScope` on purpose: the guardian reads the summary as themself, so
 * acting for the child (or being the child) is refused by the guard.
 */
@ApiTags('guardianships')
@Controller('guardianships/me/dependents')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class GuardianSummaryController {
  constructor(private readonly summary: GuardianSummaryService) {}

  @Get(':dependentId/summary')
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 60 }))
  @ApiOperation({
    summary: 'Progress and attendance of a minor (verified guardians only)',
    description:
      "Class progress, honor counts and attendance of the current ecclesiastical year. Never health data, evidence, notes, contact data or location. 409 GUARDIANSHIP_CONSENT_NOT_VERIFIED for a pending guardian; 404 GUARDIANSHIP_NOT_FOUND for a stranger, another child's guardian or a person of age. 60 per hour.",
  })
  @ApiResponse({
    status: 200,
    description:
      '{ dependent, classes, honors, attendance, dues: null, generated_at }',
  })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'GUARDIANSHIP_CONSENT_NOT_VERIFIED',
  })
  async getSummary(
    @CurrentUser() user: { sub: string },
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
  ) {
    return {
      status: 'success',
      data: await this.summary.getSummary(user.sub, dependentId),
    };
  }
}
