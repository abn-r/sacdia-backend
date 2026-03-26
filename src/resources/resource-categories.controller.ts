import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CreateResourceCategoryDto } from './dto/create-resource-category.dto';
import { UpdateResourceCategoryDto } from './dto/update-resource-category.dto';
import { ResourceCategoriesService } from './resource-categories.service';

@ApiTags('resource-categories')
@Controller('resource-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ResourceCategoriesController {
  constructor(private readonly service: ResourceCategoriesService) {}

  @Post()
  @RequirePermissions('resource_categories:create')
  @ApiOperation({ summary: 'Crear categoría de recurso' })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  async create(@Body() dto: CreateResourceCategoryDto) {
    const data = await this.service.create(dto);
    return { status: 'success', data };
  }

  @Get()
  @RequirePermissions('resource_categories:read')
  @ApiOperation({ summary: 'Listar categorías de recursos activas' })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  async findAll() {
    const data = await this.service.findAll();
    return { status: 'success', data };
  }

  @Get(':id')
  @RequirePermissions('resource_categories:read')
  @ApiOperation({ summary: 'Obtener categoría de recurso por ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría encontrada' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { status: 'success', data };
  }

  @Patch(':id')
  @RequirePermissions('resource_categories:update')
  @ApiOperation({ summary: 'Actualizar categoría de recurso' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría actualizada' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResourceCategoryDto,
  ) {
    const data = await this.service.update(id, dto);
    return { status: 'success', data };
  }

  @Delete(':id')
  @RequirePermissions('resource_categories:delete')
  @ApiOperation({ summary: 'Desactivar categoría de recurso (soft delete)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría desactivada' })
  @ApiResponse({ status: 400, description: 'Categoría tiene recursos activos' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.remove(id);
    return { status: 'success', data };
  }
}
