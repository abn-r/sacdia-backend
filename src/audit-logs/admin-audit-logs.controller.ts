import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  Audit,
  AuthorizationResource,
  GlobalRoles,
  RequirePermissions,
} from '../common/decorators';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { AuditLogsService } from './audit-logs.service';
import {
  AdminAuditLogDetailDto,
  AdminAuditLogPageDto,
} from './dto/admin-audit-log.response.dto';
import { ListAdminAuditLogsQueryDto } from './dto/list-admin-audit-logs.query.dto';

@ApiTags('admin-audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@GlobalRoles('super-admin')
@RequirePermissions('audit:read')
@AuthorizationResource({ type: 'global' })
@Audit({ skip: true })
@Controller('admin/audit-logs')
export class AdminAuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'List global audit logs',
    description:
      'Super-admin only. Cursor-paginated newest first. List omits changes and request_context. No territorial scope.',
  })
  @ApiOkResponse({ type: AdminAuditLogPageDto })
  async list(@Query() query: ListAdminAuditLogsQueryDto) {
    const data = await this.auditLogs.listAdmin(query);
    return { status: 'success', data };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one audit log',
    description:
      'Includes changes (domain events only) and request_context. Never a request body.',
  })
  @ApiParam({ name: 'id', description: 'audit_log_id as decimal string' })
  @ApiOkResponse({ type: AdminAuditLogDetailDto })
  async getById(@Param('id') id: string) {
    const data = await this.auditLogs.getById(id);
    return { status: 'success', data };
  }
}
