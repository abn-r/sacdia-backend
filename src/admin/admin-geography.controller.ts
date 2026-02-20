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
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GlobalRoles } from '../common/decorators/global-roles.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { AdminGeographyService } from './admin-geography.service';
import {
  CreateChurchDto,
  CreateCountryDto,
  CreateDistrictDto,
  CreateLocalFieldDto,
  CreateUnionDto,
  UpdateChurchDto,
  UpdateCountryDto,
  UpdateDistrictDto,
  UpdateLocalFieldDto,
  UpdateUnionDto,
} from './dto';

@ApiTags('admin-geography')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('super_admin', 'admin')
@Controller('admin')
export class AdminGeographyController {
  constructor(private readonly geographyService: AdminGeographyService) {}

  @Get('countries')
  @ApiOperation({ summary: 'List countries for admin management' })
  async listCountries() {
    const data = await this.geographyService.listCountries();
    return { status: 'success', data };
  }

  @Post('countries')
  @ApiOperation({ summary: 'Create country' })
  async createCountry(@Body() dto: CreateCountryDto, @Request() req) {
    const data = await this.geographyService.createCountry(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('countries/:countryId')
  @ApiOperation({ summary: 'Update country' })
  async updateCountry(
    @Param('countryId', ParseIntPipe) countryId: number,
    @Body() dto: UpdateCountryDto,
    @Request() req,
  ) {
    const data = await this.geographyService.updateCountry(
      countryId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('countries/:countryId')
  @ApiOperation({ summary: 'Soft delete country' })
  async deleteCountry(
    @Param('countryId', ParseIntPipe) countryId: number,
    @Request() req,
  ) {
    const data = await this.geographyService.deleteCountry(
      countryId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('unions')
  @ApiOperation({ summary: 'List unions for admin management' })
  @ApiQuery({ name: 'countryId', required: false, type: Number })
  async listUnions(
    @Query('countryId', new ParseIntPipe({ optional: true }))
    countryId?: number,
  ) {
    const data = await this.geographyService.listUnions(countryId);
    return { status: 'success', data };
  }

  @Post('unions')
  @ApiOperation({ summary: 'Create union' })
  async createUnion(@Body() dto: CreateUnionDto, @Request() req) {
    const data = await this.geographyService.createUnion(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('unions/:unionId')
  @ApiOperation({ summary: 'Update union' })
  async updateUnion(
    @Param('unionId', ParseIntPipe) unionId: number,
    @Body() dto: UpdateUnionDto,
    @Request() req,
  ) {
    const data = await this.geographyService.updateUnion(
      unionId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('unions/:unionId')
  @ApiOperation({ summary: 'Soft delete union' })
  async deleteUnion(
    @Param('unionId', ParseIntPipe) unionId: number,
    @Request() req,
  ) {
    const data = await this.geographyService.deleteUnion(unionId, req.user.sub);
    return { status: 'success', data };
  }

  @Get('local-fields')
  @ApiOperation({ summary: 'List local fields for admin management' })
  @ApiQuery({ name: 'unionId', required: false, type: Number })
  async listLocalFields(
    @Query('unionId', new ParseIntPipe({ optional: true }))
    unionId?: number,
  ) {
    const data = await this.geographyService.listLocalFields(unionId);
    return { status: 'success', data };
  }

  @Post('local-fields')
  @ApiOperation({ summary: 'Create local field' })
  async createLocalField(@Body() dto: CreateLocalFieldDto, @Request() req) {
    const data = await this.geographyService.createLocalField(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('local-fields/:localFieldId')
  @ApiOperation({ summary: 'Update local field' })
  async updateLocalField(
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: UpdateLocalFieldDto,
    @Request() req,
  ) {
    const data = await this.geographyService.updateLocalField(
      localFieldId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('local-fields/:localFieldId')
  @ApiOperation({ summary: 'Soft delete local field' })
  async deleteLocalField(
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Request() req,
  ) {
    const data = await this.geographyService.deleteLocalField(
      localFieldId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('districts')
  @ApiOperation({ summary: 'List districts for admin management' })
  @ApiQuery({ name: 'localFieldId', required: false, type: Number })
  async listDistricts(
    @Query('localFieldId', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
  ) {
    const data = await this.geographyService.listDistricts(localFieldId);
    return { status: 'success', data };
  }

  @Post('districts')
  @ApiOperation({ summary: 'Create district' })
  async createDistrict(@Body() dto: CreateDistrictDto, @Request() req) {
    const data = await this.geographyService.createDistrict(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('districts/:districtId')
  @ApiOperation({ summary: 'Update district' })
  async updateDistrict(
    @Param('districtId', ParseIntPipe) districtId: number,
    @Body() dto: UpdateDistrictDto,
    @Request() req,
  ) {
    const data = await this.geographyService.updateDistrict(
      districtId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('districts/:districtId')
  @ApiOperation({ summary: 'Soft delete district' })
  async deleteDistrict(
    @Param('districtId', ParseIntPipe) districtId: number,
    @Request() req,
  ) {
    const data = await this.geographyService.deleteDistrict(
      districtId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('churches')
  @ApiOperation({ summary: 'List churches for admin management' })
  @ApiQuery({ name: 'districtId', required: false, type: Number })
  async listChurches(
    @Query('districtId', new ParseIntPipe({ optional: true }))
    districtId?: number,
  ) {
    const data = await this.geographyService.listChurches(districtId);
    return { status: 'success', data };
  }

  @Post('churches')
  @ApiOperation({ summary: 'Create church' })
  async createChurch(@Body() dto: CreateChurchDto, @Request() req) {
    const data = await this.geographyService.createChurch(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('churches/:churchId')
  @ApiOperation({ summary: 'Update church' })
  async updateChurch(
    @Param('churchId', ParseIntPipe) churchId: number,
    @Body() dto: UpdateChurchDto,
    @Request() req,
  ) {
    const data = await this.geographyService.updateChurch(
      churchId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('churches/:churchId')
  @ApiOperation({ summary: 'Soft delete church' })
  async deleteChurch(
    @Param('churchId', ParseIntPipe) churchId: number,
    @Request() req,
  ) {
    const data = await this.geographyService.deleteChurch(churchId, req.user.sub);
    return { status: 'success', data };
  }
}
