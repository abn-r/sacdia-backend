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
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { CamporeeVenuesService } from './camporee-venues.service';
import {
  CreateCamporeeVenueDto,
  ListCamporeeVenuesFilterDto,
  UpdateCamporeeVenueDto,
} from './dto';

@ApiTags('camporee-venues')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CamporeeVenuesController {
  constructor(private readonly service: CamporeeVenuesService) {}

  // =========================================================================
  // Generic venue CRUD
  // =========================================================================

  @Get('camporee-venues')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'List all venues with optional filters' })
  async listVenues(@Query() filters: ListCamporeeVenuesFilterDto) {
    const result = await this.service.listVenues(filters);
    return { status: 'success', ...result };
  }

  @Get('camporee-venues/:venueId')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Get a single venue by ID' })
  @ApiParam({ name: 'venueId', type: Number })
  async getVenue(@Param('venueId', ParseIntPipe) venueId: number) {
    const data = await this.service.getVenueById(venueId);
    return { status: 'success', data };
  }

  @Post('camporee-venues')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'camporee_venue' })
  @ApiOperation({
    summary: 'Create a venue (explicit scope + union/local_field)',
  })
  async createVenue(@Body() dto: CreateCamporeeVenueDto, @Request() req: any) {
    const data = await this.service.createVenue(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('camporee-venues/:venueId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee_venue', idParam: 'venueId' })
  @ApiOperation({ summary: 'Update a venue' })
  @ApiParam({ name: 'venueId', type: Number })
  async updateVenue(
    @Param('venueId', ParseIntPipe) venueId: number,
    @Body() dto: UpdateCamporeeVenueDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateVenue(venueId, dto, req.user.sub);
    return { status: 'success', data };
  }

  @Delete('camporee-venues/:venueId')
  @RequirePermissions('camporee_events:delete')
  @AuthorizationResource({ type: 'camporee_venue', idParam: 'venueId' })
  @ApiOperation({ summary: 'Soft-delete a venue (sets active = false)' })
  @ApiParam({ name: 'venueId', type: Number })
  async deleteVenue(
    @Param('venueId', ParseIntPipe) venueId: number,
    @Request() req: any,
  ) {
    await this.service.deleteVenue(venueId, req.user.sub);
    return { status: 'success' };
  }

  // =========================================================================
  // Camporee-scoped venue list + create
  // =========================================================================

  @Get('local-camporees/:camporeeId/venues')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List venues accessible to a local camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listLocalCamporeeVenues(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listVenuesForCamporee(camporeeId, 'local');
    return { status: 'success', data };
  }

  @Post('local-camporees/:camporeeId/venues')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: "Create a venue scoped to the local camporee's local_field",
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async createLocalCamporeeVenue(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body()
    dto: Omit<CreateCamporeeVenueDto, 'scope' | 'union_id' | 'local_field_id'>,
    @Request() req: any,
  ) {
    const data = await this.service.createVenueForLocalCamporee(
      camporeeId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/venues')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List venues accessible to a union camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listUnionCamporeeVenues(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listVenuesForCamporee(camporeeId, 'union');
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/venues')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: "Create a venue scoped to the union camporee's union",
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  async createUnionCamporeeVenue(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body()
    dto: Omit<CreateCamporeeVenueDto, 'scope' | 'union_id' | 'local_field_id'>,
    @Request() req: any,
  ) {
    const data = await this.service.createVenueForUnionCamporee(
      camporeeId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
