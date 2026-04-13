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
import { ValidationService } from './validation.service';
import { SubmitForReviewDto, ReviewValidationDto } from './dto';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('validation')
@Controller('validation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  // ========================================
  // SUBMIT FOR REVIEW (member)
  // ========================================

  @Post('submit')
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('classes:update')
  @ApiOperation({
    summary: 'Enviar clase/honor a revision',
    description:
      'El miembro envia su clase u honor para que el coordinador lo revise',
  })
  @ApiResponse({ status: 201, description: 'Enviado a revision' })
  @ApiResponse({
    status: 400,
    description: 'Estado invalido o entidad no pertenece al usuario',
  })
  @ApiResponse({ status: 404, description: 'Entidad no encontrada' })
  async submitForReview(
    @Body() dto: SubmitForReviewDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.validationService.submitForReview(
      dto.entity_type,
      dto.entity_id,
      user.sub,
    );
  }

  // ========================================
  // REVIEW (coordinator)
  // ========================================

  @Post(':entityType/:entityId/review')
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('classes:update')
  @ApiOperation({
    summary: 'Aprobar o rechazar clase/honor',
    description:
      'El coordinador aprueba o rechaza la validacion de una clase u honor',
  })
  @ApiParam({
    name: 'entityType',
    enum: ['class', 'honor'],
    description: 'Tipo de entidad',
  })
  @ApiParam({
    name: 'entityId',
    type: Number,
    description: 'ID de la entidad (enrollment_id o user_honor_id)',
  })
  @ApiResponse({ status: 201, description: 'Revision registrada' })
  @ApiResponse({
    status: 400,
    description: 'Estado invalido o falta comentario en rechazo',
  })
  @ApiResponse({ status: 404, description: 'Entidad no encontrada' })
  async review(
    @Param('entityType') entityType: 'class' | 'honor',
    @Param('entityId', ParseIntPipe) entityId: number,
    @Body() dto: ReviewValidationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.validationService.review(
      entityType,
      entityId,
      dto.action,
      user.sub,
      dto.comment,
    );
  }

  // ========================================
  // PENDING REVIEWS (coordinator)
  // ========================================

  @Get('pending')
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('classes:read')
  @ApiOperation({
    summary: 'Listar items pendientes de revision',
    description:
      'Obtiene clases y honores con estado pendiente de revision, filtrable por seccion y tipo',
  })
  @ApiQuery({
    name: 'section_id',
    required: false,
    type: Number,
    description: 'Filtrar por seccion del club',
  })
  @ApiQuery({
    name: 'entity_type',
    required: false,
    enum: ['class', 'honor'],
    description: 'Filtrar por tipo de entidad',
  })
  @ApiResponse({ status: 200, description: 'Lista de items pendientes' })
  async getPendingReviews(
    @Query('section_id', new ParseIntPipe({ optional: true }))
    sectionId?: number,
    @Query('entity_type') entityType?: 'class' | 'honor',
  ) {
    return this.validationService.getPendingReviews({
      club_section_id: sectionId,
      entity_type: entityType,
    });
  }

  // ========================================
  // VALIDATION HISTORY
  // ========================================

  @Get(':entityType/:entityId/history')
  @AuthorizationResource({ type: 'active_assignment' })
  @RequirePermissions('classes:read')
  @ApiOperation({
    summary: 'Historial de validacion',
    description:
      'Obtiene el historial de validaciones de una clase u honor especifico',
  })
  @ApiParam({
    name: 'entityType',
    enum: ['class', 'honor'],
    description: 'Tipo de entidad',
  })
  @ApiParam({
    name: 'entityId',
    type: Number,
    description: 'ID de la entidad (enrollment_id o user_honor_id)',
  })
  @ApiResponse({ status: 200, description: 'Historial de validacion' })
  @ApiResponse({ status: 404, description: 'Entidad no encontrada' })
  async getValidationHistory(
    @Param('entityType') entityType: 'class' | 'honor',
    @Param('entityId', ParseIntPipe) entityId: number,
  ) {
    return this.validationService.getValidationHistory(entityType, entityId);
  }

  // ========================================
  // INVESTITURE ELIGIBILITY
  // ========================================

  @Get('eligibility/:userId')
  @RequirePermissions('users:read_detail')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Verificar elegibilidad para investidura',
    description:
      'Comprueba si un usuario cumple el porcentaje minimo de aprobacion configurable para ser investido',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Resultado de elegibilidad con porcentaje y detalle',
  })
  async checkEligibility(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.validationService.checkInvestmentEligibility(userId);
  }
}
