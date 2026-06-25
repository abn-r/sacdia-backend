import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { RequestsService } from './requests.service';
import {
  CreateTransferRequestDto,
  ReviewTransferRequestDto,
  CreateAssignmentRequestDto,
  ReviewAssignmentRequestDto,
} from './dto';
import {
  AuthorizationResource,
  RequirePermissions,
  CurrentUser,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('requests')
@Controller('requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@ApiBearerAuth()
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // ========================================
  // CLUB TRANSFERS
  // ========================================

  @Post('transfers')
  @RequirePermissions('requests:read')
  @ApiOperation({
    summary: 'Crear solicitud de transferencia',
    description:
      'Un miembro solicita transferirse de una sección de club a otra',
  })
  @ApiResponse({ status: 201, description: 'Solicitud creada' })
  @ApiResponse({
    status: 400,
    description: 'El usuario no pertenece a la sección de origen',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una solicitud pendiente',
  })
  async createTransferRequest(
    @Body() dto: CreateTransferRequestDto,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.requestsService.createTransferRequest(
      user.user_id,
      dto.from_section_id ?? null,
      dto.to_section_id,
      dto.reason,
    );
  }

  @Get('transfers')
  @RequirePermissions('requests:read')
  @ApiOperation({
    summary: 'Listar solicitudes de transferencia',
    description: 'Lista solicitudes de transferencia con filtros opcionales',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected'],
    description: 'Filtrar por estado',
  })
  @ApiQuery({
    name: 'sectionId',
    required: false,
    type: Number,
    description: 'Filtrar por sección (origen o destino)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de solicitudes de transferencia',
  })
  async getTransferRequests(
    @CurrentUser() user: { user_id: string },
    @Query('status') status?: string,
    @Query('sectionId', new ParseIntPipe({ optional: true }))
    sectionId?: number,
  ) {
    return this.requestsService.getTransferRequests({
      userId: user.user_id,
      status,
      sectionId,
    });
  }

  @Get('transfers/:requestId')
  @RequirePermissions('requests:read')
  @ApiOperation({
    summary: 'Obtener solicitud de transferencia',
    description:
      'Obtiene una solicitud de transferencia con todas sus relaciones',
  })
  @ApiParam({ name: 'requestId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Solicitud de transferencia',
  })
  @ApiResponse({
    status: 404,
    description: 'Solicitud no encontrada',
  })
  async getTransferRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.requestsService.getTransferRequest(requestId, user.user_id);
  }

  @Post('transfers/:requestId/review')
  @RequirePermissions('requests:review')
  @ApiOperation({
    summary: 'Revisar solicitud de transferencia',
    description:
      'Un director aprueba o rechaza una solicitud de transferencia. Si se aprueba, las asignaciones de rol se mueven a la nueva sección.',
  })
  @ApiParam({ name: 'requestId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Solicitud revisada',
  })
  @ApiResponse({
    status: 404,
    description: 'Solicitud no encontrada',
  })
  @ApiResponse({
    status: 409,
    description: 'La solicitud ya fue revisada',
  })
  async reviewTransferRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewTransferRequestDto,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.requestsService.reviewTransfer(
      requestId,
      user.user_id,
      dto.action,
      dto.comment,
    );
  }

  // ========================================
  // ROLE ASSIGNMENTS
  // ========================================

  @Post('assignments')
  @RequirePermissions('requests:review')
  @ApiOperation({
    summary: 'Crear solicitud de asignación de rol',
    description:
      'Un asistente de campo local solicita la asignación de un rol a un miembro. Se validan los límites de slots del rol.',
  })
  @ApiResponse({ status: 201, description: 'Solicitud creada' })
  @ApiResponse({
    status: 404,
    description: 'Sección, usuario o rol no encontrado',
  })
  @ApiResponse({
    status: 409,
    description:
      'Ya existe una solicitud pendiente o se alcanzó el límite de slots',
  })
  async createAssignmentRequest(
    @Body() dto: CreateAssignmentRequestDto,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.requestsService.createAssignmentRequest(
      dto.club_section_id,
      dto.user_id,
      dto.role_id,
      user.user_id,
    );
  }

  @Get('assignments')
  @RequirePermissions('requests:read')
  @ApiOperation({
    summary: 'Listar solicitudes de asignación de rol',
    description:
      'Lista solicitudes de asignación de rol con filtros opcionales',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected'],
    description: 'Filtrar por estado',
  })
  @ApiQuery({
    name: 'sectionId',
    required: false,
    type: Number,
    description: 'Filtrar por sección del club',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de solicitudes de asignación',
  })
  async getAssignmentRequests(
    @Query('status') status?: string,
    @Query('sectionId', new ParseIntPipe({ optional: true }))
    sectionId?: number,
  ) {
    return this.requestsService.getAssignmentRequests({
      status,
      sectionId,
    });
  }

  @Get('assignments/:requestId')
  @RequirePermissions('requests:read')
  @ApiOperation({
    summary: 'Obtener solicitud de asignación de rol',
    description:
      'Obtiene una solicitud de asignación de rol con todas sus relaciones',
  })
  @ApiParam({ name: 'requestId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Solicitud de asignación de rol',
  })
  @ApiResponse({
    status: 404,
    description: 'Solicitud no encontrada',
  })
  async getAssignmentRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.requestsService.getAssignmentRequest(requestId);
  }

  @Post('assignments/:requestId/review')
  @RequirePermissions('requests:review')
  @ApiOperation({
    summary: 'Revisar solicitud de asignación de rol',
    description:
      'Un director de campo local aprueba o rechaza una solicitud de asignación de rol. Si se aprueba, se crea la asignación de rol validando los límites de slots.',
  })
  @ApiParam({ name: 'requestId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Solicitud revisada',
  })
  @ApiResponse({
    status: 404,
    description: 'Solicitud no encontrada',
  })
  @ApiResponse({
    status: 409,
    description: 'La solicitud ya fue revisada o se alcanzó el límite de slots',
  })
  async reviewAssignmentRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewAssignmentRequestDto,
    @CurrentUser() user: { user_id: string },
  ) {
    return this.requestsService.reviewAssignment(
      requestId,
      user.user_id,
      dto.action,
      dto.comment,
    );
  }
}
