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
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiResponse({ status: 200, type: CategoryAdminDto, isArray: true })
  async list(
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<CategoryAdminDto[]> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const override =
      localFieldIdParam === undefined
        ? undefined
        : parseInt(localFieldIdParam, 10);
    const localFieldId =
      scope.scope === 'single'
        ? requireLocalFieldFor(scope, override, 'read')
        : Number.isFinite(override)
          ? (override as number)
          : undefined;
    return this.categoriesService.list(localFieldId);
  }

  // POST /materials/categories
  @Post()
  @RequirePermissions(MATERIALS_MANAGE_INVENTORY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new material category' })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description: 'Required for an unscoped admin or super-admin.',
  })
  @ApiResponse({ status: 201, type: CategoryAdminDto })
  @ApiResponse({ status: 409, description: 'slug already exists' })
  async create(
    @Body() dto: CreateCategoryDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ): Promise<CategoryAdminDto> {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const override =
      localFieldIdParam === undefined
        ? undefined
        : parseInt(localFieldIdParam, 10);
    return this.categoriesService.create(
      dto,
      requireLocalFieldFor(scope, override, 'write'),
    );
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
