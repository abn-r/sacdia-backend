import {
  Controller,
  Get,
  Param,
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
import { RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AdminListUsersQueryDto } from './dto';
import { AdminUsersService } from './admin-users.service';

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

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
    @Request() req,
    @Query() query: AdminListUsersQueryDto,
  ): Promise<{ status: string; data: any }> {
    const data = await this.adminUsersService.listUsers(req.user.sub, query);
    return { status: 'success', data };
  }

  @Get('users/:userId')
  @RequirePermissions('users:read_detail')
  @ApiOperation({
    summary: 'Obtener detalle de usuario validando alcance por rol del actor',
  })
  @ApiParam({ name: 'userId', type: String })
  async getUserById(
    @Request() req,
    @Param('userId') userId: string,
  ): Promise<{ status: string; data: any }> {
    const data = await this.adminUsersService.getUserById(req.user.sub, userId);
    return { status: 'success', data };
  }
}
