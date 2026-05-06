import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
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
import {
  AdminCurrentOperationalEnrollmentDto,
  AdminListUsersQueryDto,
  AdminTrajectoryClassDto,
  UpdateAdminUserDto,
  UpdateUserApprovalDto,
} from './dto';
import { AdminUsersService } from './admin-users.service';

@ApiTags('admin-users')
@ApiBearerAuth()
@ApiExtraModels(AdminCurrentOperationalEnrollmentDto, AdminTrajectoryClassDto)
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('admin', 'super-admin')
@AuthorizationResource({ type: 'global' })
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  private getActorId(
    request: ExpressRequest & { user: { sub: string } },
  ): string {
    return request.user.sub;
  }

  @Get('users')
  @RequirePermissions('users:read')
  @ApiOperation({
    summary:
      'Listar usuarios administrativos con alcance por rol (ALL/UNION/LOCAL_FIELD)',
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, type: String })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'unionId', required: false, type: Number })
  @ApiQuery({ name: 'localFieldId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listUsers(
    @Request() req: ExpressRequest & { user: { sub: string } },
    @Query() query: AdminListUsersQueryDto,
  ): Promise<{
    status: string;
    data: Awaited<ReturnType<AdminUsersService['listUsers']>>;
  }> {
    const data = await this.adminUsersService.listUsers(
      this.getActorId(req),
      query,
    );
    return { status: 'success', data };
  }

  @Get('users/:userId')
  @RequirePermissions('users:read_detail')
  @ApiOperation({
    summary: 'Obtener detalle de usuario validando alcance por rol del actor',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        data: {
          type: 'object',
          properties: {
            current_operational_enrollment: {
              oneOf: [
                {
                  $ref: '#/components/schemas/AdminCurrentOperationalEnrollmentDto',
                },
                { type: 'null' },
              ],
            },
            trajectory_classes: {
              type: 'array',
              items: { $ref: '#/components/schemas/AdminTrajectoryClassDto' },
            },
            classes: {
              type: 'array',
              description:
                'Deprecated compatibility alias of trajectory_classes (legacy only).',
              deprecated: true,
              items: { $ref: '#/components/schemas/AdminTrajectoryClassDto' },
            },
          },
        },
      },
    },
  })
  @ApiParam({ name: 'userId', type: String })
  async getUserById(
    @Request() req: ExpressRequest & { user: { sub: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{
    status: string;
    data: Awaited<ReturnType<AdminUsersService['getUserById']>>;
  }> {
    const data = await this.adminUsersService.getUserById(
      this.getActorId(req),
      userId,
    );
    return { status: 'success', data };
  }

  @Patch('users/:userId/approval')
  @RequirePermissions('users:update_admin')
  @ApiOperation({ summary: 'Approve or reject a user' })
  async updateUserApproval(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserApprovalDto,
  ) {
    const data = await this.adminUsersService.updateUserApproval(userId, dto);
    return { status: 'success', data };
  }

  @Patch('users/:userId')
  @RequirePermissions('users:update_admin')
  @ApiOperation({ summary: 'Update user administrative fields' })
  async updateUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    const data = await this.adminUsersService.updateUser(userId, dto);
    return { status: 'success', data };
  }
}
