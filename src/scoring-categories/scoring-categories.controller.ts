import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ScoringCategoriesService } from './scoring-categories.service';
import {
  CreateScoringCategoryDto,
  UpdateScoringCategoryDto,
} from './dto/scoring-categories.dto';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  GlobalRoles,
  RequirePermissions,
} from '../common/decorators';
import { GlobalRolesGuard } from '../common/guards';

@ApiTags('scoring-categories')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ScoringCategoriesController {
  constructor(
    private readonly scoringCategoriesService: ScoringCategoriesService,
  ) {}

  // ========================================
  // DIVISION LEVEL (admin / super_admin only)
  // ========================================

  @Get('divisions/scoring-categories')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({ summary: 'Listar categorías de puntuación a nivel división' })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  async findDivisionCategories() {
    return this.scoringCategoriesService.findDivisionCategories();
  }

  @Post('divisions/scoring-categories')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({ summary: 'Crear categoría de puntuación a nivel división' })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  async createDivisionCategory(@Body() dto: CreateScoringCategoryDto) {
    return this.scoringCategoriesService.createDivisionCategory(dto);
  }

  @Patch('divisions/scoring-categories/:id')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({ summary: 'Actualizar categoría de puntuación a nivel división' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría actualizada' })
  @ApiResponse({ status: 403, description: 'No puede modificar categoría de otro nivel' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async updateDivisionCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScoringCategoryDto,
  ) {
    return this.scoringCategoriesService.updateDivisionCategory(id, dto);
  }

  @Delete('divisions/scoring-categories/:id')
  @UseGuards(GlobalRolesGuard)
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({ summary: 'Desactivar categoría de puntuación a nivel división (soft delete)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría desactivada' })
  @ApiResponse({ status: 403, description: 'No puede eliminar categoría de otro nivel' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async deleteDivisionCategory(@Param('id', ParseIntPipe) id: number) {
    return this.scoringCategoriesService.deleteDivisionCategory(id);
  }

  // ========================================
  // UNION LEVEL
  // ========================================

  @Get('unions/:unionId/scoring-categories')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:read')
  @ApiOperation({ summary: 'Listar categorías de puntuación para una unión (heredadas + propias)' })
  @ApiParam({ name: 'unionId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  async findUnionCategories(
    @Param('unionId', ParseIntPipe) unionId: number,
  ) {
    return this.scoringCategoriesService.findUnionCategories(unionId);
  }

  @Post('unions/:unionId/scoring-categories')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Crear categoría de puntuación para una unión' })
  @ApiParam({ name: 'unionId', type: Number })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  @ApiResponse({ status: 403, description: 'Sin permisos para esta unión' })
  async createUnionCategory(
    @Param('unionId', ParseIntPipe) unionId: number,
    @Body() dto: CreateScoringCategoryDto,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.createUnionCategory(
      unionId,
      dto,
      req.user.sub,
    );
  }

  @Patch('unions/:unionId/scoring-categories/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Actualizar categoría de puntuación propia de una unión' })
  @ApiParam({ name: 'unionId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría actualizada' })
  @ApiResponse({ status: 403, description: 'No puede modificar categoría heredada o de otra unión' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async updateUnionCategory(
    @Param('unionId', ParseIntPipe) unionId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScoringCategoryDto,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.updateUnionCategory(
      unionId,
      id,
      dto,
      req.user.sub,
    );
  }

  @Delete('unions/:unionId/scoring-categories/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Desactivar categoría de puntuación propia de una unión (soft delete)' })
  @ApiParam({ name: 'unionId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría desactivada' })
  @ApiResponse({ status: 403, description: 'No puede eliminar categoría heredada o de otra unión' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async deleteUnionCategory(
    @Param('unionId', ParseIntPipe) unionId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.deleteUnionCategory(
      unionId,
      id,
      req.user.sub,
    );
  }

  // ========================================
  // LOCAL FIELD LEVEL
  // ========================================

  @Get('local-fields/:fieldId/scoring-categories')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:read')
  @ApiOperation({ summary: 'Listar categorías de puntuación para un campo local (división + unión + propias)' })
  @ApiParam({ name: 'fieldId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  async findLocalFieldCategories(
    @Param('fieldId', ParseIntPipe) fieldId: number,
  ) {
    return this.scoringCategoriesService.findLocalFieldCategories(fieldId);
  }

  @Post('local-fields/:fieldId/scoring-categories')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Crear categoría de puntuación para un campo local' })
  @ApiParam({ name: 'fieldId', type: Number })
  @ApiResponse({ status: 201, description: 'Categoría creada' })
  @ApiResponse({ status: 403, description: 'Sin permisos para este campo local' })
  async createLocalFieldCategory(
    @Param('fieldId', ParseIntPipe) fieldId: number,
    @Body() dto: CreateScoringCategoryDto,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.createLocalFieldCategory(
      fieldId,
      dto,
      req.user.sub,
    );
  }

  @Patch('local-fields/:fieldId/scoring-categories/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Actualizar categoría de puntuación propia de un campo local' })
  @ApiParam({ name: 'fieldId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría actualizada' })
  @ApiResponse({ status: 403, description: 'No puede modificar categoría heredada o de otro campo local' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async updateLocalFieldCategory(
    @Param('fieldId', ParseIntPipe) fieldId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScoringCategoryDto,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.updateLocalFieldCategory(
      fieldId,
      id,
      dto,
      req.user.sub,
    );
  }

  @Delete('local-fields/:fieldId/scoring-categories/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('units:update')
  @ApiOperation({ summary: 'Desactivar categoría de puntuación propia de un campo local (soft delete)' })
  @ApiParam({ name: 'fieldId', type: Number })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Categoría desactivada' })
  @ApiResponse({ status: 403, description: 'No puede eliminar categoría heredada o de otro campo local' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  async deleteLocalFieldCategory(
    @Param('fieldId', ParseIntPipe) fieldId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.scoringCategoriesService.deleteLocalFieldCategory(
      fieldId,
      id,
      req.user.sub,
    );
  }
}
