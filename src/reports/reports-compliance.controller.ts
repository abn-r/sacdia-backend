import { Controller, Get, ParseIntPipe, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { ReportsComplianceService } from './reports-compliance.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsComplianceController {
  constructor(private readonly complianceService: ReportsComplianceService) {}

  @Get('compliance')
  @RequirePermissions('reports:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Cumplimiento de informes por club y periodo (solo lectura)',
    description:
      'Conteos expected / submitted / pending / overdue de informes mensuales (por sección), trimestrales y anuales (por club) ' +
      'para un año eclesiástico. Mismo alcance que los listados admin: territorio para roles territoriales, ' +
      'secciones asignadas (coordinator_assignments) para coordinadores, sección activa para roles de club.',
  })
  @ApiQuery({ name: 'ecclesiastical_year_id', required: false, type: Number })
  @ApiQuery({ name: 'club_type_id', required: false, type: Number })
  @ApiQuery({ name: 'division_id', required: false, type: Number })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'quarter', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Cumplimiento por club' })
  @ApiResponse({ status: 400, description: 'month o quarter fuera de rango' })
  @ApiResponse({
    status: 403,
    description:
      'Sin reports:read o sin alcance (coordinador sin asignaciones)',
  })
  @ApiResponse({ status: 404, description: 'Año eclesiástico no encontrado' })
  async getCompliance(
    @Req() req: any,
    @Query('ecclesiastical_year_id', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId?: number,
    @Query('club_type_id', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('division_id', new ParseIntPipe({ optional: true }))
    divisionId?: number,
    @Query('union_id', new ParseIntPipe({ optional: true }))
    unionId?: number,
    @Query('local_field_id', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
    @Query('quarter', new ParseIntPipe({ optional: true })) quarter?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.complianceService.getCompliance(req.user.sub, {
      ecclesiasticalYearId,
      clubTypeId,
      divisionId,
      unionId,
      localFieldId,
      year,
      month,
      quarter,
      page,
      limit,
    });
    return { status: 'success', data };
  }
}
