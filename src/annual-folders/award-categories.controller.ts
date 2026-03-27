import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { AwardCategoriesService } from './award-categories.service';
import { CreateAwardCategoryDto } from './dto/create-award-category.dto';
import { UpdateAwardCategoryDto } from './dto/update-award-category.dto';
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('Award Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('award-categories')
export class AwardCategoriesController {
  constructor(private readonly service: AwardCategoriesService) {}

  @Post()
  @RequirePermissions('award_categories:create')
  @ApiOperation({ summary: 'Create an award category' })
  @ApiResponse({ status: 201, description: 'Award category created' })
  @ApiResponse({ status: 404, description: 'Club type not found' })
  async create(@Body() dto: CreateAwardCategoryDto) {
    const data = await this.service.create(dto);
    return { status: 'success', data };
  }

  @Get()
  @RequirePermissions('award_categories:read')
  @ApiOperation({
    summary: 'List award categories with optional filters',
    description:
      'Returns categories sorted by order ASC, then name ASC. ' +
      'club_type_id=null records are included when filtering by club_type_id unless excluded explicitly. ' +
      'active defaults to true.',
  })
  @ApiQuery({
    name: 'club_type_id',
    required: false,
    description: 'Filter by club type ID (omit to get all)',
    example: 2,
  })
  @ApiQuery({
    name: 'active',
    required: false,
    description: 'Filter by active status (default: true)',
    example: true,
  })
  @ApiResponse({ status: 200, description: 'List of award categories' })
  async findAll(
    @Query('club_type_id') clubTypeId?: string,
    @Query('active') active?: string,
  ) {
    const clubTypeIdParsed =
      clubTypeId !== undefined ? parseInt(clubTypeId, 10) : undefined;
    const activeParsed = active !== undefined ? active === 'true' : undefined;

    const data = await this.service.findAll(clubTypeIdParsed, activeParsed);
    return { status: 'success', data };
  }

  @Get(':categoryId')
  @RequirePermissions('award_categories:read')
  @ApiOperation({ summary: 'Get a single award category by ID' })
  @ApiParam({ name: 'categoryId', description: 'Award category UUID' })
  @ApiResponse({ status: 200, description: 'Award category details' })
  @ApiResponse({ status: 404, description: 'Award category not found' })
  async findOne(@Param('categoryId', ParseUUIDPipe) categoryId: string) {
    const data = await this.service.findOne(categoryId);
    return { status: 'success', data };
  }

  @Patch(':categoryId')
  @RequirePermissions('award_categories:update')
  @ApiOperation({ summary: 'Update an award category' })
  @ApiParam({ name: 'categoryId', description: 'Award category UUID' })
  @ApiResponse({ status: 200, description: 'Award category updated' })
  @ApiResponse({
    status: 404,
    description: 'Award category or club type not found',
  })
  async update(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateAwardCategoryDto,
  ) {
    const data = await this.service.update(categoryId, dto);
    return { status: 'success', data };
  }

  @Delete(':categoryId')
  @RequirePermissions('award_categories:delete')
  @ApiOperation({
    summary: 'Deactivate an award category (soft delete)',
    description:
      'Sets active=false. The category is never hard-deleted to preserve historical scoring references.',
  })
  @ApiParam({ name: 'categoryId', description: 'Award category UUID' })
  @ApiResponse({ status: 200, description: 'Award category deactivated' })
  @ApiResponse({ status: 404, description: 'Award category not found' })
  async remove(@Param('categoryId', ParseUUIDPipe) categoryId: string) {
    const data = await this.service.remove(categoryId);
    return { status: 'success', ...data };
  }
}
