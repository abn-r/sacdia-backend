import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
  GlobalRoles,
} from '../common/decorators';
import {
  JwtAuthGuard,
  PermissionsGuard,
  GlobalRolesGuard,
} from '../common/guards';
import { AdminCamporeeEventTypesService } from './admin-camporee-event-types.service';
import {
  CreateCamporeeEventTypeDto,
  UpdateCamporeeEventTypeDto,
} from './dto';

@ApiTags('admin-camporee-event-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super-admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin')
export class AdminCamporeeEventTypesController {
  constructor(
    private readonly service: AdminCamporeeEventTypesService,
  ) {}

  @Get('camporee-event-types')
  @RequirePermissions('camporee_event_types:read')
  @ApiOperation({ summary: 'List camporee event types' })
  async list() {
    const data = await this.service.listCamporeeEventTypes();
    return { status: 'success', data };
  }

  @Post('camporee-event-types')
  @RequirePermissions('camporee_event_types:create')
  @ApiOperation({ summary: 'Create camporee event type' })
  async create(
    @Body() dto: CreateCamporeeEventTypeDto,
    @Request() req: any,
  ) {
    const data = await this.service.createCamporeeEventType(dto, req.user.sub);
    return { status: 'success', data };
  }

  @Patch('camporee-event-types/:eventTypeId')
  @RequirePermissions('camporee_event_types:update')
  @ApiOperation({ summary: 'Update camporee event type' })
  @ApiParam({ name: 'eventTypeId', type: Number })
  async update(
    @Param('eventTypeId', ParseIntPipe) eventTypeId: number,
    @Body() dto: UpdateCamporeeEventTypeDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateCamporeeEventType(
      eventTypeId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('camporee-event-types/:eventTypeId')
  @RequirePermissions('camporee_event_types:delete')
  @ApiOperation({ summary: 'Soft delete camporee event type' })
  @ApiParam({ name: 'eventTypeId', type: Number })
  async delete(
    @Param('eventTypeId', ParseIntPipe) eventTypeId: number,
    @Request() req: any,
  ) {
    const data = await this.service.deleteCamporeeEventType(
      eventTypeId,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
