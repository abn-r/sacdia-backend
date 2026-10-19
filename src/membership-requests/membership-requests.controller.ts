import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import 'multer';
import { MembershipRequestsService } from './membership-requests.service';
import { RejectRequestDto } from './dto';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import { namedThrottle } from '../config/throttler.helpers';
import { ConsentEvidenceFilePipe } from '../guardianships/consent-evidence-file.pipe';
import { GuardianEvidenceService } from '../guardianships/guardian-evidence.service';
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
    private readonly evidence: GuardianEvidenceService,
  ) {}

  @Get()
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_section', idParam: 'clubSectionId' })
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
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
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
  @ApiResponse({
    status: 409,
    description:
      'MR_CONSENT_NOT_VERIFIED: the requester is a minor whose guardian consent is not verified yet (or the request was already processed)',
  })
  async approve(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.membershipRequestsService.approve(
      clubSectionId,
      assignmentId,
      currentUser.sub,
    );
    return { status: 'success', data };
  }

  @Post(':assignmentId/reject')
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
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
      clubSectionId,
      assignmentId,
      currentUser.sub,
      dto.reason,
    );
    return { status: 'success', data };
  }
  @Post(':assignmentId/consent-evidence')
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
  @Throttle(namedThrottle({ ttl: 3_600_000, limit: 20 }))
  @UseInterceptors(FileInterceptor('file', DEFAULT_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Subir la ficha de consentimiento firmada de un menor',
    description:
      'Foto o PDF (JPEG, PNG, WebP, PDF; hasta 10 MB, campo multipart `file`). HEIC se rechaza: la app lo convierte a JPEG. Reemplaza la ficha vigente sin borrar la anterior. No verifica el consentimiento: usa verify-consent.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({
    status: 201,
    description: '{ evidence_id, content_type, size_bytes, uploaded_at }',
  })
  @ApiResponse({
    status: 404,
    description:
      'MR_NOT_FOUND (solicitud inexistente, de otra sección o ya procesada) o GUARDIANSHIP_NOT_FOUND (no es un menor)',
  })
  @ApiResponse({
    status: 503,
    description: 'GUARDIANSHIP_EVIDENCE_UNAVAILABLE',
  })
  async uploadConsentEvidence(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @UploadedFile(new ConsentEvidenceFilePipe()) file: Express.Multer.File,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.evidence.uploadForDirector(
      currentUser.sub,
      clubSectionId,
      assignmentId,
      file,
    );
    return { status: 'success', data };
  }

  @Get(':assignmentId/consent-evidence')
  @RequirePermissions('club_members:approve')
  @AuthorizationResource({ type: 'club_assignment', idParam: 'assignmentId' })
  @ApiOperation({
    summary: 'URL firmada (15 min) de la ficha de consentimiento vigente',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({
    status: 200,
    description:
      '{ url, expires_in, content_type, uploaded_at, uploaded_by_display_name }',
  })
  @ApiResponse({
    status: 404,
    description:
      'MR_NOT_FOUND, GUARDIANSHIP_NOT_FOUND o GUARDIANSHIP_EVIDENCE_NOT_FOUND',
  })
  @ApiResponse({
    status: 503,
    description: 'GUARDIANSHIP_EVIDENCE_UNAVAILABLE',
  })
  async getConsentEvidence(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.evidence.getForDirector(
      currentUser.sub,
      clubSectionId,
      assignmentId,
    );
    return { status: 'success', data };
  }
}
