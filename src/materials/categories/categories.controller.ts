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
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { PrismaService } from '../../prisma/prisma.service';
import { MATERIALS_MANAGE_INVENTORY } from '../shared/permissions';
import {
  requireLocalFieldFor,
  resolveActorLocalField,
} from '../shared/actor-local-field';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryAdminDto } from './dto/category.dto';

@ApiTags('Materials — Categories (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly prisma: PrismaService,
  ) {}

  // GET /materials/categories — admin list (includes inactive + product_count)
  @Get()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({
    summary: 'List all material categories (admin view; includes inactive)',
  })
  @ApiResponse({ status: 200, type: CategoryAdminDto, isArray: true })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  async list(
    @Query() query: ListCategoriesQueryDto,
    @Request() req: any,
  ): Promise<CategoryAdminDto[]> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const localFieldId = requireLocalFieldFor(
      scope,
      query.local_field_id,
      'read',
    );
    return this.categoriesService.list(localFieldId);
  }

  // POST /materials/categories
  @Post()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new material category' })
  @ApiResponse({ status: 201, type: CategoryAdminDto })
  @ApiResponse({ status: 409, description: 'slug already exists' })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  async create(
    @Body() dto: CreateCategoryDto,
    @Query() query: ListCategoriesQueryDto,
    @Request() req: any,
  ): Promise<CategoryAdminDto> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const localFieldId = requireLocalFieldFor(scope, query.local_field_id);
    return this.categoriesService.create(dto, localFieldId);
  }

  // PATCH /materials/categories/:id
  @Patch(':id')
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Update an existing category' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: CategoryAdminDto })
  @ApiResponse({
    status: 403,
    description: 'Category belongs to another local field',
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot deactivate a category with active products',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @Request() req: any,
  ): Promise<CategoryAdminDto> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    return this.categoriesService.update(id, dto, scope);
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
  @ApiResponse({
    status: 403,
    description: 'Category belongs to another local field',
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category in use by products' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<{ id: string; active: false }> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    return this.categoriesService.softDelete(id, scope);
  }
}
