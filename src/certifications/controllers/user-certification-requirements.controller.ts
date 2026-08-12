import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CertificationRequirementsService } from '../requirements/certification-requirements.service';
import { CertificationEvidenceService } from '../evidence/certification-evidence.service';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { SaveRequirementDraftDto } from '../dto/save-requirement-draft.dto';
import { SubmitRequirementDto } from '../dto/submit-requirement.dto';
import { PresignCertificationEvidenceDto } from '../dto/presign-certification-evidence.dto';
import { ConfirmCertificationEvidenceDto } from '../dto/confirm-certification-evidence.dto';

@ApiTags('certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('certifications')
export class UserCertificationRequirementsController {
  constructor(
    private readonly requirementsService: CertificationRequirementsService,
    private readonly evidenceService: CertificationEvidenceService,
  ) {}

  @Get(
    'users/:userId/certification-enrollments/:enrollmentId/requirements/:requirementId',
  )
  @RequirePermissions('user_certifications:read')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Ver el estado de un requisito de la inscripción',
    description:
      'Devuelve el estado, respuestas guardadas y componentes de un requisito de la versión inscrita.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'requirementId', description: 'ID del requisito (sección)' })
  @ApiResponse({ status: 200, description: 'Estado del requisito' })
  @ApiResponse({
    status: 404,
    description: 'Inscripción no encontrada o no pertenece al usuario',
  })
  async getRequirement(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
  ) {
    const data = await this.requirementsService.getRequirement(
      userId,
      enrollmentId,
      requirementId,
    );
    return { status: 'success', data };
  }

  @Patch(
    'users/:userId/certification-enrollments/:enrollmentId/requirements/:requirementId/draft',
  )
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Guardar borrador de un requisito',
    description:
      'Guarda o actualiza las respuestas de los componentes de un requisito mientras está en DRAFT o CHANGES_REQUESTED.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'requirementId', description: 'ID del requisito (sección)' })
  @ApiResponse({ status: 200, description: 'Borrador guardado' })
  @ApiResponse({
    status: 409,
    description: 'El requisito está bloqueado para edición',
  })
  async saveDraft(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: SaveRequirementDraftDto,
  ) {
    const data = await this.requirementsService.saveDraft(
      userId,
      enrollmentId,
      requirementId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post(
    'users/:userId/certification-enrollments/:enrollmentId/requirements/:requirementId/submit',
  )
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Enviar un requisito a revisión',
    description:
      'Transiciona el requisito a SUBMITTED (o re-envía desde CHANGES_REQUESTED) validando que los componentes obligatorios estén completos.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'requirementId', description: 'ID del requisito (sección)' })
  @ApiResponse({ status: 200, description: 'Requisito enviado a revisión' })
  @ApiResponse({
    status: 400,
    description: 'Faltan componentes obligatorios',
  })
  @ApiResponse({
    status: 409,
    description:
      'El requisito está bloqueado para edición o hubo un conflicto de concurrencia',
  })
  async submitRequirement(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: SubmitRequirementDto,
  ) {
    const data = await this.requirementsService.submitRequirement(
      userId,
      enrollmentId,
      requirementId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post(
    'users/:userId/certification-enrollments/:enrollmentId/requirements/:requirementId/evidences/presign',
  )
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Solicitar URL firmada para subir evidencia de un requisito',
    description:
      'Genera una clave de objeto controlada por el servidor y una URL firmada de subida a R2. Crea la evidencia en estado PENDING_UPLOAD.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'requirementId', description: 'ID del requisito (sección)' })
  @ApiResponse({ status: 201, description: 'URL de subida generada' })
  @ApiResponse({
    status: 400,
    description: 'Tipo de archivo o tamaño no permitido',
  })
  async presignEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: PresignCertificationEvidenceDto,
  ) {
    const data = await this.evidenceService.presign(
      userId,
      enrollmentId,
      requirementId,
      dto,
    );
    return { status: 'success', data };
  }

  @Post(
    'users/:userId/certification-enrollments/:enrollmentId/requirements/:requirementId/evidences/confirm',
  )
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Confirmar que la evidencia fue subida a R2',
    description:
      'Valida el objeto subido (tipo y tamaño reales) y transiciona la evidencia de PENDING_UPLOAD a CONFIRMED.',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'requirementId', description: 'ID del requisito (sección)' })
  @ApiResponse({ status: 201, description: 'Evidencia confirmada' })
  @ApiResponse({
    status: 400,
    description: 'El archivo subido no coincide con lo declarado',
  })
  async confirmEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body() dto: ConfirmCertificationEvidenceDto,
  ) {
    const data = await this.evidenceService.confirm(
      userId,
      enrollmentId,
      requirementId,
      dto,
    );
    return { status: 'success', data };
  }

  @Delete(
    'users/:userId/certification-enrollments/:enrollmentId/evidences/:evidenceId',
  )
  @RequirePermissions('user_certifications:manage')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Eliminar una evidencia',
    description:
      'Elimina (soft-delete) una evidencia mientras el requisito que la contiene siga editable (DRAFT o CHANGES_REQUESTED).',
  })
  @ApiParam({ name: 'userId', description: 'UUID del usuario' })
  @ApiParam({ name: 'enrollmentId', description: 'ID de la inscripción' })
  @ApiParam({ name: 'evidenceId', description: 'ID de la evidencia' })
  @ApiResponse({ status: 200, description: 'Evidencia eliminada' })
  @ApiResponse({
    status: 409,
    description: 'El requisito ya no admite eliminar evidencias',
  })
  async deleteEvidence(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Param('evidenceId', ParseIntPipe) evidenceId: number,
  ) {
    const data = await this.evidenceService.delete(
      userId,
      enrollmentId,
      evidenceId,
    );
    return { status: 'success', data };
  }
}
