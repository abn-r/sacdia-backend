import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AnnualMembershipService } from './annual-membership.service';
import { AnnualContinuationBodyDto } from './dto/annual-continuation.dto';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { PaginationDto } from '../common/dto/pagination.dto';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('annual-membership')
@Controller('club-sections/:sectionId/annual-continuations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AnnualContinuationsController {
  constructor(
    private readonly annualMembershipService: AnnualMembershipService,
  ) {}

  @Get()
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @ApiOperation({
    summary: 'Listar miembros no inscritos del año vigente',
    description:
      'Miembros no inscritos cuya pertenencia corresponde a esta sección. ' +
      'Fuente: año eclesiástico vigente (no lista exclusiva del año anterior). ' +
      'suggested_class puede quedar pending hasta la política de clase.',
  })
  @ApiParam({ name: 'sectionId', type: Number, description: 'ID de la sección destino' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Búsqueda acotada por nombre',
  })
  @ApiResponse({
    status: 200,
    description:
      'Página de { user_id, name, base_section_id, ecclesiastical_year_id, annual_status, current_role, eligibility, blocked_reason, suggested_class }',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires club_members:approve for this section',
  })
  async listContinuations(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
  ) {
    const data = await this.annualMembershipService.listContinuations(
      sectionId,
      pagination,
      search,
    );
    return { status: 'success', data };
  }

  @Post()
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inscribir miembros no inscritos del año vigente',
    description:
      'La directiva de la sección destino activa la fila member inactive del año actual. ' +
      'No copia cargos. No autoriza al dueño del perfil. Lote por usuario (máx. 100 distintos). ' +
      'La matrícula de clase queda pendiente hasta la política compartida de clases.',
  })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({
    status: 200,
    description:
      '{ results: [{ user_id, outcome, club_section_id, ecclesiastical_year_id, enrollment_id, error_code }] }',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires club_members:approve on the destination section',
  })
  async continueUsers(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() body: AnnualContinuationBodyDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.annualMembershipService.continueUsers(
      sectionId,
      body.user_ids,
      user.sub,
    );
    return { status: 'success', data: result };
  }
}
