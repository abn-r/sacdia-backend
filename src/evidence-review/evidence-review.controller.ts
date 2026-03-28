import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EvidenceReviewService } from './evidence-review.service';
import {
  ApproveEvidenceDto,
  RejectEvidenceDto,
  BulkApproveEvidenceDto,
  BulkRejectEvidenceDto,
} from './dto';
import type { EvidenceType } from './dto';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';

@ApiTags('evidence-review')
@ApiBearerAuth()
@Controller('evidence-review')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('admin', 'super_admin', 'coordinator')
export class EvidenceReviewController {
  constructor(private readonly evidenceReviewService: EvidenceReviewService) {}

  // ========================================
  // GET /evidence-review/pending
  // ========================================

  @Get('pending')
  @ApiOperation({
    summary: 'Listar evidencias pendientes de revisión',
    description:
      'Devuelve una lista paginada de evidencias (folders, clases y honores) ' +
      'en estado pendiente de validación. Filtrable por tipo.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['folder', 'class', 'honor'],
    description: 'Filtrar por tipo de evidencia',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Resultados por página (default: 20)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de evidencias pendientes',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async getPending(
    @Query('type') type?: EvidenceType,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const data = await this.evidenceReviewService.getPending(type, page, limit);
    return { status: 'success', data };
  }

  // ========================================
  // POST /evidence-review/bulk-approve
  // Must come BEFORE /:type/:id routes to avoid param collision
  // ========================================

  @Post('bulk-approve')
  @ApiOperation({
    summary: 'Aprobar múltiples evidencias en bloque',
    description:
      'Aprueba múltiples registros de evidencia del mismo tipo en una sola operación. ' +
      'Los que fallen se incluyen en `failed` con el motivo. Máximo 200 IDs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado parcial o total de la aprobación en bloque',
    schema: {
      example: {
        status: 'success',
        data: {
          succeeded: [1, 2, 3],
          failed: [
            {
              id: 4,
              reason: 'Solo se pueden aprobar registros en estado pendiente.',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'DTO inválido' })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async bulkApprove(
    @Body() dto: BulkApproveEvidenceDto,
    @Request() req: { user: { sub: string } },
  ) {
    const actorId: string = req.user.sub;
    const data = await this.evidenceReviewService.bulkApprove(actorId, dto);
    return { status: 'success', data };
  }

  // ========================================
  // POST /evidence-review/bulk-reject
  // ========================================

  @Post('bulk-reject')
  @ApiOperation({
    summary: 'Rechazar múltiples evidencias en bloque',
    description:
      'Rechaza múltiples registros del mismo tipo. El motivo es obligatorio y ' +
      'se aplica a todos. Máximo 200 IDs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado parcial o total del rechazo en bloque',
  })
  @ApiResponse({
    status: 400,
    description: 'DTO inválido (motivo vacío, etc.)',
  })
  @ApiResponse({ status: 403, description: 'Sin rol de admin o coordinador' })
  async bulkReject(
    @Body() dto: BulkRejectEvidenceDto,
    @Request() req: { user: { sub: string } },
  ) {
    const actorId: string = req.user.sub;
    const data = await this.evidenceReviewService.bulkReject(actorId, dto);
    return { status: 'success', data };
  }

  // ========================================
  // GET /evidence-review/:type/:id
  // ========================================

  @Get(':type/:id')
  @ApiOperation({
    summary: 'Obtener detalle de una evidencia con archivos adjuntos',
  })
  @ApiParam({
    name: 'type',
    enum: ['folder', 'class', 'honor'],
    description: 'Tipo de evidencia',
  })
  @ApiParam({ name: 'id', type: Number, description: 'ID del registro' })
  @ApiResponse({
    status: 200,
    description: 'Detalle de la evidencia con archivos',
  })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async getDetail(
    @Param('type') type: EvidenceType,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.evidenceReviewService.getDetail(type, id);
    return { status: 'success', data };
  }

  // ========================================
  // POST /evidence-review/:type/:id/approve
  // ========================================

  @Post(':type/:id/approve')
  @ApiOperation({ summary: 'Aprobar una evidencia' })
  @ApiParam({
    name: 'type',
    enum: ['folder', 'class', 'honor'],
    description: 'Tipo de evidencia',
  })
  @ApiParam({ name: 'id', type: Number, description: 'ID del registro' })
  @ApiResponse({ status: 200, description: 'Evidencia aprobada' })
  @ApiResponse({ status: 400, description: 'Estado inválido para aprobar' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async approve(
    @Param('type') type: EvidenceType,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveEvidenceDto,
    @Request() req: { user: { sub: string } },
  ) {
    const actorId: string = req.user.sub;
    const data = await this.evidenceReviewService.approve(
      type,
      id,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // POST /evidence-review/:type/:id/reject
  // ========================================

  @Post(':type/:id/reject')
  @ApiOperation({ summary: 'Rechazar una evidencia con motivo' })
  @ApiParam({
    name: 'type',
    enum: ['folder', 'class', 'honor'],
    description: 'Tipo de evidencia',
  })
  @ApiParam({ name: 'id', type: Number, description: 'ID del registro' })
  @ApiResponse({ status: 200, description: 'Evidencia rechazada' })
  @ApiResponse({ status: 400, description: 'Ya está rechazada o motivo vacío' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async reject(
    @Param('type') type: EvidenceType,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectEvidenceDto,
    @Request() req: { user: { sub: string } },
  ) {
    const actorId: string = req.user.sub;
    const data = await this.evidenceReviewService.reject(
      type,
      id,
      actorId,
      dto,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET /evidence-review/:type/:id/history
  // ========================================

  @Get(':type/:id/history')
  @ApiOperation({ summary: 'Historial de validación de una evidencia' })
  @ApiParam({
    name: 'type',
    enum: ['folder', 'class', 'honor'],
    description: 'Tipo de evidencia',
  })
  @ApiParam({ name: 'id', type: Number, description: 'ID del registro' })
  @ApiResponse({ status: 200, description: 'Historial de validación' })
  async getHistory(
    @Param('type') type: EvidenceType,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.evidenceReviewService.getHistory(type, id);
    return { status: 'success', data };
  }
}
