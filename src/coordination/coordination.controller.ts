import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AuthorizationResource,
  GlobalRoles,
  SkipPermissions,
} from '../common/decorators';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { CoordinationService } from './coordination.service';
import {
  CoordinatorConsentQueueService,
  type GlobalRoleGrant,
} from './coordinator-consent-queue.service';
import {
  BackfillCoordinatorAssignmentsDto,
  CONSENT_QUEUE_DEFAULT_LIMIT,
  CoordinatorConsentPendingQueryDto,
  CreateCoordinationZoneDto,
  CreateCoordinatorAssignmentDto,
  UpdateCoordinationZoneDto,
  UpdateCoordinatorAssignmentDto,
} from './dto';

type AuthenticatedRequest = Request & { user: { sub: string } };

/** What PermissionsGuard leaves on the request after a successful check. */
type AuthorizedRequest = AuthenticatedRequest & {
  authorization?: { grants?: { global_roles?: GlobalRoleGrant[] } };
};

@ApiTags('admin-coordination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard, PermissionsGuard)
@RequirePermissions('coordination:manage')
@AuthorizationResource({ type: 'global' })
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
@Controller('admin/coordination')
export class AdminCoordinationController {
  constructor(private readonly coordinationService: CoordinationService) {}

  @Get('local-fields/:localFieldId/zones')
  @ApiOperation({ summary: 'Listar zonas de coordinación de un campo local' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async listZones(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
  ) {
    const data = await this.coordinationService.listZones(
      req.user.sub,
      localFieldId,
    );
    return { status: 'success', data };
  }

  @Post('local-fields/:localFieldId/zones')
  @ApiOperation({ summary: 'Crear zona de coordinación en un campo local' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async createZone(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: CreateCoordinationZoneDto,
  ) {
    const data = await this.coordinationService.createZone(
      req.user.sub,
      localFieldId,
      dto,
    );
    return { status: 'success', data };
  }

  @Patch('zones/:zoneId')
  @ApiOperation({ summary: 'Actualizar zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  async updateZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateCoordinationZoneDto,
  ) {
    const data = await this.coordinationService.updateZone(
      req.user.sub,
      zoneId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('zones/:zoneId/districts/:districtId')
  @ApiOperation({ summary: 'Asignar un distrito a una zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  @ApiParam({ name: 'districtId', type: Number })
  async assignDistrictToZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Param('districtId', ParseIntPipe) districtId: number,
  ) {
    const data = await this.coordinationService.assignDistrictToZone(
      req.user.sub,
      zoneId,
      districtId,
    );
    return { status: 'success', data };
  }

  @Delete('zones/:zoneId/districts/:districtId')
  @ApiOperation({ summary: 'Quitar un distrito de una zona de coordinación' })
  @ApiParam({ name: 'zoneId', type: Number })
  @ApiParam({ name: 'districtId', type: Number })
  async removeDistrictFromZone(
    @Req() req: AuthenticatedRequest,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Param('districtId', ParseIntPipe) districtId: number,
  ) {
    const data = await this.coordinationService.removeDistrictFromZone(
      req.user.sub,
      zoneId,
      districtId,
    );
    return { status: 'success', data };
  }

  @Get('local-fields/:localFieldId/assignments')
  @ApiOperation({ summary: 'Listar asignaciones de coordinadores' })
  @ApiParam({ name: 'localFieldId', type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  async listAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Query('active') active?: string,
  ) {
    const data = await this.coordinationService.listAssignments(
      req.user.sub,
      localFieldId,
      active === undefined ? undefined : active === 'true',
    );
    return { status: 'success', data };
  }

  @Post('local-fields/:localFieldId/assignments')
  @ApiOperation({ summary: 'Crear asignación de coordinador' })
  @ApiParam({ name: 'localFieldId', type: Number })
  async createAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: CreateCoordinatorAssignmentDto,
  ) {
    const data = await this.coordinationService.createAssignment(
      req.user.sub,
      localFieldId,
      dto,
    );
    return { status: 'success', data };
  }

  @Patch('assignments/:assignmentId')
  @ApiOperation({ summary: 'Actualizar asignación de coordinador' })
  @ApiParam({ name: 'assignmentId', type: String })
  async updateAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateCoordinatorAssignmentDto,
  ) {
    const data = await this.coordinationService.updateAssignment(
      req.user.sub,
      assignmentId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post('local-fields/:localFieldId/backfill')
  @ApiOperation({
    summary:
      'Migrar coordinadores legacy (rol + local_field_id) a asignación GENERAL',
  })
  @ApiParam({ name: 'localFieldId', type: Number })
  async backfillLegacyAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: BackfillCoordinatorAssignmentsDto = {},
  ) {
    const data = await this.coordinationService.backfillLegacyAssignments(
      req.user.sub,
      localFieldId,
      dto.dry_run ?? true,
    );
    return { status: 'success', data };
  }
}

@ApiTags('coordination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('coordination')
export class CoordinationController {
  constructor(
    private readonly coordinationService: CoordinationService,
    private readonly consentQueue: CoordinatorConsentQueueService,
  ) {}

  @Get('me/scope')
  // Self-scoped read: only resolves the caller's own assignments (req.user.sub),
  // so it needs a valid JWT but no RBAC permission.
  @SkipPermissions()
  @ApiOperation({
    summary: 'Resolver el alcance efectivo de coordinación del usuario actual',
  })
  async getMyCoordinatorScope(@Req() req: AuthenticatedRequest) {
    const data = await this.coordinationService.resolveCoordinatorScope(
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('me/consent-pending')
  // consent:verify as a GLOBAL permission (resource `global`: club roles do not
  // count). The queue then demands that a coordinator ROLE carries it and that
  // active assignments cover at least one section. No @ActingScope: guardians
  // acting, supervised teens and linked devices are denied by default.
  @RequirePermissions('consent:verify')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary:
      'Fichas de consentimiento por verificar en todas las secciones del coordinador',
    description:
      'Cola de verificación de un coordinador: en TODAS las secciones que cubren sus coordinator_assignments activas (misma expansión que GET /coordination/me/scope, solo territorio activo), las solicitudes que la lista por sección muestra a un revisor solo-verificación: menores con consentimiento pendiente de verificar Y ficha vigente subida. Se omiten adultos, consentimientos verificados y menores sin ficha. Cada item es el item de GET /club-sections/:id/membership-requests (mismo bloque `consent`, incluidos viewer_can_verify / viewer_verify_block) más club_name, club_type_name, district_name y consent_form_uploaded_at. Orden: ficha vigente más antigua primero (la que más espera), luego solicitud más antigua. Paginación por limit/offset; total y by_section cuentan la cola completa.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Página de la cola de verificación.',
    schema: {
      example: {
        status: 'success',
        data: {
          items: [
            {
              assignment_id: '3f0c8a52-6a58-4b1e-9d2a-0e5b7c1d9a11',
              user_id: '8d1f0b34-2c6e-4f0a-bb7e-5a3c9e2d4f10',
              club_section_id: 10,
              status: 'pending',
              created_at: '2026-10-01T12:00:00.000Z',
              expires_at: '2026-10-09T12:00:00.000Z',
              effective_expires_at: '2026-10-31T12:00:00.000Z',
              consent_form_uploaded_at: '2026-10-03T09:30:00.000Z',
              club_name: 'Club Orion',
              club_type_name: 'Conquistadores',
              district_name: 'Distrito Norte',
              users: {
                user_id: '8d1f0b34-2c6e-4f0a-bb7e-5a3c9e2d4f10',
                name: 'Mateo',
                email: null,
                paternal_last_name: 'Pérez',
                maternal_last_name: 'López',
                user_image: null,
              },
              roles: {
                role_id: 'c4d2e8f1-5a6b-4c7d-9e0f-1a2b3c4d5e6f',
                role_name: 'member',
              },
              consent: {
                required: true,
                dependent: true,
                guardian_linked: false,
                guardianship_id: 'b2f6c9a0-1d3e-4a7b-8c5d-6e9f0a1b2c3d',
                status: 'pending',
                evidence_uploaded: true,
                guardians: [
                  {
                    display_name: 'Club Orion',
                    relationship_type_name: null,
                    is_primary: true,
                  },
                ],
                viewer_can_verify: true,
                viewer_verify_block: null,
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          by_section: [
            {
              club_section_id: 10,
              club_name: 'Club Orion',
              club_type_name: 'Conquistadores',
              district_name: 'Distrito Norte',
              pending_consent_count: 1,
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'limit (1..100) u offset (>= 0) inválidos',
  })
  @ApiResponse({
    status: 403,
    description:
      'GUARD_PERMISSION_DENIED: consent:verify no proviene de un rol coordinador (coordinator, zone-coordinator, general-coordinator); los demás revisores usan la lista por sección. GUARD_CLUB_SCOPE_REQUIRED: el coordinador no tiene asignaciones activas que cubran alguna sección activa. ACTING_FOR_SCOPE_DENIED / PRINCIPAL_SCOPE_DENIED: tutor actuando, adolescente supervisado o dispositivo vinculado.',
  })
  async listMyPendingConsents(
    @Req() req: AuthorizedRequest,
    @Query() query: CoordinatorConsentPendingQueryDto,
  ) {
    const data = await this.consentQueue.listForCoordinator(
      req.user.sub,
      req.authorization?.grants?.global_roles,
      {
        limit: query.limit ?? CONSENT_QUEUE_DEFAULT_LIMIT,
        offset: query.offset ?? 0,
      },
    );
    return { status: 'success', data };
  }
}
