import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { AdminRoleRequirementsService } from './admin-role-requirements.service';
import { UpdateRoleRequirementDto } from './dto/update-role-requirement.dto';

/** Admin and super-admin only (`role_requirements:manage`). */
@ApiTags('admin-role-requirements')
@ApiBearerAuth()
@Controller('admin/role-requirements')
export class AdminRoleRequirementsController {
  constructor(private readonly service: AdminRoleRequirementsService) {}

  @Get()
  @RequirePermissions('role_requirements:manage')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Requisitos por cargo (modo, vigencia, equivalencia)',
  })
  async list() {
    return { status: 'success', data: await this.service.list() };
  }

  @Patch(':id')
  @RequirePermissions('role_requirements:manage')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Cambiar modo, fecha de vigencia o certificación equivalente',
  })
  async update(
    @Req() req: { user: { sub: string } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleRequirementDto,
  ) {
    return {
      status: 'success',
      data: await this.service.update(req.user.sub, id, dto),
    };
  }
}
