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

@ApiTags('member-of-month')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MemberOfMonthController {
  constructor(
    private readonly memberOfMonthService: MemberOfMonthService,
  ) {}

  @Get('clubs/:clubId/sections/:sectionId/member-of-month')
  @RequirePermissions('units:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener miembro del mes actual de la sección' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 200, description: 'Miembro(s) del mes actual' })
  @ApiResponse({ status: 404, description: 'Sección no encontrada' })
  async getCurrentMemberOfMonth(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    return this.memberOfMonthService.getCurrentMemberOfMonth(clubId, sectionId);
  }

  @Get('clubs/:clubId/sections/:sectionId/member-of-month/history')
  @RequirePermissions('units:read')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @ApiOperation({ summary: 'Obtener historial paginado de miembro del mes' })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Página (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Resultados por página (default 12)' })
  @ApiResponse({ status: 200, description: 'Historial de miembro del mes' })
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
  @RequirePermissions('units:update')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubId' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Disparar evaluación manual de miembro del mes',
    description: 'Solo directores del club pueden ejecutar esta acción',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 201, description: 'Evaluación ejecutada exitosamente' })
  @ApiResponse({ status: 403, description: 'Solo directores pueden ejecutar esta acción' })
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
