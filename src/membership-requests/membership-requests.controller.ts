import {
  Controller,
  Get,
  HttpCode,
  Post,
  Param,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  Req,
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
import { RejectRequestDto, VerifyConsentDto } from './dto';
import { ConsentVerificationService } from './consent-verification.service';
import { DEFAULT_UPLOAD_OPTIONS } from '../common/constants/upload-limits.constants';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
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

/** What PermissionsGuard leaves on the request after a successful check. */
type AuthorizedRequest = {
  authorization?: { effective?: { permissions?: string[] } };
  /** true when the guard let the caller in ONLY as a coordinator of the section. */
  coordinatorSectionGrant?: boolean;
};

const APPROVE_PERMISSION = 'club_members:approve';

/**
 * A "verify-only" reviewer reaches the consent routes with `consent:verify` but
 * without `club_members:approve` FOR THAT SECTION: a club role with only that
 * permission, or a coordinator. Two ways to be one:
 *  - club_members:approve is not among the effective permissions;
 *  - the guard let the caller in only through the coordinator path: whatever
 *    approve they hold comes from another place (e.g. their active club role in
 *    ANOTHER club), not from this section.
 * Fails closed: no resolved authorization on the request means verify-only.
 */
function isVerifyOnlyReviewer(request: AuthorizedRequest): boolean {
  return (
    request.coordinatorSectionGrant === true ||
    !(request.authorization?.effective?.permissions ?? []).includes(
      APPROVE_PERMISSION,
    )
  );
}

/**
 * Reviewing a minor's consent (list, read/upload the signed form, verify):
 * club_members:approve OR consent:verify. Approving the membership stays
 * club_members:approve only. `coordinatorSections` lets a GLOBAL coordinator
 * whose role carries one of these reach the sections their
 * coordinator_assignments cover.
 */
const CONSENT_REVIEW_PERMISSIONS = {
  permissions: [APPROVE_PERMISSION, 'consent:verify'],
  mode: 'any' as const,
};

@ApiTags('membership-requests')
@Controller('club-sections/:clubSectionId/membership-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MembershipRequestsController {
  constructor(
    private readonly membershipRequestsService: MembershipRequestsService,
    private readonly evidence: GuardianEvidenceService,
    private readonly consentVerification: ConsentVerificationService,
  ) {}

  @Get()
  @RequirePermissions(CONSENT_REVIEW_PERMISSIONS)
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'clubSectionId',
    coordinatorSections: true,
  })
  @ApiOperation({
    summary: 'Listar solicitudes pendientes de membresía',
    description:
      'Lista las solicitudes de membresía pendientes para una sección de club. Un revisor solo-verificación (consent:verify sin club_members:approve en la sección, p. ej. un coordinador) ve únicamente los menores con consentimiento pendiente y ficha vigente subida.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiResponse({
    status: 200,
    description:
      'Lista de solicitudes pendientes. Cada item incluye `expires_at` (timeout base almacenado, sin cambios) y `effective_expires_at` (ISO): el vencimiento real que aplica el cron. `consent.viewer_can_verify` (boolean) dice si QUIEN CONSULTA puede verificar el consentimiento ahora (true solo con ficha vigente subida, consentimiento pendiente y sin impedimento de cuatro ojos); `consent.viewer_verify_block` es `self_guardian` (es tutor vigente del menor), `self_custodian` (custodia del club y creó al menor, subió la ficha vigente o cedió al menor) o null (puede verificar, o no hay nada que verificar). Nunca se exponen ids de usuario. VISTA FILTRADA: quien consulta con consent:verify pero SIN club_members:approve en esa sección (un coordinador, o un rol de club con solo ese permiso) recibe únicamente las solicitudes con trabajo para él: menores con consentimiento pendiente de verificar Y ficha vigente subida; se omiten adultos, consentimientos ya verificados, menores sin ficha y adolescentes sin tutor vinculado. Si está impedido por cuatro ojos (self_guardian / self_custodian) la fila SÍ aparece, con el bloque que explica por qué. Con club_members:approve se listan todas, sin cambios. La lista no es paginada: el arreglo es el conjunto filtrado. Adulto: created_at + timeout base; menor con consentimiento pendiente: created_at + max(base, 30) dias; menor con consentimiento verificado: max(created_at, verified_at) + timeout base.',
    schema: {
      example: {
        status: 'success',
        data: [
          {
            assignment_id: '3f0c8a52-6a58-4b1e-9d2a-0e5b7c1d9a11',
            user_id: '8d1f0b34-2c6e-4f0a-bb7e-5a3c9e2d4f10',
            club_section_id: 10,
            status: 'pending',
            created_at: '2026-10-01T12:00:00.000Z',
            expires_at: '2026-10-09T12:00:00.000Z',
            effective_expires_at: '2026-10-31T12:00:00.000Z',
            consent: {
              required: true,
              dependent: true,
              guardian_linked: false,
              guardianship_id: 'b2f6c9a0-1d3e-4a7b-8c5d-6e9f0a1b2c3d',
              status: 'pending',
              evidence_uploaded: true,
              guardians: [],
              viewer_can_verify: false,
              viewer_verify_block: 'self_custodian',
            },
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid JWT',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden — requires club_members:approve or consent:verify for this section (a coordinator: on a section their coordinator_assignments cover)',
  })
  async listPending(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Req() request: AuthorizedRequest,
  ) {
    const data = await this.membershipRequestsService.listPending(
      clubSectionId,
      currentUser.sub,
      { verifyOnly: isVerifyOnlyReviewer(request) },
    );
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
      'MR_CONSENT_NOT_VERIFIED: the requester is a minor whose guardian consent is not verified yet. MR_ALREADY_PENDING: the request was already processed',
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
  @RequirePermissions(CONSENT_REVIEW_PERMISSIONS)
  @AuthorizationResource({
    type: 'club_assignment',
    idParam: 'assignmentId',
    coordinatorSections: true,
  })
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
      'Foto o PDF (JPEG, PNG, WebP, PDF; hasta 10 MB, campo multipart `file`). HEIC se rechaza: la app lo convierte a JPEG. Mientras el consentimiento está pendiente reemplaza la ficha vigente sin borrar la anterior; ya verificado responde 409 (a un revisor solo-verificación, sin club_members:approve en la sección, le responde 404 MR_NOT_FOUND: solo puede subir para menores con consentimiento pendiente). No verifica el consentimiento: usa verify-consent.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({
    status: 201,
    description: '{ evidence_id, content_type, size_bytes, uploaded_at }',
  })
  @ApiResponse({
    status: 403,
    description:
      'Sin club_members:approve ni consent:verify en la sección (un coordinador: solo en secciones cubiertas por sus coordinator_assignments)',
  })
  @ApiResponse({
    status: 404,
    description:
      'MR_NOT_FOUND (solicitud inexistente, de otra sección o ya procesada) o GUARDIANSHIP_NOT_FOUND (no es un menor). Para un revisor solo-verificación todo caso fuera de "menor con consentimiento pendiente" es MR_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'GUARDIANSHIP_CONSENT_ALREADY_VERIFIED: el consentimiento ya está verificado; la ficha verificada no se reemplaza',
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
    @Req() request: AuthorizedRequest,
  ) {
    const data = await this.evidence.uploadForDirector(
      currentUser.sub,
      clubSectionId,
      assignmentId,
      file,
      { verifyOnly: isVerifyOnlyReviewer(request) },
    );
    return { status: 'success', data };
  }

  @Get(':assignmentId/consent-evidence')
  @RequirePermissions(CONSENT_REVIEW_PERMISSIONS)
  @AuthorizationResource({
    type: 'club_assignment',
    idParam: 'assignmentId',
    coordinatorSections: true,
  })
  @ApiOperation({
    summary: 'URL firmada (15 min) de la ficha de consentimiento vigente',
    description:
      'Un revisor solo-verificación (consent:verify sin club_members:approve en la sección, p. ej. un coordinador) solo puede leer la ficha de las solicitudes que aparecen en su lista filtrada (menor con consentimiento pendiente y ficha vigente); cualquier otro caso es 404 MR_NOT_FOUND, igual que una solicitud inexistente.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({
    status: 200,
    description:
      '{ url, expires_in, content_type, uploaded_at, uploaded_by_display_name }',
  })
  @ApiResponse({
    status: 403,
    description:
      'Sin club_members:approve ni consent:verify en la sección (un coordinador: solo en secciones cubiertas por sus coordinator_assignments)',
  })
  @ApiResponse({
    status: 404,
    description:
      'MR_NOT_FOUND, GUARDIANSHIP_NOT_FOUND o GUARDIANSHIP_EVIDENCE_NOT_FOUND (un revisor solo-verificación recibe siempre MR_NOT_FOUND fuera de su lista filtrada)',
  })
  @ApiResponse({
    status: 503,
    description: 'GUARDIANSHIP_EVIDENCE_UNAVAILABLE',
  })
  async getConsentEvidence(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Req() request: AuthorizedRequest,
  ) {
    const data = await this.evidence.getForDirector(
      currentUser.sub,
      clubSectionId,
      assignmentId,
      { verifyOnly: isVerifyOnlyReviewer(request) },
    );
    return { status: 'success', data };
  }
  @Post(':assignmentId/verify-consent')
  @HttpCode(200)
  @RequirePermissions(CONSENT_REVIEW_PERMISSIONS)
  @AuthorizationResource({
    type: 'club_assignment',
    idParam: 'assignmentId',
    coordinatorSections: true,
  })
  @ApiOperation({
    summary: 'Verificar el consentimiento del tutor de un menor',
    description:
      'Basta club_members:approve o consent:verify; aprobar la solicitud (approve=true) exige además club_members:approve (403 MR_APPROVE_PERMISSION_REQUIRED). El director confirma haber revisado la ficha firmada. Requiere ficha vigente subida (409 GUARDIANSHIP_EVIDENCE_REQUIRED). Un tutor vigente del menor nunca puede verificar su consentimiento (403 GUARDIANSHIP_GUARDIAN_SELF_VERIFY). Si el menor está bajo custodia del club, quien subió la ficha, quien creó al menor o el tutor que lo cedió no pueden verificar (403 GUARDIANSHIP_CUSTODIAN_SELF_VERIFY). Con approve=true también aprueba la solicitud; si la aprobación falla el consentimiento queda verificado y `approve_error` trae el código (reintentar la misma llamada). Idempotente.',
  })
  @ApiParam({ name: 'clubSectionId', type: Number })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({
    status: 200,
    description:
      '{ guardianship: { guardianship_id, consent_status, verified_at, verified_by_user_id, verification_method }, assignment: {...}|null, approve_error: string|null }',
  })
  @ApiResponse({ status: 400, description: 'MR_CONSENT_CONFIRMATION_REQUIRED' })
  @ApiResponse({
    status: 403,
    description:
      'Sin club_members:approve ni consent:verify, MR_APPROVE_PERMISSION_REQUIRED (approve=true sin club_members:approve), GUARDIANSHIP_GUARDIAN_SELF_VERIFY o GUARDIANSHIP_CUSTODIAN_SELF_VERIFY',
  })
  @ApiResponse({
    status: 404,
    description: 'MR_NOT_FOUND o GUARDIANSHIP_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description: 'GUARDIANSHIP_EVIDENCE_REQUIRED o MR_ALREADY_PENDING',
  })
  async verifyConsent(
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: VerifyConsentDto,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Req() request: AuthorizedRequest,
  ) {
    // consent:verify alone is verify-only (a reviewer who is not a member of the
    // club's leadership, e.g. a coordinator). Approving the membership stays
    // with club_members:approve. Checked BEFORE anything is read or written, and
    // fails closed when the guard left no resolved authorization on the request.
    if (dto.approve === true && isVerifyOnlyReviewer(request)) {
      throw new AppForbiddenException(ErrorCode.MR_APPROVE_PERMISSION_REQUIRED);
    }
    const data = await this.consentVerification.verify(
      clubSectionId,
      assignmentId,
      currentUser.sub,
      dto,
    );
    return { status: 'success', data };
  }
}
