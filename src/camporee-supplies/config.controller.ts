import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
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
  resolveCamporeeSupplyActor,
  type RequestWithProfile,
} from './camporee-supply-actor';
import { CamporeeSupplyConfigService } from './config.service';
import {
  CreateSupplyProductDto,
  CreateSupplySlotDto,
  UpdateSupplyProductDto,
  UpdateSupplySettingsDto,
  UpdateSupplySlotDto,
} from './dto/supply.dto';
import {
  CAMPOREE_SUPPLIES_CONFIGURE,
  CAMPOREE_SUPPLIES_READ,
} from './permissions';

@ApiTags('camporee supplies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CamporeeSupplyConfigController {
  constructor(private readonly config: CamporeeSupplyConfigService) {}

  @Get('camporees/:camporeeId/supply-catalog')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Catálogo de insumos del camporee local' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async catalogLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return {
      status: 'success',
      data: await this.config.getCatalog(camporeeId, 'local'),
    };
  }

  @Get('union-camporees/:camporeeId/supply-catalog')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Catálogo de insumos del camporee de unión' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async catalogUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return {
      status: 'success',
      data: await this.config.getCatalog(camporeeId, 'union'),
    };
  }

  @Patch('camporees/:camporeeId/supply-settings')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Actualizar corte de edición de insumos (local)' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async settingsLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateSupplySettingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateSettings(
        camporeeId,
        'local',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Patch('union-camporees/:camporeeId/supply-settings')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Actualizar corte de edición de insumos (unión)' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async settingsUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateSupplySettingsDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateSettings(
        camporeeId,
        'union',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Post('camporees/:camporeeId/supply-slots')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Crear horario de entrega de insumos (local)' })
  async createSlotLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateSupplySlotDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.createSlot(
        camporeeId,
        'local',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Post('union-camporees/:camporeeId/supply-slots')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Crear horario de entrega de insumos (unión)' })
  async createSlotUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateSupplySlotDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.createSlot(
        camporeeId,
        'union',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Patch('camporees/:camporeeId/supply-slots/:slotId')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async updateSlotLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSupplySlotDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateSlot(
        camporeeId,
        'local',
        slotId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Patch('union-camporees/:camporeeId/supply-slots/:slotId')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async updateSlotUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSupplySlotDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateSlot(
        camporeeId,
        'union',
        slotId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Post('camporees/:camporeeId/supply-products')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async createProductLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateSupplyProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.createProduct(
        camporeeId,
        'local',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Post('union-camporees/:camporeeId/supply-products')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async createProductUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateSupplyProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.createProduct(
        camporeeId,
        'union',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Patch('camporees/:camporeeId/supply-products/:productId')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async updateProductLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateSupplyProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateProduct(
        camporeeId,
        'local',
        productId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }

  @Patch('union-camporees/:camporeeId/supply-products/:productId')
  @RequirePermissions(CAMPOREE_SUPPLIES_CONFIGURE)
  @AuthorizationResource({ type: 'global' })
  async updateProductUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateSupplyProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.config.updateProduct(
        camporeeId,
        'union',
        productId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    };
  }
}
