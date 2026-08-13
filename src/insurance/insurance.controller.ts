import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  FileValidationPipe,
  ALLOWED_MIME_TYPES,
} from '../common/pipes/file-validation.pipe';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  CurrentUser,
  GlobalRoles,
  RequirePermissions,
} from '../common/decorators';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { CreateInsuranceDto } from './dto/create-insurance.dto';
import { UpdateInsuranceDto } from './dto/update-insurance.dto';
import { InsuranceService } from './insurance.service';
import {
  CreateInsuranceCycleDto,
  CreateInsuranceProductDto,
  UpdateInsuranceCycleDto,
  UpdateInsuranceProductDto,
} from './dto/insurance-config.dto';
import { InsuranceConfigService } from './insurance-config.service';
import { InsuranceConfigScopeResolver } from './insurance-config-scope';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

type CurrentUserPayload = {
  sub?: string;
  user_id?: string;
  userId?: string;
};

@ApiTags('insurance')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class InsuranceController {
  constructor(
    private readonly service: InsuranceService,
    private readonly configService: InsuranceConfigService,
    private readonly configScope: InsuranceConfigScopeResolver,
  ) {}

  @Get('insurance/products')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Listar productos de seguro del Campo Local activo',
  })
  @ApiResponse({
    status: 200,
    description: 'Productos configurables del Campo Local',
  })
  async listInsuranceProducts(
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.listProducts(
        this.resolveConfigActor(request),
      ),
    };
  }

  @Post('insurance/products')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Crear producto de seguro para el Campo Local activo',
  })
  @ApiResponse({ status: 201, description: 'Producto de seguro creado' })
  async createInsuranceProduct(
    @Body() dto: CreateInsuranceProductDto,
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.createProduct(
        dto,
        this.resolveConfigActor(request),
      ),
    };
  }

  @Patch('insurance/products/:productId')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Actualizar producto de seguro del Campo Local activo',
  })
  @ApiParam({ name: 'productId', type: Number })
  @ApiResponse({ status: 200, description: 'Producto de seguro actualizado' })
  async updateInsuranceProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateInsuranceProductDto,
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.updateProduct(
        productId,
        dto,
        this.resolveConfigActor(request),
      ),
    };
  }

  @Get('insurance/cycles')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Listar ciclos de seguro del Campo Local activo' })
  @ApiResponse({ status: 200, description: 'Ciclos de seguro del Campo Local' })
  async listInsuranceCycles(
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.listCycles(
        this.resolveConfigActor(request),
      ),
    };
  }

  @Post('insurance/cycles')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Crear ciclo de seguro para el Campo Local activo' })
  @ApiResponse({ status: 201, description: 'Ciclo de seguro creado' })
  async createInsuranceCycle(
    @Body() dto: CreateInsuranceCycleDto,
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.createCycle(
        dto,
        this.resolveConfigActor(request),
      ),
    };
  }

  @Patch('insurance/cycles/:cycleConfigId')
  @RequirePermissions('insurance:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Actualizar ciclo de seguro del Campo Local activo',
  })
  @ApiParam({ name: 'cycleConfigId', type: Number })
  @ApiResponse({ status: 200, description: 'Ciclo de seguro actualizado' })
  async updateInsuranceCycle(
    @Param('cycleConfigId', ParseIntPipe) cycleConfigId: number,
    @Body() dto: UpdateInsuranceCycleDto,
    @Req()
    request: {
      authorizationProfile?: ResolvedAuthorizationProfile;
      user?: CurrentUserPayload;
    },
  ) {
    return {
      status: 'success',
      data: await this.configService.updateCycle(
        cycleConfigId,
        dto,
        this.resolveConfigActor(request),
      ),
    };
  }

  @Get('clubs/:clubId/sections/:sectionId/members/insurance')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'sectionId',
    clubIdParam: 'clubId',
  })
  @ApiOperation({ summary: 'Listar seguros de miembros por sección' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de seguros por miembro' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires insurance:read',
  })
  async listMembersInsurance(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    const data = await this.service.listMembersInsurance(clubId, sectionId);
    return { status: 'success', data };
  }

  @Get('insurance/expiring')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'Listar seguros próximos a vencer',
    description:
      'Devuelve seguros activos cuyo end_date cae dentro de los próximos `days_ahead` días. ' +
      'Requiere rol global admin o coordinator. Los coordinadores ignoran `local_field_id` y solo ven miembros de sus secciones asignadas.',
  })
  @ApiQuery({
    name: 'days_ahead',
    required: false,
    type: Number,
    description: 'Días hacia adelante para buscar vencimientos (default: 30)',
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description: 'Filtrar por campo local del usuario',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de seguros próximos a vencer, ordenados por end_date ASC',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere rol admin o coordinator',
  })
  async getExpiringInsurances(
    @CurrentUser() user: CurrentUserPayload,
    @Query('days_ahead') daysAhead?: string,
    @Query('local_field_id') localFieldId?: string,
  ) {
    const actorUserId = this.extractCurrentUserId(user);
    if (!actorUserId) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    const daysAheadNum = daysAhead !== undefined ? parseInt(daysAhead, 10) : 30;
    const localFieldIdNum =
      localFieldId !== undefined ? parseInt(localFieldId, 10) : undefined;
    const data = await this.service.getExpiringInsurances(
      actorUserId,
      isNaN(daysAheadNum) ? 30 : daysAheadNum,
      localFieldIdNum !== undefined && isNaN(localFieldIdNum)
        ? undefined
        : localFieldIdNum,
    );
    return { status: 'success', data };
  }

  @Get('users/:memberId/insurance')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'insurance_member', idParam: 'memberId' })
  @ApiOperation({ summary: 'Obtener seguro activo del miembro' })
  @ApiParam({ name: 'memberId', type: String })
  @ApiResponse({ status: 200, description: 'Seguro del miembro' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires insurance:read',
  })
  @ApiResponse({
    status: 404,
    description: 'Seguro no encontrado para el miembro',
  })
  async getMemberInsurance(@Param('memberId', ParseUUIDPipe) memberId: string) {
    const data = await this.service.getMemberInsurance(memberId);
    return { status: 'success', data };
  }

  @Post('users/:memberId/insurance')
  @RequirePermissions('insurance:create')
  @AuthorizationResource({ type: 'insurance_member', idParam: 'memberId' })
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Crear seguro para un miembro' })
  @ApiParam({ name: 'memberId', type: String })
  @ApiResponse({ status: 201, description: 'Seguro creado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires insurance:create',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        insurance_type: { type: 'string' },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        policy_number: { type: 'string' },
        provider: { type: 'string' },
        coverage_amount: { type: 'number' },
        evidence: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Seguro creado' })
  async createInsurance(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: CreateInsuranceDto,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
      }),
    )
    file?: Express.Multer.File,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const currentUserId = this.extractCurrentUserId(user);
    const data = await this.service.createInsurance(
      memberId,
      dto,
      file,
      currentUserId,
    );
    return { status: 'success', data };
  }

  @Patch('insurance/:insuranceId')
  @RequirePermissions('insurance:update')
  @AuthorizationResource({ type: 'insurance_record', idParam: 'insuranceId' })
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Actualizar seguro' })
  @ApiParam({ name: 'insuranceId', type: Number })
  @ApiResponse({ status: 200, description: 'Seguro actualizado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires insurance:update',
  })
  @ApiResponse({ status: 404, description: 'Registro de seguro no encontrado' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        insurance_type: { type: 'string' },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        policy_number: { type: 'string' },
        provider: { type: 'string' },
        coverage_amount: { type: 'number' },
        evidence: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Seguro actualizado' })
  async updateInsurance(
    @Param('insuranceId', ParseIntPipe) insuranceId: number,
    @Body() dto: UpdateInsuranceDto,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
      }),
    )
    file?: Express.Multer.File,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const currentUserId = this.extractCurrentUserId(user);
    const data = await this.service.updateInsurance(
      insuranceId,
      dto,
      file,
      currentUserId,
    );
    return { status: 'success', data };
  }

  private extractCurrentUserId(user?: {
    sub?: string;
    user_id?: string;
    userId?: string;
  }): string | undefined {
    return user?.sub ?? user?.user_id ?? user?.userId;
  }

  private resolveConfigActor(request: {
    authorizationProfile?: ResolvedAuthorizationProfile;
    user?: CurrentUserPayload;
  }) {
    const profile = request.authorizationProfile;
    const userId = this.extractCurrentUserId(request.user);
    if (!profile || !userId) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    return { userId, ...this.configScope.resolve(profile) };
  }
}
