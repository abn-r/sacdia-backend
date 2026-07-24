import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InsuranceEvidenceService } from './insurance-evidence.service';
import {
  InsurancePurchasesService,
  type InsurancePurchaseActor,
} from './insurance-purchases.service';
import {
  RejectInsurancePurchaseDto,
  SubmitInsurancePurchaseDto,
} from './dto/insurance-purchases.dto';

type UserPayload = { sub?: string; user_id?: string; userId?: string };
type RequestWithProfile = {
  user?: UserPayload;
  authorizationProfile?: ResolvedAuthorizationProfile;
};

@ApiTags('insurance purchases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class InsurancePurchasesController {
  constructor(
    private readonly purchases: InsurancePurchasesService,
    private readonly evidence: InsuranceEvidenceService,
  ) {}

  @Post('club-sections/:sectionId/insurance/purchases')
  @RequirePermissions('insurance:create')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @UseInterceptors(FileInterceptor('purchase_proof'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Submit a section insurance purchase with private proof',
  })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'insurance_cycle_config_id',
        'quantity',
        'total_amount',
        'receipt_date',
        'external_reference',
        'purchase_proof',
      ],
      properties: {
        insurance_cycle_config_id: { type: 'integer' },
        quantity: { type: 'integer', minimum: 1 },
        total_amount: { type: 'number', minimum: 0.01 },
        receipt_date: { type: 'string', format: 'date' },
        external_reference: { type: 'string' },
        purchase_proof: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Purchase is pending Local Field review',
  })
  async submit(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: SubmitInsurancePurchaseDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.submit(
        sectionId,
        dto,
        file,
        this.resolveActor(request, sectionId),
      ),
    };
  }

  @Get('club-sections/:sectionId/insurance/purchases')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  async list(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.listForSection(
        sectionId,
        this.resolveActor(request, sectionId),
      ),
    };
  }

  @Get('insurance/purchases/:purchaseId')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'active_assignment' })
  async get(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.getById(
        purchaseId,
        this.resolveActor(request),
      ),
    };
  }

  @Get('insurance/purchases/:purchaseId/proof')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Mint a short-lived URL for authorized private purchase proof access',
  })
  async getProof(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Req() request: RequestWithProfile,
  ) {
    const actor = this.resolveActor(request);
    await this.purchases.getById(purchaseId, actor);
    return {
      status: 'success',
      data: {
        signed_url: await this.evidence.getPurchaseProofUrl(purchaseId, {
          ...actor,
          // The owning section/territory was authorized immediately above.
          globalAccess: true,
        }),
      },
    };
  }

  @Post('insurance/purchases/:purchaseId/confirm')
  @RequirePermissions('insurance:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Confirm a purchase and atomically materialize its slots',
  })
  async confirm(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.confirm(
        purchaseId,
        this.resolveActor(request, undefined, true),
      ),
    };
  }

  @Post('insurance/purchases/:purchaseId/reject')
  @RequirePermissions('insurance:review')
  @AuthorizationResource({ type: 'global' })
  async reject(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Body() dto: RejectInsurancePurchaseDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.reject(
        purchaseId,
        dto,
        this.resolveActor(request, undefined, true),
      ),
    };
  }

  @Post('insurance/purchases/:purchaseId/reverse')
  @RequirePermissions('insurance:review')
  @AuthorizationResource({ type: 'global' })
  async reverse(
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.purchases.reverse(
        purchaseId,
        this.resolveActor(request, undefined, true),
      ),
    };
  }

  private resolveActor(
    request: RequestWithProfile,
    sectionId?: number,
    review = false,
  ): InsurancePurchaseActor {
    const userId =
      request.user?.sub ?? request.user?.user_id ?? request.user?.userId;
    const profile = request.authorizationProfile;
    if (!userId || !profile)
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    const roles = new Set(
      profile.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
    const activeSectionGrants =
      profile.authorization.grants.club_assignments.filter(
        (grant) => grant.status === 'active',
      );
    const sectionIds = activeSectionGrants.map(
      (grant) => grant.section.club_section_id,
    );
    const sectionGrant =
      sectionId === undefined
        ? undefined
        : activeSectionGrants.find(
            (grant) => grant.section.club_section_id === sectionId,
          );
    const localFieldId =
      profile.authorization.effective.scope.global.local_field?.id ??
      sectionGrant?.scope.local_field?.id;
    const globalAccess =
      (roles.has('admin') || roles.has('super-admin')) &&
      typeof localFieldId !== 'number';
    const canReview =
      review &&
      (roles.has('director-lf') ||
        roles.has('assistant-lf') ||
        roles.has('admin') ||
        roles.has('super-admin')) &&
      (globalAccess || typeof localFieldId === 'number');
    return {
      userId,
      localFieldId: typeof localFieldId === 'number' ? localFieldId : undefined,
      sectionIds,
      globalAccess,
      canReview,
    };
  }
}
