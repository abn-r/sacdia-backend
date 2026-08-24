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
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  resolveCamporeeOrderActor,
  type RequestWithProfile,
} from './camporee-order-actor';
import { CamporeeOrdersService } from './camporee-orders.service';
import { CreateCamporeeOrderDto } from './dto/create-camporee-order.dto';
import { ListCamporeeOrdersQueryDto } from './dto/list-camporee-orders.query.dto';
import {
  AuthorizeWithoutProofDto,
  CancelCamporeeOrderDto,
  RejectCamporeeOrderDto,
} from './dto/review-camporee-order.dto';
import {
  CAMPOREE_ORDERS_AUTHORIZE_WITHOUT_PROOF,
  CAMPOREE_ORDERS_CREATE,
  CAMPOREE_ORDERS_DELIVER,
  CAMPOREE_ORDERS_DISTRIBUTE,
  CAMPOREE_ORDERS_READ,
  CAMPOREE_ORDERS_REVIEW,
  CAMPOREE_ORDERS_UPLOAD_PROOF,
} from './permissions';
import { ProofFileValidationPipe } from './proof-file-validation.pipe';

@ApiTags('camporee orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CamporeeOrdersController {
  private readonly idempotencyKeyPipe = new ParseUUIDPipe({ optional: true });

  constructor(private readonly orders: CamporeeOrdersService) {}

  @Post('camporees/:camporeeId/orders')
  @RequirePermissions(CAMPOREE_ORDERS_CREATE)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Emitir un pedido de sección para un camporee local',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async createLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateCamporeeOrderDto,
    @Req() request: RequestWithProfile,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return {
      status: 'success',
      data: await this.orders.create(
        camporeeId,
        'local',
        dto,
        resolveCamporeeOrderActor(request),
        await this.parseIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Post('union-camporees/:camporeeId/orders')
  @RequirePermissions(CAMPOREE_ORDERS_CREATE)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Emitir un pedido de sección para un camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async createUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateCamporeeOrderDto,
    @Req() request: RequestWithProfile,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return {
      status: 'success',
      data: await this.orders.create(
        camporeeId,
        'union',
        dto,
        resolveCamporeeOrderActor(request),
        await this.parseIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Get('camporee-orders')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary:
      'Listar pedidos visibles. No colapsa pedidos suplementarios de la misma sección.',
  })
  async list(
    @Query() query: ListCamporeeOrdersQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.list(query, resolveCamporeeOrderActor(request)),
    };
  }

  @Get('camporee-orders/:orderId')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary:
      'Detalle de pedido con líneas nominadas, summary y snapshot de pago',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.get(orderId, resolveCamporeeOrderActor(request)),
    };
  }

  @Get('camporee-orders/:orderId/document')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Descargar PDF imprimible del pedido' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async getDocument(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
    @Res() response: Response,
  ) {
    const { buffer, folio_reference } = await this.orders.getDocument(
      orderId,
      resolveCamporeeOrderActor(request),
    );
    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="pedido-${folio_reference}.pdf"`,
      )
      .send(buffer);
  }

  @Get('camporee-orders/:orderId/proof')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'URL firmada del comprobante vigente' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async getProof(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.getProofDownload(
        orderId,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/proof')
  @RequirePermissions(CAMPOREE_ORDERS_UPLOAD_PROOF)
  @AuthorizationResource({ type: 'active_assignment' })
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir comprobante de pago (multipart, campo file)',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
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
      data: await this.orders.uploadProof(
        orderId,
        file,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/cancel')
  @RequirePermissions({
    permissions: [CAMPOREE_ORDERS_CREATE, CAMPOREE_ORDERS_REVIEW],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Cancelar un pedido emitido o con comprobante rechazado',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async cancel(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
    @Body() dto: CancelCamporeeOrderDto = {},
  ) {
    return {
      status: 'success',
      data: await this.orders.cancel(
        orderId,
        resolveCamporeeOrderActor(request),
        dto.reason,
      ),
    };
  }

  @Post('camporee-orders/:orderId/approve')
  @RequirePermissions(CAMPOREE_ORDERS_REVIEW)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Aprobar comprobante y marcar el pedido como pagado',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async approve(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.approve(
        orderId,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/reject')
  @RequirePermissions(CAMPOREE_ORDERS_REVIEW)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Rechazar comprobante (permite re-subida)' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async reject(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RejectCamporeeOrderDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.reject(
        orderId,
        dto.reason,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/authorize-without-proof')
  @RequirePermissions(CAMPOREE_ORDERS_AUTHORIZE_WITHOUT_PROOF)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary:
      'Marcar pagado sin comprobante (excepción de caja del Campo Local)',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async authorizeWithoutProof(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AuthorizeWithoutProofDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.authorizeWithoutProof(
        orderId,
        dto.reason,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/deliver')
  @RequirePermissions(CAMPOREE_ORDERS_DELIVER)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Marcar el bulto entregado del Campo Local a la sección',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  async deliver(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.deliverToSection(
        orderId,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-orders/:orderId/lines/:lineId/deliver-to-member')
  @RequirePermissions(CAMPOREE_ORDERS_DISTRIBUTE)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Marcar una línea nominada como entregada al miembro (solo director de la sección)',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({ name: 'lineId', format: 'uuid' })
  async deliverToMember(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.orders.deliverToMember(
        orderId,
        lineId,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  private async parseIdempotencyKey(
    idempotencyKey?: string,
  ): Promise<string | undefined> {
    if (idempotencyKey === undefined) {
      return undefined;
    }
    return this.idempotencyKeyPipe.transform(idempotencyKey, {
      type: 'custom',
      data: 'idempotency-key',
    });
  }
}
