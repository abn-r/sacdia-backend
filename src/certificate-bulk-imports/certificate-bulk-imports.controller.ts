import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
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
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import {
  CreateCertificateBulkImportDto,
  PresignCertificateImportFileDto,
  UpdateCertificateImportItemDto,
} from './dto';
import { CertificateImportFilesService } from './certificate-import-files.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('certificate-bulk-imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@Controller('certificate-bulk-imports')
export class CertificateBulkImportsController {
  constructor(
    private readonly service: CertificateBulkImportsService,
    private readonly filesService: CertificateImportFilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar expedientes propios para retomarlos' })
  async listMine(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.listMine(
      req.user.sub,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
    return { status: 'success', data };
  }

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

  @Post(':batchId/items')
  @ApiOperation({ summary: 'Agregar una fila manual al borrador' })
  async addItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Body() dto: UpdateCertificateImportItemDto,
  ) {
    const data = await this.service.addItem(req.user.sub, batchId, dto);
    return { status: 'success', data };
  }

  @Delete(':batchId/items/:itemId')
  @ApiOperation({ summary: 'Quitar una fila del borrador' })
  async removeItem(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
  ) {
    const data = await this.service.removeItem(req.user.sub, batchId, itemId);
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

  @Post(':batchId/files/presign')
  @ApiOperation({ summary: 'Preparar subida firmada de un comprobante' })
  async presignFile(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Body() dto: PresignCertificateImportFileDto,
  ) {
    const data = await this.filesService.presign(req.user.sub, batchId, dto);
    return { status: 'success', data };
  }

  @Post(':batchId/files/:fileId/confirm')
  @ApiOperation({ summary: 'Confirmar bytes reales del comprobante' })
  async confirmFile(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
  ) {
    const data = await this.filesService.confirm(
      req.user.sub,
      batchId,
      fileId,
    );
    return { status: 'success', data };
  }

  @Get(':batchId/files/:fileId/download')
  @ApiOperation({ summary: 'Obtener URL efímera del comprobante sellado' })
  async downloadFile(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
  ) {
    const data = await this.filesService.download(
      req.user.sub,
      batchId,
      fileId,
    );
    return { status: 'success', data };
  }

  @Delete(':batchId/files/:fileId')
  @ApiOperation({ summary: 'Retirar un comprobante que todavía no fue enviado' })
  async removeFile(
    @Request() req: AuthenticatedRequest,
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
  ) {
    const data = await this.filesService.remove(req.user.sub, batchId, fileId);
    return { status: 'success', data };
  }
}
