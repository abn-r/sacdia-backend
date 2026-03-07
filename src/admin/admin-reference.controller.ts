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
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AdminReferenceService } from './admin-reference.service';
import {
  CreateAllergyDto,
  CreateDiseaseDto,
  CreateEcclesiasticalYearDto,
  CreateRelationshipTypeDto,
  UpdateAllergyDto,
  UpdateDiseaseDto,
  UpdateEcclesiasticalYearDto,
  UpdateRelationshipTypeDto,
} from './dto';

@ApiTags('admin-reference')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminReferenceController {
  constructor(private readonly referenceService: AdminReferenceService) {}

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
    @Request() req,
  ) {
    const data = await this.referenceService.createRelationshipType(
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch('relationship-types/:relationshipTypeId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update relationship type' })
  async updateRelationshipType(
    @Param('relationshipTypeId', ParseUUIDPipe) relationshipTypeId: string,
    @Body() dto: UpdateRelationshipTypeDto,
    @Request() req,
  ) {
    const data = await this.referenceService.updateRelationshipType(
      relationshipTypeId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('relationship-types/:relationshipTypeId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete relationship type' })
  async deleteRelationshipType(
    @Param('relationshipTypeId', ParseUUIDPipe) relationshipTypeId: string,
    @Request() req,
  ) {
    const data = await this.referenceService.deleteRelationshipType(
      relationshipTypeId,
      req.user.sub,
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
  async createAllergy(@Body() dto: CreateAllergyDto, @Request() req) {
    const data = await this.referenceService.createAllergy(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('allergies/:allergyId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update allergy' })
  async updateAllergy(
    @Param('allergyId', ParseIntPipe) allergyId: number,
    @Body() dto: UpdateAllergyDto,
    @Request() req,
  ) {
    const data = await this.referenceService.updateAllergy(
      allergyId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('allergies/:allergyId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete allergy' })
  async deleteAllergy(
    @Param('allergyId', ParseIntPipe) allergyId: number,
    @Request() req,
  ) {
    const data = await this.referenceService.deleteAllergy(
      allergyId,
      req.user.sub,
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
  async createDisease(@Body() dto: CreateDiseaseDto, @Request() req) {
    const data = await this.referenceService.createDisease(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('diseases/:diseaseId')
  @RequirePermissions('catalogs:update')
  @ApiOperation({ summary: 'Update disease' })
  async updateDisease(
    @Param('diseaseId', ParseIntPipe) diseaseId: number,
    @Body() dto: UpdateDiseaseDto,
    @Request() req,
  ) {
    const data = await this.referenceService.updateDisease(
      diseaseId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('diseases/:diseaseId')
  @RequirePermissions('catalogs:delete')
  @ApiOperation({ summary: 'Soft delete disease' })
  async deleteDisease(
    @Param('diseaseId', ParseIntPipe) diseaseId: number,
    @Request() req,
  ) {
    const data = await this.referenceService.deleteDisease(
      diseaseId,
      req.user.sub,
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
    @Request() req,
  ) {
    const data = await this.referenceService.createEcclesiasticalYear(
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch('ecclesiastical-years/:yearId')
  @RequirePermissions('ecclesiastical_years:update')
  @ApiOperation({ summary: 'Update ecclesiastical year' })
  async updateEcclesiasticalYear(
    @Param('yearId', ParseIntPipe) yearId: number,
    @Body() dto: UpdateEcclesiasticalYearDto,
    @Request() req,
  ) {
    const data = await this.referenceService.updateEcclesiasticalYear(
      yearId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('ecclesiastical-years/:yearId')
  @RequirePermissions('ecclesiastical_years:update')
  @ApiOperation({ summary: 'Soft delete ecclesiastical year' })
  async deleteEcclesiasticalYear(
    @Param('yearId', ParseIntPipe) yearId: number,
    @Request() req,
  ) {
    const data = await this.referenceService.deleteEcclesiasticalYear(
      yearId,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
