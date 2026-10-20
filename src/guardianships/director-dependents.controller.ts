import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
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
  sessionContextFromRequest,
  type SessionContextRequest,
} from '../auth/session-request-context';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { CreateDirectorDependentDto } from './dto';
import { DirectorDependentsService } from './director-dependents.service';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';

const HOUR_MS = 3_600_000;

/**
 * A club director registers a minor from a club section (Phase 3c, FP3-61).
 *
 * NO `@ActingScope` on purpose: a guardian acting for a child, a supervised teen
 * and a linked device are all denied by default (the acting-scope metadata
 * snapshot and the teen route walk keep it that way). Only a normal user with
 * `dependents:create` in THIS section reaches the handler; behind the flag
 * `FAMILY_DIRECTOR_CREATE_MINOR_ENABLED` (404 when off).
 */
@ApiTags('guardianships')
@Controller('club-sections/:clubSectionId/dependents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DirectorDependentsController {
  constructor(
    private readonly directorDependents: DirectorDependentsService,
    private readonly flags: FamilyFeatureFlagsService,
  ) {}

  @Post()
  @RequirePermissions('dependents:create')
  @AuthorizationResource({ type: 'club_section', idParam: 'clubSectionId' })
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 30 }))
  @ApiOperation({
    summary: 'Register a minor under club custody (director)',
    description:
      'Creates, in ONE transaction, a minor without an account or email (users, users_pr, role user, dependent profile), the club-custody guardianship (consent pending), a PENDING membership request for the active ecclesiastical year in this section and the Terms/Privacy acceptances on behalf of the minor (accepted_by = the director). The age must be 0 <= age < age of majority of the section country. The minor is NOT a member until somebody other than the creator verifies the signed paper form (verify-consent) and the request is approved. Unknown keys (email, access_mode, account) are rejected. 30 per hour per director.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiResponse({
    status: 201,
    description:
      '{ dependent: { user_id, name, birthday, age }, guardianship: { guardianship_id, is_custodian, consent_status: "pending" }, assignment: { assignment_id, status: "pending", club_section_id } }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation (sworn_declaration must be true, unknown keys) or LEGAL_VERSION_MISMATCH',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing dependents:create in this section',
  })
  @ApiResponse({ status: 404, description: 'FAMILY_FEATURE_DISABLED' })
  @ApiResponse({
    status: 422,
    description: 'GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE',
  })
  @ApiResponse({
    status: 500,
    description: 'POST_REG_NO_ACTIVE_YEAR (nothing is created)',
  })
  @ApiResponse({ status: 429, description: '30 per hour per director' })
  async create(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Body() dto: CreateDirectorDependentDto,
    @CurrentUser() user: { sub: string },
    @Req() req: SessionContextRequest,
  ) {
    this.flags.assertEnabled('director_create_minor');
    return {
      status: 'success',
      data: await this.directorDependents.create(
        user.sub,
        clubSectionId,
        dto,
        sessionContextFromRequest(req),
      ),
    };
  }
}
