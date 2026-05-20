import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import {
  CreateCertificateBulkImportDto,
  UpdateCertificateImportItemDto,
} from './dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('certificate-bulk-imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('certificate-bulk-imports')
export class CertificateBulkImportsController {
  constructor(private readonly service: CertificateBulkImportsService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear un borrador de carga por certificado',
    description:
      'Inicia una carga masiva creada por el miembro con uno o más comprobantes/certificados.',
  })
  @ApiResponse({ status: 201, description: 'Borrador creado' })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateCertificateBulkImportDto,
  ) {
    const data = await this.service.createDraft(req.user.sub, dto);
    return { status: 'success', data };
  }

  @Post(':batchId/process-ocr')
  @ApiOperation({ summary: 'Procesar OCR de un borrador del miembro' })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  async processOcr(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
  ) {
    const data = await this.service.processOcr(req.user.sub, batchId);
    return { status: 'success', data };
  }

  @Get(':batchId')
  @ApiOperation({ summary: 'Obtener detalle de una carga por certificado' })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  async getDetail(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
  ) {
    const data = await this.service.getBatch(req.user.sub, batchId);
    return { status: 'success', data };
  }

  @Patch(':batchId/items/:itemId')
  @ApiOperation({
    summary: 'Corregir o completar una fila detectada por OCR',
  })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  @ApiParam({ name: 'itemId', description: 'ID UUID de la fila' })
  async updateItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCertificateImportItemDto,
  ) {
    const data = await this.service.updateItem(
      req.user.sub,
      batchId,
      itemId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post(':batchId/submit')
  @ApiOperation({
    summary: 'Enviar carga por certificado a validación de Campo Local',
  })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  async submit(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
  ) {
    const data = await this.service.submit(req.user.sub, batchId);
    return { status: 'success', data };
  }

  @Post(':batchId/items/:itemId/resubmit')
  @ApiOperation({ summary: 'Corregir y reenviar una fila rechazada' })
  @ApiParam({ name: 'batchId', description: 'ID UUID del lote' })
  @ApiParam({ name: 'itemId', description: 'ID UUID de la fila' })
  async resubmitItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCertificateImportItemDto,
  ) {
    const data = await this.service.resubmitItem(
      req.user.sub,
      batchId,
      itemId,
      dto,
    );
    return { status: 'success', data };
  }
}
