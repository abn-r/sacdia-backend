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
import { CamporeeEventsService } from './camporee-events.service';
import {
  CloneFromTemplateDto,
  CreateCamporeeEventDto,
  ListCamporeeEventsFilterDto,
  ReorderCamporeeEventDto,
  UpdateCamporeeEventDto,
} from './dto';

@ApiTags('camporee-events')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CamporeeEventsController {
  constructor(private readonly service: CamporeeEventsService) {}

  // =========================================================================
  // LOCAL CAMPOREE events
  // =========================================================================

  @Get('local-camporees/:camporeeId/events')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List events for a local camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listLocalEvents(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() filters: ListCamporeeEventsFilterDto,
  ) {
    const result = await this.service.listEvents(camporeeId, 'local', filters);
    return { status: 'success', ...result };
  }

  @Post('local-camporees/:camporeeId/events')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Create custom event for a local camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async createLocalEvent(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateCamporeeEventDto,
    @Request() req: any,
  ) {
    const data = await this.service.createEvent(
      camporeeId,
      'local',
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Post('local-camporees/:camporeeId/events/from-template/:templateId')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Clone a template as an event for a local camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'templateId', type: Number })
  async cloneLocalFromTemplate(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: CloneFromTemplateDto,
    @Request() req: any,
  ) {
    const data = await this.service.createFromTemplate(
      camporeeId,
      'local',
      templateId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  // =========================================================================
  // UNION CAMPOREE events
  // =========================================================================

  @Get('union-camporees/:camporeeId/events')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'List events for a union camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async listUnionEvents(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() filters: ListCamporeeEventsFilterDto,
  ) {
    const result = await this.service.listEvents(camporeeId, 'union', filters);
    return { status: 'success', ...result };
  }

  @Post('union-camporees/:camporeeId/events')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Create custom event for a union camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  async createUnionEvent(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: CreateCamporeeEventDto,
    @Request() req: any,
  ) {
    const data = await this.service.createEvent(
      camporeeId,
      'union',
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/events/from-template/:templateId')
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Clone a template as an event for a union camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'templateId', type: Number })
  async cloneUnionFromTemplate(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: CloneFromTemplateDto,
    @Request() req: any,
  ) {
    const data = await this.service.createFromTemplate(
      camporeeId,
      'union',
      templateId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  // =========================================================================
  // INSTANCE mutations (scope-independent)
  // =========================================================================

  @Patch('camporee-events/:eventId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Update a camporee event instance (overrides)' })
  @ApiParam({ name: 'eventId', type: Number })
  async updateEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: UpdateCamporeeEventDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateEvent(eventId, dto, req.user.sub);
    return { status: 'success', data };
  }

  @Delete('camporee-events/:eventId')
  @RequirePermissions('camporee_events:delete')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Soft delete a camporee event instance' })
  @ApiParam({ name: 'eventId', type: Number })
  async deleteEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Request() req: any,
  ) {
    const data = await this.service.deleteEvent(eventId, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('camporee-events/:eventId/reorder')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Update display_order of a camporee event instance',
  })
  @ApiParam({ name: 'eventId', type: Number })
  async reorderEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: ReorderCamporeeEventDto,
    @Request() req: any,
  ) {
    const data = await this.service.reorderEvent(eventId, dto, req.user.sub);
    return { status: 'success', data };
  }
}
