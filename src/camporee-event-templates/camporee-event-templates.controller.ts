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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AuthorizationResource, RequirePermissions } from '../common/decorators';
import { CamporeeEventTemplatesService } from './camporee-event-templates.service';
import {
  CreateCamporeeEventTemplateDto,
  ListCamporeeEventTemplatesDto,
  UpdateCamporeeEventTemplateDto,
} from './dto';

@ApiTags('camporee-event-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('camporee-event-templates')
export class CamporeeEventTemplatesController {
  constructor(private readonly service: CamporeeEventTemplatesService) {}

  @Get()
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'List camporee event templates (filtered by role scope)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['union', 'local_field'] })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiQuery({ name: 'event_type_id', required: false, type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  async listTemplates(
    @Request() req: any,
    @Query('scope') scope?: string,
    @Query('union_id', new ParseIntPipe({ optional: true })) unionId?: number,
    @Query('local_field_id', new ParseIntPipe({ optional: true })) localFieldId?: number,
    @Query('event_type_id', new ParseIntPipe({ optional: true })) eventTypeId?: number,
    @Query('active') activeStr?: string,
  ) {
    const filters: ListCamporeeEventTemplatesDto = {
      scope,
      union_id: unionId,
      local_field_id: localFieldId,
      event_type_id: eventTypeId,
      active:
        activeStr === 'true' ? true : activeStr === 'false' ? false : undefined,
    };
    const data = await this.service.listTemplates(req.authorization, filters);
    return { status: 'success', data };
  }

  @Get(':templateId')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Get camporee event template by ID' })
  @ApiParam({ name: 'templateId', type: Number })
  async getTemplate(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Request() req: any,
  ) {
    const data = await this.service.getTemplate(templateId, req.authorization);
    return { status: 'success', data };
  }

  @Post()
  @RequirePermissions('camporee_events:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Create camporee event template' })
  async createTemplate(
    @Body() dto: CreateCamporeeEventTemplateDto,
    @Request() req: any,
  ) {
    const data = await this.service.createTemplate(
      dto,
      req.authorization,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch(':templateId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Update camporee event template' })
  @ApiParam({ name: 'templateId', type: Number })
  async updateTemplate(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: UpdateCamporeeEventTemplateDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateTemplate(
      templateId,
      dto,
      req.authorization,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete(':templateId')
  @RequirePermissions('camporee_events:delete')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Soft delete camporee event template' })
  @ApiParam({ name: 'templateId', type: Number })
  async deleteTemplate(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Request() req: any,
  ) {
    const data = await this.service.deleteTemplate(
      templateId,
      req.authorization,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
