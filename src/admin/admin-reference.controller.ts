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
import { GlobalRoles } from '../common/decorators/global-roles.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
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
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('super_admin', 'admin')
@Controller('admin')
export class AdminReferenceController {
  constructor(private readonly referenceService: AdminReferenceService) {}

  @Get('relationship-types')
  @ApiOperation({ summary: 'List relationship types for admin management' })
  async listRelationshipTypes() {
    const data = await this.referenceService.listRelationshipTypes();
    return { status: 'success', data };
  }

  @Post('relationship-types')
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
  @ApiOperation({ summary: 'List allergies for admin management' })
  async listAllergies() {
    const data = await this.referenceService.listAllergies();
    return { status: 'success', data };
  }

  @Post('allergies')
  @ApiOperation({ summary: 'Create allergy' })
  async createAllergy(@Body() dto: CreateAllergyDto, @Request() req) {
    const data = await this.referenceService.createAllergy(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('allergies/:allergyId')
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
  @ApiOperation({ summary: 'List diseases for admin management' })
  async listDiseases() {
    const data = await this.referenceService.listDiseases();
    return { status: 'success', data };
  }

  @Post('diseases')
  @ApiOperation({ summary: 'Create disease' })
  async createDisease(@Body() dto: CreateDiseaseDto, @Request() req) {
    const data = await this.referenceService.createDisease(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('diseases/:diseaseId')
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
  @ApiOperation({ summary: 'List ecclesiastical years for admin management' })
  async listEcclesiasticalYears() {
    const data = await this.referenceService.listEcclesiasticalYears();
    return { status: 'success', data };
  }

  @Post('ecclesiastical-years')
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
