import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CatalogService } from './catalog.service';
import {
  CAMPOREE_ORDERS_CATALOG_MANAGE,
  CAMPOREE_ORDERS_READ,
} from './permissions';
import {
  resolveCamporeeOrderActor,
  type RequestWithProfile,
} from './camporee-order-actor';
import {
  CreateCamporeeOrderProductDto,
  ListCamporeeOrderProductsQueryDto,
} from './dto/create-camporee-order-product.dto';
import { UpdateCamporeeOrderProductDto } from './dto/update-camporee-order-product.dto';
import {
  CreateProductOptionDto,
  UpdateProductOptionDto,
} from './dto/create-product-option.dto';

@ApiTags('camporee order products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('camporee-order-products')
  @RequirePermissions(CAMPOREE_ORDERS_CATALOG_MANAGE)
  @ApiOperation({ summary: 'Crear producto de la biblioteca territorial' })
  async create(
    @Body() dto: CreateCamporeeOrderProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.create(dto, resolveCamporeeOrderActor(request)),
    };
  }

  @Get('camporee-order-products')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @ApiOperation({
    summary: 'Listar productos visibles en la cascada territorial del actor',
  })
  async list(
    @Query() query: ListCamporeeOrderProductsQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.list(resolveCamporeeOrderActor(request), query),
    };
  }

  @Get('camporee-order-products/:productId')
  @RequirePermissions(CAMPOREE_ORDERS_READ)
  @ApiOperation({ summary: 'Obtener un producto de la biblioteca' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  async getById(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.getById(
        productId,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Patch('camporee-order-products/:productId')
  @RequirePermissions(CAMPOREE_ORDERS_CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Actualizar un producto (soft-delete con active=false)',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  async update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCamporeeOrderProductDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.update(
        productId,
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Post('camporee-order-products/:productId/options')
  @RequirePermissions(CAMPOREE_ORDERS_CATALOG_MANAGE)
  @ApiOperation({ summary: 'Agregar una opción de talla al producto' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  async addOption(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateProductOptionDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.addOption(
        productId,
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }

  @Patch('camporee-order-product-options/:optionId')
  @RequirePermissions(CAMPOREE_ORDERS_CATALOG_MANAGE)
  @ApiOperation({
    summary:
      'Actualizar una opción. El label es inmutable si hay líneas de pedido.',
  })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  async updateOption(
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() dto: UpdateProductOptionDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.catalog.updateOption(
        optionId,
        dto,
        resolveCamporeeOrderActor(request),
      ),
    };
  }
}
