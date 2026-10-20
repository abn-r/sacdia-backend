import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import 'multer';
import {
  sessionContextFromRequest,
  type SessionContextRequest,
} from '../auth/session-request-context';
import { namedThrottle } from '../config/throttler.helpers';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import { CurrentUser } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { ConsentEvidenceFilePipe } from './consent-evidence-file.pipe';
import {
  CreateDependentDto,
  DisableSupervisedLoginDto,
  EnableSupervisedLoginDto,
  IssueLinkCodeDto,
  ReactivateSupervisedLoginDto,
  RedeemLinkCodeDto,
  RevokeGuardianshipDto,
  SetSupervisedPasswordDto,
} from './dto';
import { GuardianEvidenceService } from './guardian-evidence.service';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { GuardianshipsService } from './guardianships.service';
import { LinkCodesService } from './link-codes.service';
import { SupervisedLoginsService } from './supervised-logins.service';

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
    private readonly evidence: GuardianEvidenceService,
    private readonly supervisedLogins: SupervisedLoginsService,
  ) {}

  @Get('relationship-types')
  @ApiOperation({
    summary: 'Relationships a guardian may declare to a minor',
    description:
      'Active relationship_types a guardian can pick as "yo soy su..." when creating a dependent, redeeming a link code or joining as second guardian, in display order (Padre, Madre, Tutor Legal, Abuelo, Abuela, Tío, Tía, Hermano/a Mayor, Otro). Items have the same shape as GET /catalogs/relationship-types. Any other relationship_type_id is rejected with GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ status: "success", data: [{ relationship_type_id, name, description }] }',
  })
  async listRelationshipTypes() {
    return {
      status: 'success',
      data: await this.guardianships.listGuardianRelationshipTypes(),
    };
  }

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
    status: 400,
    description:
      'GUARDIANSHIP_RELATIONSHIP_TYPE_INVALID (unknown or inactive id) or GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED (not in the guardian allowlist)',
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

  @Post('me/dependents/:dependentId/consent-evidence')
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 20 }))
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload the signed consent form of a dependent (photo or PDF)',
    description:
      'JPEG, PNG, WebP or PDF up to 10 MB, multipart field `file`. HEIC is rejected: convert to JPEG first. The form only waits for the director; it never verifies the consent. A new upload supersedes the previous one while the consent is pending; once verified it is a 409.',
  })
  @ApiResponse({
    status: 201,
    description: '{ evidence_id, content_type, size_bytes, uploaded_at }',
  })
  @ApiResponse({ status: 404, description: 'GUARDIANSHIP_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'GUARDIANSHIP_CONSENT_ALREADY_VERIFIED: the consent is verified, the verified form cannot be replaced',
  })
  @ApiResponse({
    status: 503,
    description:
      'GUARDIANSHIP_EVIDENCE_UNAVAILABLE: the private bucket is not configured',
  })
  async uploadConsentEvidence(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @UploadedFile(new ConsentEvidenceFilePipe()) file: Express.Multer.File,
  ) {
    return {
      status: 'success',
      data: await this.evidence.uploadForGuardian(user.sub, dependentId, file),
    };
  }

  @Get('me/dependents/:dependentId/consent-evidence')
  @ApiOperation({
    summary: 'Signed URL (15 min) of the current signed consent form',
  })
  @ApiResponse({
    status: 200,
    description: '{ url, expires_in, content_type, uploaded_at }',
  })
  @ApiResponse({
    status: 404,
    description: 'GUARDIANSHIP_NOT_FOUND or GUARDIANSHIP_EVIDENCE_NOT_FOUND',
  })
  @ApiResponse({
    status: 503,
    description: 'GUARDIANSHIP_EVIDENCE_UNAVAILABLE',
  })
  async getConsentEvidence(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
  ) {
    return {
      status: 'success',
      data: await this.evidence.getForGuardian(user.sub, dependentId),
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
  @ApiResponse({
    status: 400,
    description:
      'GUARDIANSHIP_LINK_CODE_INVALID, GUARDIANSHIP_RELATIONSHIP_TYPE_INVALID or GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED',
  })
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

  // ---------------------------------------------------------------------------
  // Supervised login (Phase 3a, FAMILY_TEEN_LOGIN_ENABLED)
  // ---------------------------------------------------------------------------

  @Get('me/dependents/:dependentId/supervised-login')
  @ApiOperation({
    summary: "Eligibility and state of the minor's own login",
    description:
      'Verified guardians see the login (with the generated handle). A guardian whose link is still pending gets `eligible: false` / `consent_not_verified` and nothing else. 404 FAMILY_FEATURE_DISABLED while the flag is off.',
  })
  @ApiResponse({
    status: 200,
    description: '{ eligible, ineligible_reason, supervised_login }',
  })
  @ApiResponse({
    status: 404,
    description: 'GUARDIANSHIP_NOT_FOUND or FAMILY_FEATURE_DISABLED',
  })
  async getSupervisedLogin(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
  ) {
    return {
      status: 'success',
      data: await this.supervisedLogins.get(user.sub, dependentId),
    };
  }

  @Post('me/dependents/:dependentId/supervised-login')
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 5 }))
  @ApiOperation({
    summary: 'Give a 13-17 year old their own login (handle or email)',
    description:
      'Verified guardian, as self. Creates the credential with the guardian-chosen password, the server-generated handle (method `handle`), revokes any linked device and ends acting for the child. The password is never returned or logged.',
  })
  @ApiResponse({
    status: 201,
    description: '{ supervised_login, devices_revoked }',
  })
  @ApiResponse({
    status: 403,
    description:
      'GUARDIANSHIP_CONSENT_NOT_VERIFIED (pending link) or ACTING_FOR_SCOPE_DENIED (acting)',
  })
  @ApiResponse({
    status: 404,
    description: 'GUARDIANSHIP_NOT_FOUND or FAMILY_FEATURE_DISABLED',
  })
  @ApiResponse({
    status: 409,
    description:
      'SUPERVISED_LOGIN_ALREADY_ENABLED or SUPERVISED_LOGIN_EMAIL_UNAVAILABLE',
  })
  @ApiResponse({
    status: 422,
    description:
      'SUPERVISED_LOGIN_NOT_ELIGIBLE (age) or SUPERVISED_LOGIN_PASSWORD_INVALID',
  })
  async enableSupervisedLogin(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @Body() dto: EnableSupervisedLoginDto,
  ) {
    return {
      status: 'success',
      data: await this.supervisedLogins.enable(user.sub, dependentId, dto),
    };
  }

  @Post('me/dependents/:dependentId/supervised-login/disable')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 20 }))
  @ApiOperation({
    summary: "Disable the minor's own login (reversible while a minor)",
    description:
      'All sessions are deleted and the next request of the child is a 401. Acting for the child resumes when the login was guardian-enabled.',
  })
  @ApiResponse({ status: 200, description: '{ supervised_login }' })
  @ApiResponse({
    status: 404,
    description: 'SUPERVISED_LOGIN_NOT_FOUND or GUARDIANSHIP_NOT_FOUND',
  })
  async disableSupervisedLogin(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @Body() dto: DisableSupervisedLoginDto,
  ) {
    return {
      status: 'success',
      data: await this.supervisedLogins.disable(user.sub, dependentId, dto),
    };
  }

  @Post('me/dependents/:dependentId/supervised-login/reactivate')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 20 }))
  @ApiOperation({
    summary: 'Re-enable a disabled login',
    description:
      'A handle login needs a NEW password (the old one is replaced). Sessions are not restored.',
  })
  @ApiResponse({ status: 200, description: '{ supervised_login }' })
  @ApiResponse({ status: 409, description: 'SUPERVISED_LOGIN_ALREADY_ENABLED' })
  @ApiResponse({
    status: 422,
    description: 'SUPERVISED_LOGIN_PASSWORD_INVALID',
  })
  async reactivateSupervisedLogin(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @Body() dto: ReactivateSupervisedLoginDto,
  ) {
    return {
      status: 'success',
      data: await this.supervisedLogins.reactivate(user.sub, dependentId, dto),
    };
  }

  @Post('me/dependents/:dependentId/supervised-login/password')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: HOUR_MS, limit: 20 }))
  @ApiOperation({
    summary: "Reset the minor's password",
    description:
      'Handle login: the guardian sets a new password. Email login: sessions are cut and the standard reset email goes to the child. 5 per hour per dependent (429).',
  })
  @ApiResponse({
    status: 200,
    description: '{ sessions_revoked, method, email_sent }',
  })
  @ApiResponse({
    status: 422,
    description: 'SUPERVISED_LOGIN_PASSWORD_INVALID',
  })
  @ApiResponse({ status: 429, description: '5 resets per hour per dependent' })
  async resetSupervisedPassword(
    @CurrentUser() user: CurrentUserPayload,
    @Param('dependentId', ParseUUIDPipe) dependentId: string,
    @Body() dto: SetSupervisedPasswordDto,
  ) {
    return {
      status: 'success',
      data: await this.supervisedLogins.resetPassword(
        user.sub,
        dependentId,
        dto,
      ),
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
