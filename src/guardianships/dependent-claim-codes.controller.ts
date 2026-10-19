import {
  Controller,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { LinkCodesService } from './link-codes.service';

/**
 * A club director hands a custodial minor back to a family. Same permission as
 * approving members, scoped to the section; the service checks that the minor
 * really belongs to that section and has no guardian.
 */
@ApiTags('guardianships')
@Controller('club-sections/:clubSectionId/dependents/:userId/claim-codes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DependentClaimCodesController {
  constructor(private readonly linkCodes: LinkCodesService) {}

  @Post()
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_section', idParam: 'clubSectionId' })
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 10 }))
  @ApiOperation({
    summary: 'Issue a claim code for a custodial dependent (7 days)',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 201, description: '{ code, expires_at }' })
  @ApiResponse({ status: 403, description: 'Missing club_members:approve' })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'GUARDIANSHIP_ALREADY_GUARDIAN' })
  async issue(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('userId', ParseUUIDPipe) dependentId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return {
      status: 'success',
      data: await this.linkCodes.issueDirectorClaimCode(
        user.sub,
        clubSectionId,
        dependentId,
      ),
    };
  }
}
