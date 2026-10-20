import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';
import type { AuthPrincipal } from '../auth/acting-for/auth-principal';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { LinkCodesService } from './link-codes.service';
import { SupervisionStateService } from './supervision-state.service';

const HOUR_MS = 3_600_000;

/**
 * Self-service of a supervised teen (Phase 3a). Every route declares the scope
 * a pending teen holds, so a teen without a verified guardian can still link
 * one; a guardian acting or a device is rejected by scope, and an adult by the
 * service. Ownership is the token's own subject (`/users/me`), hence
 * `@SkipPermissions`.
 */
@ApiTags('guardianships')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class TeenLinkCodesController {
  constructor(
    private readonly linkCodes: LinkCodesService,
    private readonly lifecycle: GuardianshipLifecycleService,
    private readonly supervision: SupervisionStateService,
  ) {}

  @Post('guardian-link-codes')
  @ActingScope('guardian_link:issue')
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 10 }))
  @ApiOperation({
    summary: 'A teen without a guardian issues a link code for an adult (72h)',
    description:
      'The adult redeems it with POST /guardianships/link-codes/redeem and becomes a PENDING guardian: they gain no powers until the director verifies the signed consent form. A new code replaces the open one. The plain code is returned once.',
  })
  @ApiResponse({
    status: 201,
    description: '{ code: "XXXX-XXXX", expires_at }',
  })
  @ApiResponse({
    status: 403,
    description: 'PRINCIPAL_SCOPE_DENIED (not a teen)',
  })
  @ApiResponse({ status: 409, description: 'GUARDIANSHIP_ALREADY_GUARDIAN' })
  @ApiResponse({ status: 429, description: '10 codes per hour' })
  async issue(@CurrentUser() user: AuthPrincipal) {
    return {
      status: 'success',
      data: await this.linkCodes.issueTeenGuardianLink(user.sub),
    };
  }

  @Get('supervision')
  @ActingScope('self:read')
  @ApiOperation({
    summary: 'What the teen sees about their own supervision',
    description:
      'Status, the guardian-less clock, linked guardians (name and relationship only, no contact data), the open link code (expiry only) and the transparency flag. Adults get status null.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ status, pending_since, guardians, open_link_code, summary_visible_to_guardians, days_left }',
  })
  async getSupervision(@CurrentUser() user: AuthPrincipal) {
    if (user.kind !== 'supervised_user' || !user.supervision) {
      return {
        status: 'success',
        data: {
          status: null,
          pending_since: null,
          guardians: [],
          open_link_code: null,
          summary_visible_to_guardians: true,
          days_left: null,
        },
      };
    }
    const [view, openLinkCode] = await Promise.all([
      this.supervision.describe(user.sub, user.supervision),
      this.supervision.openLinkCode(user.sub),
    ]);
    return {
      status: 'success',
      data: { ...view, open_link_code: openLinkCode },
    };
  }

  @Post('guardian-links/:guardianshipId/revoke')
  @ActingScope('guardian_link:issue')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 10 }))
  @ApiOperation({
    summary: 'The teen removes a link that is still pending',
    description:
      'Only a PENDING link of this teen (for example a stranger who found the code). A verified guardian cannot be removed this way: 404. The 90-day guardian-less clock restarts.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ guardianship_id, consent_status: "revoked", dependent_outcome }',
  })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  async revokePendingLink(
    @CurrentUser() user: AuthPrincipal,
    @Param('guardianshipId', ParseUUIDPipe) guardianshipId: string,
  ) {
    return {
      status: 'success',
      data: await this.lifecycle.revokePendingLinkByDependent(
        user.sub,
        guardianshipId,
      ),
    };
  }
}
