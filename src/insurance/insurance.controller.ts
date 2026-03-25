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
import { CurrentUser, GlobalRoles, RequirePermissions } from '../common/decorators';
import { GlobalRolesGuard, JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CreateInsuranceDto } from './dto/create-insurance.dto';
import { UpdateInsuranceDto } from './dto/update-insurance.dto';
import { InsuranceService } from './insurance.service';

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
  constructor(private readonly service: InsuranceService) {}

  @Get('clubs/:clubId/sections/:sectionId/members/insurance')
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: 'Listar seguros de miembros por sección' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de seguros por miembro' })
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
      'Requiere rol global admin o coordinator.',
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
    description: 'Lista de seguros próximos a vencer, ordenados por end_date ASC',
  })
  @ApiResponse({ status: 403, description: 'Forbidden — requiere rol admin o coordinator' })
  async getExpiringInsurances(
    @Query('days_ahead') daysAhead?: string,
    @Query('local_field_id') localFieldId?: string,
  ) {
    const daysAheadNum = daysAhead !== undefined ? parseInt(daysAhead, 10) : 30;
    const localFieldIdNum =
      localFieldId !== undefined ? parseInt(localFieldId, 10) : undefined;
    const data = await this.service.getExpiringInsurances(
      isNaN(daysAheadNum) ? 30 : daysAheadNum,
      localFieldIdNum !== undefined && isNaN(localFieldIdNum)
        ? undefined
        : localFieldIdNum,
    );
    return { status: 'success', data };
  }

  @Get('users/:memberId/insurance')
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: 'Obtener seguro activo del miembro' })
  @ApiParam({ name: 'memberId', type: String })
  @ApiResponse({ status: 200, description: 'Seguro del miembro' })
  async getMemberInsurance(@Param('memberId', ParseUUIDPipe) memberId: string) {
    const data = await this.service.getMemberInsurance(memberId);
    return { status: 'success', data };
  }

  @Post('users/:memberId/insurance')
  @RequirePermissions('insurance:create')
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Crear seguro para un miembro' })
  @ApiParam({ name: 'memberId', type: String })
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
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Actualizar seguro' })
  @ApiParam({ name: 'insuranceId', type: Number })
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
}
