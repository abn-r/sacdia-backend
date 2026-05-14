import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { MATERIALS_MANAGE_INVENTORY } from '../shared/permissions';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryAdminDto } from './dto/category.dto';

@ApiTags('Materials — Categories (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // GET /materials/categories — admin list (includes inactive + product_count)
  @Get()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({
    summary: 'List all material categories (admin view; includes inactive)',
  })
  @ApiResponse({ status: 200, type: CategoryAdminDto, isArray: true })
  list(): Promise<CategoryAdminDto[]> {
    return this.categoriesService.list();
  }

  // POST /materials/categories
  @Post()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new material category' })
  @ApiResponse({ status: 201, type: CategoryAdminDto })
  @ApiResponse({ status: 409, description: 'slug already exists' })
  create(@Body() dto: CreateCategoryDto): Promise<CategoryAdminDto> {
    return this.categoriesService.create(dto);
  }

  // PATCH /materials/categories/:id
  @Patch(':id')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Update an existing category' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: CategoryAdminDto })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot deactivate a category with active products',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryAdminDto> {
    return this.categoriesService.update(id, dto);
  }

  // DELETE /materials/categories/:id — soft (active=false), blocked if products exist
  @Delete(':id')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({
    summary:
      'Soft-delete a category (active=false). Blocked when products reference it.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        id: { type: 'string' },
        active: { type: 'boolean', example: false },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category in use by products' })
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; active: false }> {
    return this.categoriesService.softDelete(id);
  }
}
