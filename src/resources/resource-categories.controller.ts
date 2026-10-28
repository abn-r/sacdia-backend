import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
} from '../common/decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CreateResourceCategoryDto } from './dto/create-resource-category.dto';
import { UpdateResourceCategoryDto } from './dto/update-resource-category.dto';
import { ResourceCategoriesService } from './resource-categories.service';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';

@ApiTags('resource-categories')
@Controller('resource-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@ApiBearerAuth()
export class ResourceCategoriesController {
  constructor(
    private readonly service: ResourceCategoriesService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Post()
  @RequirePermissions('resource_categories:create')
  @ApiOperation({ summary: 'Crear categoría de recurso' })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — requires resource_categories:create',
  })
  async create(@Body() dto: CreateResourceCategoryDto) {
    const data = await this.service.create(dto);
    return { status: 'success', data };
  }

  @ActingScope('member:read')
  @Get()
  @RequirePermissions('resource_categories:read')
  @ApiOperation({
    summary:
      'Listar categorías de recursos. Por defecto solo activas; includeInactive=true las incluye todas para quien tiene resource_categories:update (se ignora para los demás).',
  })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires resource_categories:read',
  })
  async findAll(
    @CurrentUser() user: { user_id: string },
    @Query('includeInactive') includeInactive?: string,
  ) {
    const data = await this.service.findAll({
      includeInactive:
        includeInactive === 'true' && (await this.canManage(user.user_id)),
    });
    return { status: 'success', data };
  }

  /** Only category managers see deactivated categories. */
  private async canManage(userId: string): Promise<boolean> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    return resolved.authorization.effective.permissions.includes(
      'resource_categories:update',
    );
  }

  @ActingScope('member:read')
  @Get(':id')
  @RequirePermissions('resource_categories:read')
  @ApiOperation({ summary: 'Obtener categoría de recurso por ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría encontrada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions — requires resource_categories:read',
  })
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
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — requires resource_categories:update',
  })
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
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Insufficient permissions — requires resource_categories:delete',
  })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.remove(id);
    return { status: 'success', data };
  }
}
