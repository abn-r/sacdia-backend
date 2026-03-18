import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AdminReferenceService } from './admin-reference.service';
import {
  CreateAllergyDto,
  CreateDiseaseDto,
  CreateEcclesiasticalYearDto,
  CreateHonorCategoryDto,
  HonorCategoryListQueryDto,
  CreateMedicineDto,
  CreateRelationshipTypeDto,
  UpdateAllergyDto,
  UpdateDiseaseDto,
  UpdateEcclesiasticalYearDto,
  UpdateHonorCategoryDto,
  UpdateMedicineDto,
  UpdateRelationshipTypeDto,
} from './dto';

@ApiTags('admin-reference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminReferenceController {
  constructor(private readonly referenceService: AdminReferenceService) {}

  private getActorId(request: ExpressRequest & { user: { sub: string } }) {
    return request.user.sub;
  }

  @Get('relationship-types')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List relationship types for admin management' })
  async listRelationshipTypes() {
    const data = await this.referenceService.listRelationshipTypes();
    return { status: 'success', data };
  }

  @Post('relationship-types')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create relationship type' })
  async createRelationshipType(
    @Body() dto: CreateRelationshipTypeDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createRelationshipType(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Patch('relationship-types/:relationshipTypeId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update relationship type' })
  async updateRelationshipType(
    @Param('relationshipTypeId', ParseUUIDPipe) relationshipTypeId: string,
    @Body() dto: UpdateRelationshipTypeDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateRelationshipType(
      relationshipTypeId,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('relationship-types/:relationshipTypeId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete relationship type' })
  async deleteRelationshipType(
    @Param('relationshipTypeId', ParseUUIDPipe) relationshipTypeId: string,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteRelationshipType(
      relationshipTypeId,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('allergies')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List allergies for admin management' })
  async listAllergies() {
    const data = await this.referenceService.listAllergies();
    return { status: 'success', data };
  }

  @Post('allergies')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create allergy' })
  async createAllergy(
    @Body() dto: CreateAllergyDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createAllergy(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Patch('allergies/:allergyId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update allergy' })
  async updateAllergy(
    @Param('allergyId', ParseIntPipe) allergyId: number,
    @Body() dto: UpdateAllergyDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateAllergy(
      allergyId,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('allergies/:allergyId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete allergy' })
  async deleteAllergy(
    @Param('allergyId', ParseIntPipe) allergyId: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteAllergy(
      allergyId,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('diseases')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List diseases for admin management' })
  async listDiseases() {
    const data = await this.referenceService.listDiseases();
    return { status: 'success', data };
  }

  @Post('diseases')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create disease' })
  async createDisease(
    @Body() dto: CreateDiseaseDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createDisease(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Patch('diseases/:diseaseId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update disease' })
  async updateDisease(
    @Param('diseaseId', ParseIntPipe) diseaseId: number,
    @Body() dto: UpdateDiseaseDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateDisease(
      diseaseId,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('diseases/:diseaseId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete disease' })
  async deleteDisease(
    @Param('diseaseId', ParseIntPipe) diseaseId: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteDisease(
      diseaseId,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('honor-categories')
  @RequirePermissions('honor_categories:read')
  @ApiOperation({ summary: 'List honor categories for admin management' })
  async listHonorCategories(@Query() query: HonorCategoryListQueryDto) {
    const data = await this.referenceService.listHonorCategories(query);
    return { status: 'success', data };
  }

  @Post('honor-categories')
  @RequirePermissions('honor_categories:create')
  @ApiOperation({ summary: 'Create honor category' })
  async createHonorCategory(
    @Body() dto: CreateHonorCategoryDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createHonorCategory(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('honor-categories/:id')
  @RequirePermissions('honor_categories:read')
  @ApiOperation({ summary: 'Get honor category by ID' })
  async getHonorCategory(@Param('id', ParseIntPipe) id: number) {
    const data = await this.referenceService.getHonorCategory(id);
    return { status: 'success', data };
  }

  @Patch('honor-categories/:id')
  @RequirePermissions('honor_categories:update')
  @ApiOperation({ summary: 'Update honor category' })
  async updateHonorCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHonorCategoryDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateHonorCategory(
      id,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('honor-categories/:id')
  @RequirePermissions('honor_categories:delete')
  @ApiOperation({ summary: 'Soft delete honor category' })
  async deleteHonorCategory(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteHonorCategory(
      id,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('medicines')
  @RequirePermissions('catalogs:read')
  @ApiOperation({ summary: 'List medicines for admin management' })
  async listMedicines() {
    const data = await this.referenceService.listMedicines();
    return { status: 'success', data };
  }

  @Post('medicines')
  @RequirePermissions('catalogs:create')
  @ApiOperation({ summary: 'Create medicine' })
  async createMedicine(
    @Body() dto: CreateMedicineDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createMedicine(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Patch('medicines/:medicineId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update medicine' })
  async updateMedicine(
    @Param('medicineId', ParseIntPipe) medicineId: number,
    @Body() dto: UpdateMedicineDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateMedicine(
      medicineId,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('medicines/:medicineId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete medicine' })
  async deleteMedicine(
    @Param('medicineId', ParseIntPipe) medicineId: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteMedicine(
      medicineId,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Get('ecclesiastical-years')
  @RequirePermissions('ecclesiastical_years:read')
  @ApiOperation({ summary: 'List ecclesiastical years for admin management' })
  async listEcclesiasticalYears() {
    const data = await this.referenceService.listEcclesiasticalYears();
    return { status: 'success', data };
  }

  @Post('ecclesiastical-years')
  @RequirePermissions('ecclesiastical_years:create')
  @ApiOperation({ summary: 'Create ecclesiastical year' })
  async createEcclesiasticalYear(
    @Body() dto: CreateEcclesiasticalYearDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.createEcclesiasticalYear(
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Patch('ecclesiastical-years/:yearId')
  @RequirePermissions('ecclesiastical_years:update')
  @ApiOperation({ summary: 'Update ecclesiastical year' })
  async updateEcclesiasticalYear(
    @Param('yearId', ParseIntPipe) yearId: number,
    @Body() dto: UpdateEcclesiasticalYearDto,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.updateEcclesiasticalYear(
      yearId,
      dto,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }

  @Delete('ecclesiastical-years/:yearId')
  @RequirePermissions('ecclesiastical_years:update')
  @ApiOperation({ summary: 'Soft delete ecclesiastical year' })
  async deleteEcclesiasticalYear(
    @Param('yearId', ParseIntPipe) yearId: number,
    @Request() req: ExpressRequest & { user: { sub: string } },
  ) {
    const data = await this.referenceService.deleteEcclesiasticalYear(
      yearId,
      this.getActorId(req),
    );
    return { status: 'success', data };
  }
}
