import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { AdminCertificateBulkImportsService } from './admin-certificate-bulk-imports.service';
import { ApproveCertificateImportDto, RejectCertificateImportDto } from './dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('admin-certificate-bulk-imports')
@ApiBearerAuth()
@Controller('admin/certificate-bulk-imports')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles(
  'super-admin',
  'admin',
  'assistant-admin',
  'director-lf',
  'assistant-lf',
)
@SkipPermissions()
export class AdminCertificateBulkImportsController {
  constructor(private readonly service: AdminCertificateBulkImportsService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Listar cargas por certificado pendientes' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listPending(
    @Request() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const data = await this.service.listPending(req.user.sub, { page, limit });
    return { status: 'success', data };
  }

  @Get(':batchId')
  @ApiOperation({ summary: 'Obtener detalle de carga por certificado' })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  async getDetail(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
  ) {
    const data = await this.service.getDetail(req.user.sub, batchId);
    return { status: 'success', data };
  }

  @Post(':batchId/approve')
  @ApiOperation({ summary: 'Aprobar todas las filas pendientes de un lote' })
  async approveBatch(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Body() dto: ApproveCertificateImportDto,
  ) {
    const data = await this.service.approveBatch(req.user.sub, batchId, dto);
    return { status: 'success', data };
  }

  @Post(':batchId/reject')
  @ApiOperation({ summary: 'Rechazar un lote completo y solicitar corrección' })
  async rejectBatch(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Body() dto: RejectCertificateImportDto,
  ) {
    const data = await this.service.rejectBatch(req.user.sub, batchId, dto);
    return { status: 'success', data };
  }

  @Post(':batchId/items/:itemId/approve')
  @ApiOperation({ summary: 'Aprobar una fila del lote' })
  async approveItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ApproveCertificateImportDto,
  ) {
    const data = await this.service.approveItem(
      req.user.sub,
      batchId,
      itemId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post(':batchId/items/:itemId/reject')
  @ApiOperation({ summary: 'Rechazar una fila del lote con motivo' })
  async rejectItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: RejectCertificateImportDto,
  ) {
    const data = await this.service.rejectItem(
      req.user.sub,
      batchId,
      itemId,
      dto,
    );
    return { status: 'success', data };
  }
}
