import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { ReplaceCamporeeOfferingsDto } from './dto/replace-camporee-offerings.dto';
import { UpdateOrderSettingsDto } from './dto/update-order-settings.dto';
import { OfferingsService } from './offerings.service';
import {
  CAMPOREE_ORDERS_OFFERING_CONFIGURE,
  CAMPOREE_ORDERS_READ,
} from './permissions';

@ApiTags('camporee order offerings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller()
export class OfferingsController {
  constructor(private readonly offerings: OfferingsService) {}

  @Patch('camporees/:camporeeId/orders-settings')
  @RequirePermissions(CAMPOREE_ORDERS_OFFERING_CONFIGURE)
  @ApiOperation({ summary: 'Actualizar ventana de pedidos del camporee local' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async updateLocalSettings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateOrderSettingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.offerings.updateSettings(
        camporeeId,
        'local',
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Patch('union-camporees/:camporeeId/orders-settings')
  @RequirePermissions(CAMPOREE_ORDERS_OFFERING_CONFIGURE)
  @ApiOperation({
    summary: 'Actualizar ventana de pedidos del camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async updateUnionSettings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateOrderSettingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.offerings.updateSettings(
        camporeeId,
        'union',
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Get('camporees/:camporeeId/order-offerings')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @ApiOperation({
    summary: 'Listar ofertas y settings de pedidos del camporee local',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listLocalOfferings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return {
      status: 'success',
      data: await this.offerings.getOfferings(camporeeId, 'local'),
    };
  }

  @Get('union-camporees/:camporeeId/order-offerings')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @ApiOperation({
    summary: 'Listar ofertas y settings de pedidos del camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listUnionOfferings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return {
      status: 'success',
      data: await this.offerings.getOfferings(camporeeId, 'union'),
    };
  }

  @Put('camporees/:camporeeId/order-offerings')
  @RequirePermissions(CAMPOREE_ORDERS_OFFERING_CONFIGURE)
  @ApiOperation({
    summary: 'Reemplazar de forma idempotente las ofertas del camporee local',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async replaceLocalOfferings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: ReplaceCamporeeOfferingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.offerings.replaceOfferings(
        camporeeId,
        'local',
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Put('union-camporees/:camporeeId/order-offerings')
  @RequirePermissions(CAMPOREE_ORDERS_OFFERING_CONFIGURE)
  @ApiOperation({
    summary: 'Reemplazar de forma idempotente las ofertas del camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async replaceUnionOfferings(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: ReplaceCamporeeOfferingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.offerings.replaceOfferings(
        camporeeId,
        'union',
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }
}
