import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ========================================
  // INVENTORY ITEMS
  // ========================================

  @Get('clubs/:clubId/inventory')
  @ApiOperation({
    summary: 'Listar items del inventario de un club',
    description:
      'Obtiene todos los items de inventario de una instancia específica de club (Aventureros, Conquistadores, o Guías Mayores)',
  })
  @ApiParam({
    name: 'clubId',
    description: 'ID de la instancia del club',
    example: 5,
  })
  @ApiQuery({
    name: 'instanceType',
    description:
      'Tipo de instancia del club (adv: Aventureros, pathf: Conquistadores, mg: Guías Mayores)',
    example: 'pathf',
    required: true,
  })
  @ApiQuery({
    name: 'category',
    description: 'Filtrar por ID de categoría',
    example: 1,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de items del inventario con metadata',
  })
  @ApiResponse({ status: 400, description: 'Tipo de instancia inválido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async findAllByClub(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('instanceType') instanceType: 'adv' | 'pathf' | 'mg',
    @Query('category', ParseIntPipe) categoryId?: number,
  ) {
    const result = await this.inventoryService.findAllByClub(
      clubId,
      instanceType,
      categoryId,
    );
    return {
      status: 'success',
      ...result,
    };
  }

  @Get('inventory/:id')
  @ApiOperation({
    summary: 'Obtener detalles de un item del inventario',
    description:
      'Obtiene información detallada de un item específico incluyendo historial de cambios',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del item con historial',
  })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.inventoryService.findOne(id);
    return {
      status: 'success',
      data,
    };
  }

  @Post('clubs/:clubId/inventory')
  @ApiOperation({
    summary: 'Agregar nuevo item al inventario',
    description:
      'Crea un nuevo item de inventario para una instancia específica de club. Requiere rol de Director, Subdirector o Tesorero.',
  })
  @ApiParam({
    name: 'clubId',
    description: 'ID de la instancia del club',
    example: 5,
  })
  @ApiResponse({ status: 201, description: 'Item creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Club o categoría no encontrados' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para agregar items',
  })
  async create(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Body() dto: CreateItemDto,
  ) {
    const data = await this.inventoryService.create(clubId, dto);
    return {
      status: 'success',
      data,
    };
  }

  @Patch('inventory/:id')
  @ApiOperation({
    summary: 'Actualizar un item del inventario',
    description:
      'Actualiza información de un item existente. Requiere rol de Director, Subdirector o Tesorero.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Item actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para actualizar items',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemDto,
  ) {
    const data = await this.inventoryService.update(id, dto);
    return {
      status: 'success',
      data,
    };
  }

  @Delete('inventory/:id')
  @ApiOperation({
    summary: 'Eliminar un item del inventario',
    description:
      'Elimina un item del inventario (soft delete). Requiere rol de Director o Subdirector.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del item de inventario',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Item eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Item no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'No tiene permisos para eliminar items',
  })
  async delete(@Param('id', ParseIntPipe) id: number) {
    const data = await this.inventoryService.delete(id);
    return {
      status: 'success',
      ...data,
    };
  }

  // ========================================
  // INVENTORY CATEGORIES
  // ========================================

  @Get('catalogs/inventory-categories')
  @ApiOperation({
    summary: 'Listar categorías de inventario',
    description:
      'Obtiene todas las categorías disponibles para clasificar items de inventario',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorías de inventario',
  })
  async findAllCategories() {
    const data = await this.inventoryService.findAllCategories();
    return {
      status: 'success',
      data,
    };
  }
}
