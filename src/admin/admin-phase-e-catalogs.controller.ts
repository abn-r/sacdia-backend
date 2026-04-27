/**
 * AdminPhaseECatalogsController — Phase E i18n admin CRUD endpoints.
 *
 * All endpoints live under /api/v1/admin/* (matching the AdminModule controller prefix).
 * Guards: JwtAuthGuard + GlobalRolesGuard (admin|super_admin) + PermissionsGuard.
 *
 * Endpoint paths (kebab-case, REST-conventional):
 *   GET    /admin/classes
 *   POST   /admin/classes
 *   PATCH  /admin/classes/:id
 *   DELETE /admin/classes/:id
 *
 *   GET    /admin/class-modules
 *   POST   /admin/class-modules
 *   PATCH  /admin/class-modules/:id
 *   DELETE /admin/class-modules/:id
 *
 *   GET    /admin/class-sections
 *   POST   /admin/class-sections
 *   PATCH  /admin/class-sections/:id
 *   DELETE /admin/class-sections/:id
 *
 *   GET    /admin/folders
 *   POST   /admin/folders
 *   PATCH  /admin/folders/:id
 *   DELETE /admin/folders/:id
 *
 *   GET    /admin/folder-modules
 *   POST   /admin/folder-modules
 *   PATCH  /admin/folder-modules/:id
 *   DELETE /admin/folder-modules/:id
 *
 *   GET    /admin/folder-sections
 *   POST   /admin/folder-sections
 *   PATCH  /admin/folder-sections/:id
 *   DELETE /admin/folder-sections/:id
 *
 *   GET    /admin/finance-categories
 *   POST   /admin/finance-categories
 *   PATCH  /admin/finance-categories/:id
 *   DELETE /admin/finance-categories/:id
 *
 *   GET    /admin/inventory-categories
 *   POST   /admin/inventory-categories
 *   PATCH  /admin/inventory-categories/:id
 *   DELETE /admin/inventory-categories/:id
 *
 *   GET    /admin/honors-catalog
 *   POST   /admin/honors-catalog
 *   PATCH  /admin/honors-catalog/:id
 *   DELETE /admin/honors-catalog/:id
 *
 *   GET    /admin/master-honors
 *   POST   /admin/master-honors
 *   PATCH  /admin/master-honors/:id
 *   DELETE /admin/master-honors/:id
 */

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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  AuthorizationResource,
  GlobalRoles,
  RequirePermissions,
} from '../common/decorators';
import {
  JwtAuthGuard,
  GlobalRolesGuard,
  PermissionsGuard,
} from '../common/guards';
import { AdminPhaseECatalogsService } from './admin-phase-e-catalogs.service';
import {
  CreateClassDto,
  UpdateClassDto,
  CreateClassModuleDto,
  UpdateClassModuleDto,
  CreateClassSectionDto,
  UpdateClassSectionDto,
  CreateFolderDto,
  UpdateFolderDto,
  CreateFolderModuleDto,
  UpdateFolderModuleDto,
  CreateFolderSectionDto,
  UpdateFolderSectionDto,
  CreateFinanceCategoryDto,
  UpdateFinanceCategoryDto,
  CreateInventoryCategoryDto,
  UpdateInventoryCategoryDto,
  CreateHonorCatalogDto,
  UpdateHonorCatalogDto,
  CreateMasterHonorDto,
  UpdateMasterHonorDto,
} from './dto/phase-e-catalogs.dto';

@ApiTags('Admin - Phase E Catalogs (i18n)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super_admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin')
export class AdminPhaseECatalogsController {
  constructor(
    private readonly catalogsService: AdminPhaseECatalogsService,
  ) {}

  private getActorId(request: ExpressRequest & { user: { sub: string } }): string {
    return request.user.sub;
  }

  // ==========================================================================
  // CLASSES  →  /admin/classes
  // ==========================================================================

  @Get('classes')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all classes with their full translations (admin editor)' })
  async findAllClasses() {
    const data = await this.catalogsService.findAllClasses();
    return { status: 'success', data };
  }

  @Post('classes')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a class with optional translations' })
  async createClass(
    @Body() dto: CreateClassDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createClass(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('classes/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a class and upsert/delete translations' })
  async updateClass(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateClass(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('classes/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a class (active = false)' })
  async deleteClass(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteClass(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // CLASS MODULES  →  /admin/class-modules
  // ==========================================================================

  @Get('class-modules')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all class modules with their full translations (admin editor)' })
  @ApiQuery({ name: 'classId', required: false, type: Number, description: 'Filter by class_id' })
  async findAllClassModules(@Query('classId') classId?: string) {
    const data = await this.catalogsService.findAllClassModules(
      classId ? Number(classId) : undefined,
    );
    return { status: 'success', data };
  }

  @Post('class-modules')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a class module with optional translations' })
  async createClassModule(
    @Body() dto: CreateClassModuleDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createClassModule(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('class-modules/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a class module and upsert/delete translations' })
  async updateClassModule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassModuleDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateClassModule(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('class-modules/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a class module (active = false)' })
  async deleteClassModule(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteClassModule(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // CLASS SECTIONS  →  /admin/class-sections
  // ==========================================================================

  @Get('class-sections')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all class sections with their full translations (admin editor)' })
  @ApiQuery({ name: 'moduleId', required: false, type: Number, description: 'Filter by module_id' })
  async findAllClassSections(@Query('moduleId') moduleId?: string) {
    const data = await this.catalogsService.findAllClassSections(
      moduleId ? Number(moduleId) : undefined,
    );
    return { status: 'success', data };
  }

  @Post('class-sections')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a class section with optional translations' })
  async createClassSection(
    @Body() dto: CreateClassSectionDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createClassSection(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('class-sections/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a class section and upsert/delete translations' })
  async updateClassSection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassSectionDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateClassSection(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('class-sections/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a class section (active = false)' })
  async deleteClassSection(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteClassSection(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // FOLDERS  →  /admin/folders
  // ==========================================================================

  @Get('folders')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all folders with their full translations (admin editor)' })
  async findAllFolders() {
    const data = await this.catalogsService.findAllFolders();
    return { status: 'success', data };
  }

  @Post('folders')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a folder with optional translations' })
  async createFolder(
    @Body() dto: CreateFolderDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createFolder(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('folders/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a folder and upsert/delete translations' })
  async updateFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFolderDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateFolder(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('folders/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a folder (active = false)' })
  async deleteFolder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteFolder(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // FOLDER MODULES  →  /admin/folder-modules
  // ==========================================================================

  @Get('folder-modules')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all folder modules with their full translations (admin editor)' })
  @ApiQuery({ name: 'folderId', required: false, type: Number, description: 'Filter by folder_id' })
  async findAllFolderModules(@Query('folderId') folderId?: string) {
    const data = await this.catalogsService.findAllFolderModules(
      folderId ? Number(folderId) : undefined,
    );
    return { status: 'success', data };
  }

  @Post('folder-modules')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a folder module with optional translations' })
  async createFolderModule(
    @Body() dto: CreateFolderModuleDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createFolderModule(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('folder-modules/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a folder module and upsert/delete translations' })
  async updateFolderModule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFolderModuleDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateFolderModule(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('folder-modules/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a folder module (active = false)' })
  async deleteFolderModule(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteFolderModule(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // FOLDER SECTIONS  →  /admin/folder-sections
  // ==========================================================================

  @Get('folder-sections')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all folder sections with their full translations (admin editor)' })
  @ApiQuery({ name: 'moduleId', required: false, type: Number, description: 'Filter by module_id (folder_module_id)' })
  async findAllFolderSections(@Query('moduleId') moduleId?: string) {
    const data = await this.catalogsService.findAllFolderSections(
      moduleId ? Number(moduleId) : undefined,
    );
    return { status: 'success', data };
  }

  @Post('folder-sections')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a folder section with optional translations' })
  async createFolderSection(
    @Body() dto: CreateFolderSectionDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createFolderSection(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('folder-sections/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a folder section and upsert/delete translations' })
  async updateFolderSection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFolderSectionDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateFolderSection(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('folder-sections/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a folder section (active = false)' })
  async deleteFolderSection(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteFolderSection(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // FINANCE CATEGORIES  →  /admin/finance-categories
  // ==========================================================================

  @Get('finance-categories')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all finance categories with their full translations (admin editor)' })
  async findAllFinanceCategories() {
    const data = await this.catalogsService.findAllFinanceCategories();
    return { status: 'success', data };
  }

  @Post('finance-categories')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create a finance category with optional translations' })
  async createFinanceCategory(
    @Body() dto: CreateFinanceCategoryDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createFinanceCategory(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('finance-categories/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update a finance category and upsert/delete translations' })
  async updateFinanceCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFinanceCategoryDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateFinanceCategory(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('finance-categories/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete a finance category (active = false)' })
  async deleteFinanceCategory(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteFinanceCategory(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // INVENTORY CATEGORIES  →  /admin/inventory-categories
  // ==========================================================================

  @Get('inventory-categories')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List all inventory categories with their full translations (admin editor)' })
  async findAllInventoryCategories() {
    const data = await this.catalogsService.findAllInventoryCategories();
    return { status: 'success', data };
  }

  @Post('inventory-categories')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create an inventory category with optional translations' })
  async createInventoryCategory(
    @Body() dto: CreateInventoryCategoryDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createInventoryCategory(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('inventory-categories/:id')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update an inventory category and upsert/delete translations' })
  async updateInventoryCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventoryCategoryDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateInventoryCategory(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('inventory-categories/:id')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft-delete an inventory category (active = false)' })
  async deleteInventoryCategory(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteInventoryCategory(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // HONORS CATALOG  →  /admin/honors-catalog
  // NOTE: Path avoids conflict with existing /admin/honors (requirements/review)
  // ==========================================================================

  @Get('honors-catalog')
  @RequirePermissions('honors:read')
  @ApiOperation({ summary: 'List all honors with their full translations (admin editor)' })
  async findAllHonors() {
    const data = await this.catalogsService.findAllHonors();
    return { status: 'success', data };
  }

  @Post('honors-catalog')
  @RequirePermissions('honors:create')
  @ApiOperation({ summary: 'Create an honor with optional translations' })
  async createHonor(
    @Body() dto: CreateHonorCatalogDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createHonor(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('honors-catalog/:id')
  @RequirePermissions('honors:update')
  @ApiOperation({ summary: 'Update an honor and upsert/delete translations' })
  async updateHonor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHonorCatalogDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateHonor(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('honors-catalog/:id')
  @RequirePermissions('honors:delete')
  @ApiOperation({ summary: 'Soft-delete an honor (active = false)' })
  async deleteHonor(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteHonor(id, this.getActorId(req));
    return { status: 'success', data };
  }

  // ==========================================================================
  // MASTER HONORS  →  /admin/master-honors
  // ==========================================================================

  @Get('master-honors')
  @RequirePermissions('honors:read')
  @ApiOperation({ summary: 'List all master honors with their full translations (admin editor)' })
  async findAllMasterHonors() {
    const data = await this.catalogsService.findAllMasterHonors();
    return { status: 'success', data };
  }

  @Post('master-honors')
  @RequirePermissions('honors:create')
  @ApiOperation({ summary: 'Create a master honor with optional translations' })
  async createMasterHonor(
    @Body() dto: CreateMasterHonorDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.createMasterHonor(dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Patch('master-honors/:id')
  @RequirePermissions('honors:update')
  @ApiOperation({ summary: 'Update a master honor and upsert/delete translations' })
  async updateMasterHonor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMasterHonorDto,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.updateMasterHonor(id, dto, this.getActorId(req));
    return { status: 'success', data };
  }

  @Delete('master-honors/:id')
  @RequirePermissions('honors:delete')
  @ApiOperation({ summary: 'Soft-delete a master honor (active = false)' })
  async deleteMasterHonor(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.catalogsService.deleteMasterHonor(id, this.getActorId(req));
    return { status: 'success', data };
  }
}
