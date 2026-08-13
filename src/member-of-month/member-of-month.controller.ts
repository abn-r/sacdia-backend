import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MemberOfMonthService } from './member-of-month.service';
import { EvaluateMemberOfMonthDto } from './dto/member-of-month.dto';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { namedThrottle } from '../config/throttler.helpers';

@ApiTags('member-of-month')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MemberOfMonthController {
  constructor(private readonly memberOfMonthService: MemberOfMonthService) {}

  @Get('member-of-month/admin/list')
  @RequirePermissions('mom:supervise')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Listar miembro del mes multi-sección (admin/coordinator por asignaciones)',
  })
  @ApiQuery({ name: 'club_type_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'club_id', required: false, type: Number })
  @ApiQuery({ name: 'section_id', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'notified', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of member-of-month records',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (mom:supervise required)',
  })
  async listForAdmin(
    @Req() req: any,
    @Query('club_type_id', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('local_field_id', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @Query('club_id', new ParseIntPipe({ optional: true })) clubId?: number,
    @Query('section_id', new ParseIntPipe({ optional: true }))
    sectionId?: number,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
    @Query('notified') notified?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.memberOfMonthService.listForAdmin(req.user.sub, {
      clubTypeId,
      localFieldId,
      clubId,
      sectionId,
      year,
      month,
      notified: notified !== undefined ? notified === 'true' : undefined,
      page,
      limit,
    });
    return { status: 'success', data };
  }

  @Get('clubs/:clubId/sections/:sectionId/member-of-month')
  @RequirePermissions('mom:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener miembro del mes actual de la sección' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Miembro(s) del mes actual' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (mom:read required)',
  })
  @ApiResponse({ status: 404, description: 'Sección no encontrada' })
  async getCurrentMemberOfMonth(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    return this.memberOfMonthService.getCurrentMemberOfMonth(clubId, sectionId);
  }

  @Get('clubs/:clubId/sections/:sectionId/member-of-month/history')
  @RequirePermissions('mom:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener historial paginado de miembro del mes' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Resultados por página (default 12)',
  })
  @ApiResponse({ status: 200, description: 'Historial de miembro del mes' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (mom:read required)',
  })
  @ApiResponse({ status: 404, description: 'Sección no encontrada' })
  async getMemberOfMonthHistory(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.memberOfMonthService.getMemberOfMonthHistory(
      clubId,
      sectionId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 12,
    );
  }

  @Post('clubs/:clubId/sections/:sectionId/member-of-month/evaluate')
  @RequirePermissions('mom:evaluate')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @Throttle(namedThrottle({ limit: 5, ttl: 60000 }))
  @ApiOperation({
    summary: 'Disparar evaluación manual de miembro del mes',
    description: 'Solo directores del club pueden ejecutar esta acción',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({
    status: 201,
    description: 'Evaluación ejecutada exitosamente',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Solo directores pueden ejecutar esta acción',
  })
  @ApiResponse({ status: 404, description: 'Sección no encontrada' })
  async evaluateMemberOfMonth(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: EvaluateMemberOfMonthDto,
    @Req() req: any,
  ) {
    return this.memberOfMonthService.evaluateMemberOfMonth(
      clubId,
      sectionId,
      dto.month,
      dto.year,
      req.user.sub,
    );
  }
}
