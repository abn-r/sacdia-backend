import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DEFAULT_UPLOAD_OPTIONS } from '../../common/constants/upload-limits.constants';
import 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import {
  MATERIALS_READ,
  MATERIALS_UPLOAD_RECEIPT,
  MATERIALS_VALIDATE_RECEIPT,
} from '../shared/permissions';
import { ReceiptsService } from './receipts.service';
import { ApproveComprobanteDto } from './dto/approve-comprobante.dto';
import { RejectComprobanteDto } from './dto/reject-comprobante.dto';
import { UploadComprobanteDto } from './dto/upload-comprobante.dto';
import {
  ApproveComprobanteResponseDto,
  ComprobanteDto,
  ListComprobantesDto,
} from './dto/comprobante.dto';
import { ReceiptFileValidationPipe } from './receipt-file-validation.pipe';

@ApiTags('Materials — Receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/receipts/:folio
  // REQ-CMP-001, REQ-CMP-002, REQ-CMP-003, SC-05, SC-12, SC-13
  // Route ordering: static routes (/:folio/approve, /:folio/reject) must be
  // declared BEFORE the plain GET /:folio to avoid param collision.
  // ---------------------------------------------------------------------------

  @Post(':folio')
  @RequirePermissions(MATERIALS_UPLOAD_RECEIPT)
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload payment receipt for an approved order',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'file',
        'monto_centavos',
        'ref_bancaria_declarada',
        'fecha_pago',
      ],
      properties: {
        file: { type: 'string', format: 'binary' },
        monto_centavos: { type: 'integer', example: 150000 },
        ref_bancaria_declarada: { type: 'string', example: 'TXN-2026-001234' },
        fecha_pago: { type: 'string', format: 'date', example: '2026-05-14' },
      },
    },
  })
  @ApiResponse({ status: 201, type: ComprobanteDto })
  @ApiResponse({
    status: 400,
    description: 'invalid_file — size_exceeded or unsupported_mime',
  })
  @ApiResponse({
    status: 403,
    description: 'Order belongs to another director',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 422, description: 'Order not in aprobada state' })
  upload(
    @Param('folio') folio: string,
    @UploadedFile(new ReceiptFileValidationPipe())
    file: Express.Multer.File,
    @Body() dto: UploadComprobanteDto,
    @Request() req: any,
  ): Promise<ComprobanteDto> {
    return this.receiptsService.upload(folio, file, dto, {
      id: req.user.sub,
    });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/receipts/:folio/approve
  // REQ-CMP-006, SC-06, SC-14
  // MUST be declared BEFORE GET :folio (static sub-path before param-only route)
  // ---------------------------------------------------------------------------

  @Post(':folio/approve')
  @RequirePermissions(MATERIALS_VALIDATE_RECEIPT)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve a pending receipt — transitions order to pagada',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: ApproveComprobanteResponseDto })
  @ApiResponse({ status: 404, description: 'Order or receipt not found' })
  @ApiResponse({
    status: 409,
    description:
      'already_approved_comprobante — another receipt is already approved',
  })
  @ApiResponse({
    status: 422,
    description:
      'Receipt not in pendiente status or order not in aprobada state',
  })
  approve(
    @Param('folio') folio: string,
    @Body() dto: ApproveComprobanteDto,
    @Request() req: any,
  ): Promise<ApproveComprobanteResponseDto> {
    return this.receiptsService.approve(folio, dto, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/materials/receipts/:folio/reject
  // REQ-CMP-007, SC-10
  // MUST be declared BEFORE GET :folio
  // ---------------------------------------------------------------------------

  @Post(':folio/reject')
  @RequirePermissions(MATERIALS_VALIDATE_RECEIPT)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a pending receipt — order remains in aprobada',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: ComprobanteDto })
  @ApiResponse({ status: 404, description: 'Order or receipt not found' })
  @ApiResponse({
    status: 422,
    description: 'Receipt not in pendiente status',
  })
  reject(
    @Param('folio') folio: string,
    @Body() dto: RejectComprobanteDto,
    @Request() req: any,
  ): Promise<ComprobanteDto> {
    return this.receiptsService.reject(folio, dto, { id: req.user.sub });
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/receipts/:folio
  // REQ-CMP-004
  // MUST be LAST — declared after all static POST :folio/* routes
  // ---------------------------------------------------------------------------

  @Get(':folio')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({
    summary: 'List all receipts for an order (with signed read URLs)',
  })
  @ApiParam({
    name: 'folio',
    type: String,
    description: 'Order folio_referencia or UUID',
  })
  @ApiResponse({ status: 200, type: ListComprobantesDto })
  @ApiResponse({
    status: 403,
    description: "Director trying to access another director's order",
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  list(
    @Param('folio') folio: string,
    @Request() req: any,
  ): Promise<ListComprobantesDto> {
    const effectivePermissions: string[] =
      req.authorization?.effective?.permissions ?? [];
    const canValidate = effectivePermissions.includes(
      MATERIALS_VALIDATE_RECEIPT,
    );

    return this.receiptsService.list(folio, {
      id: req.user.sub,
      canValidate,
    });
  }
}
