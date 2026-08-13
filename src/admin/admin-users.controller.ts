import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import type { Request as ExpressRequest, Response } from 'express';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
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
  CreateAdminUserDto,
  CreateAdminUserResponseDto,
  UpdateAdminUserDto,
  UpdateUserApprovalDto,
} from './dto';
import { AdminUsersService, type BulkUsersResult } from './admin-users.service';

const BULK_ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/octet-stream',
  'text/plain',
]);

const BULK_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
  @ApiResponse({ status: 200, description: 'Lista de usuarios' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires admin or super-admin role',
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

  @Get('users/bulk-template')
  @GlobalRoles(
    'admin',
    'super-admin',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @RequirePermissions('users:bulk_create')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="plantilla-usuarios.xlsx"',
  )
  @ApiOperation({
    summary: 'Descarga plantilla .xlsx para carga masiva de usuarios',
  })
  @ApiResponse({ status: 200, description: 'Plantilla xlsx descargada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — rol no autorizado' })
  async downloadBulkTemplate(
    @Request() req: ExpressRequest & { user: { sub: string } },
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.adminUsersService.getBulkTemplateBuffer(
      this.getActorId(req),
    );
    res.send(buffer);
  }

  @Get('users/:userId')
  @RequirePermissions('users:read_detail')
  @ApiOperation({
    summary: 'Obtener detalle de usuario validando alcance por rol del actor',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires admin or super-admin role',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado o fuera del alcance del actor',
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
  @ApiResponse({ status: 200, description: 'Approval status updated' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires admin or super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
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
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requires admin or super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async updateUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    const data = await this.adminUsersService.updateUser(userId, dto);
    return { status: 'success', data };
  }

  @Post('users')
  @GlobalRoles(
    'admin',
    'super-admin',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @RequirePermissions('users:create')
  @ApiOperation({
    summary: 'Crear usuario manualmente (admin-iniciado, con invite por email)',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado y email de invite encolado',
  })
  @ApiResponse({ status: 400, description: 'Validación falló' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — actor sin permiso o intentando crear rol superior',
  })
  @ApiResponse({ status: 409, description: 'Email ya registrado' })
  async createUser(
    @Request() req: ExpressRequest & { user: { sub: string } },
    @Body() dto: CreateAdminUserDto,
  ): Promise<{ status: 'success'; data: CreateAdminUserResponseDto }> {
    const data = await this.adminUsersService.createAdminUser(
      this.getActorId(req),
      dto,
    );
    return { status: 'success', data };
  }

  @Post('users/bulk')
  @GlobalRoles(
    'admin',
    'super-admin',
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
  )
  @RequirePermissions('users:bulk_create')
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiOperation({
    summary: 'Carga masiva de usuarios desde archivo .xlsx o .csv',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado por fila (batch partial-success)',
  })
  @ApiResponse({
    status: 400,
    description: 'Archivo ausente, tipo inválido, vacío o demasiadas filas',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — rol no autorizado' })
  async bulkCreateUsers(
    @Request() req: ExpressRequest & { user: { sub: string } },
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ status: 'success'; data: BulkUsersResult }> {
    if (!file) {
      throw new BadRequestException(
        'Se requiere un archivo (campo multipart: file)',
      );
    }

    if (!BULK_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${file.mimetype}. Permitidos: xlsx, csv`,
      );
    }

    if (file.size > BULK_MAX_BYTES) {
      throw new BadRequestException('El archivo supera el límite de 5 MB');
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }

    const data = await this.adminUsersService.bulkCreateAdminUsers(
      this.getActorId(req),
      file.buffer,
      file.mimetype,
    );

    return { status: 'success', data };
  }
}
