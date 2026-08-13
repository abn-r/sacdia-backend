import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import type { Response } from 'express';
import 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  CreateCamporeePaymentOrderDto,
  CreateInsurancePaymentOrderDto,
  ListPaymentOrdersQueryDto,
  RejectPaymentOrderDto,
} from './dto/field-payment-orders.dto';
import {
  GetFieldPaymentOrderConfigQueryDto,
  UpsertFieldPaymentOrderConfigDto,
} from './dto/field-payment-order-configs.dto';
import { FieldPaymentOrderConfigsService } from './field-payment-order-configs.service';
import { FieldPaymentOrdersService } from './field-payment-orders.service';
import { resolveOrderActor } from './order-actor';
import type { RequestWithProfile } from './order-actor';
import { ProofFileValidationPipe } from './proof-file-validation.pipe';

@ApiTags('field payment orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class FieldPaymentOrdersController {
  constructor(
    private readonly service: FieldPaymentOrdersService,
    private readonly configs: FieldPaymentOrderConfigsService,
  ) {}

  @Post('insurance/payment-orders')
  @RequirePermissions('field-payment-orders:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Emitir orden de pago grupal de seguro' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 201, description: 'Orden emitida' })
  async createInsuranceOrder(
    @Body() dto: CreateInsurancePaymentOrderDto,
    @Req() request: RequestWithProfile,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return {
      status: 'success',
      data: await this.service.createInsuranceOrder(
        dto,
        resolveOrderActor(request),
        idempotencyKey,
      ),
    };
  }

  @Post('camporees/:camporeeId/payment-orders')
  @RequirePermissions('field-payment-orders:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Emitir orden de pago grupal de camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 201, description: 'Orden emitida' })
  async createCamporeeOrder(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateCamporeePaymentOrderDto,
    @Req() request: RequestWithProfile,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return {
      status: 'success',
      data: await this.service.createCamporeeOrder(
        camporeeId,
        dto,
        resolveOrderActor(request),
        idempotencyKey,
      ),
    };
  }

  @Get('payment-orders')
  @RequirePermissions('field-payment-orders:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Listar órdenes de pago del alcance del actor' })
  async list(
    @Query() query: ListPaymentOrdersQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.list(query, resolveOrderActor(request)),
    };
  }

  @Get('payment-orders/review-queue')
  @RequirePermissions('field-payment-orders:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Bandeja de revisión de órdenes con comprobante (Campo Local)',
  })
  async reviewQueue(
    @Query() query: ListPaymentOrdersQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.reviewQueue(query, resolveOrderActor(request)),
    };
  }

  @Get('payment-orders/context')
  @RequirePermissions('field-payment-orders:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Disponibilidad del flujo de órdenes y ciclos de seguro aplicables a la sección activa',
  })
  async getContext(@Req() request: RequestWithProfile) {
    return {
      status: 'success',
      data: await this.service.getIssuerContext(resolveOrderActor(request)),
    };
  }

  @Get('payment-orders/config')
  @RequirePermissions('field-payment-orders:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Instrucciones de pago del Campo Local (banco/caja)',
  })
  async getConfig(
    @Query() query: GetFieldPaymentOrderConfigQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.configs.get(
        query.local_field_id,
        resolveOrderActor(request),
      ),
    };
  }

  @Post('payment-orders/config')
  @RequirePermissions('field-payment-orders:configure')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Crear o actualizar instrucciones de pago del Campo Local',
  })
  async upsertConfig(
    @Body() dto: UpsertFieldPaymentOrderConfigDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.configs.upsert(dto, resolveOrderActor(request)),
    };
  }

  @Get('payment-orders/:orderId')
  @RequirePermissions('field-payment-orders:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Detalle de una orden de pago' })
  @ApiParam({ name: 'orderId', type: String })
  async get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.get(orderId, resolveOrderActor(request)),
    };
  }

  @Get('payment-orders/:orderId/document')
  @RequirePermissions('field-payment-orders:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Descargar PDF imprimible de la orden' })
  @ApiParam({ name: 'orderId', type: String })
  async getDocument(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
    @Res() response: Response,
  ) {
    const { buffer, folio_reference } = await this.service.getDocument(
      orderId,
      resolveOrderActor(request),
    );
    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="orden-${folio_reference}.pdf"`,
      )
      .send(buffer);
  }

  @Get('payment-orders/:orderId/proof')
  @RequirePermissions('field-payment-orders:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'URL firmada del comprobante vigente' })
  @ApiParam({ name: 'orderId', type: String })
  async getProof(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.getProofDownload(
        orderId,
        resolveOrderActor(request),
      ),
    };
  }

  @Post('payment-orders/:orderId/proof')
  @RequirePermissions('field-payment-orders:upload-proof')
  @AuthorizationResource({ type: 'active_assignment' })
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir comprobante de pago (multipart, campo file)',
  })
  @ApiParam({ name: 'orderId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadProof(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile(new ProofFileValidationPipe())
    file: Express.Multer.File,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.uploadProof(
        orderId,
        file,
        resolveOrderActor(request),
      ),
    };
  }

  @Post('payment-orders/:orderId/cancel')
  @RequirePermissions('field-payment-orders:cancel')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Cancelar una orden emitida o rechazada' })
  @ApiParam({ name: 'orderId', type: String })
  async cancel(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.cancel(orderId, resolveOrderActor(request)),
    };
  }

  @Post('payment-orders/:orderId/approve')
  @RequirePermissions('field-payment-orders:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Aprobar comprobante y ejecutar fulfillment atómico',
  })
  @ApiParam({ name: 'orderId', type: String })
  async approve(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.approve(orderId, resolveOrderActor(request)),
    };
  }

  @Post('payment-orders/:orderId/reject')
  @RequirePermissions('field-payment-orders:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Rechazar comprobante (permite re-subida)' })
  @ApiParam({ name: 'orderId', type: String })
  async reject(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RejectPaymentOrderDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.reject(
        orderId,
        dto.reason,
        resolveOrderActor(request),
      ),
    };
  }
}
