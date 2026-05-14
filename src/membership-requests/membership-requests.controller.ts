import {
  Controller,
  Get,
  Post,
  Param,
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
} from '@nestjs/swagger';
import { MembershipRequestsService } from './membership-requests.service';
import { RejectRequestDto } from './dto';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('membership-requests')
@Controller('club-sections/:clubSectionId/membership-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MembershipRequestsController {
  constructor(
    private readonly membershipRequestsService: MembershipRequestsService,
  ) {}

  @Get()
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubSectionId' })
  @ApiOperation({
    summary: 'Listar solicitudes pendientes de membresía',
    description:
      'Lista las solicitudes de membresía pendientes para una sección de club',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Lista de solicitudes pendientes',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid JWT',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — requires club_members:approve permission for this club',
  })
  async listPending(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
  ) {
    const data =
      await this.membershipRequestsService.listPending(clubSectionId);
    return { status: 'success', data };
  }

  @Post(':assignmentId/approve')
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubSectionId' })
  @ApiOperation({
    summary: 'Aprobar solicitud de membresía',
    description:
      'Aprueba una solicitud de membresía pendiente, cambiando el estado a activo',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — requires club_members:approve permission for this club',
  })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  async approve(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.membershipRequestsService.approve(
      assignmentId,
      currentUser.sub,
    );
    return { status: 'success', data };
  }

  @Post(':assignmentId/reject')
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club', clubIdParam: 'clubSectionId' })
  @ApiOperation({
    summary: 'Rechazar solicitud de membresía',
    description:
      'Rechaza una solicitud de membresía pendiente con un motivo opcional',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Solicitud rechazada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — requires club_members:approve permission for this club',
  })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  async reject(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.membershipRequestsService.reject(
      assignmentId,
      currentUser.sub,
      dto.reason,
    );
    return { status: 'success', data };
  }
}
