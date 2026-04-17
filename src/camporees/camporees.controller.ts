import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CamporeesService } from './camporees.service';
import { CamporeeLateApprovalsService } from './camporee-late-approvals.service';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCamporeeDto,
  UpdateCamporeeDto,
  CreateUnionCamporeeDto,
  UpdateUnionCamporeeDto,
  RegisterMemberDto,
  EnrollClubDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  RejectEnrollmentDto,
  CamporeeStatusQueryDto,
  UnionMembersPaginationDto,
  CamporeeMembersPaginationDto,
} from './dto';

@ApiTags('camporees')
@Controller('camporees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CamporeesController {
  constructor(
    private readonly camporeesService: CamporeesService,
    private readonly camporeeLateApprovalsService: CamporeeLateApprovalsService,
  ) {}

  // ========================================
  // CAMPOREES
  // ========================================

  @Get()
  @ApiOperation({
    summary: 'Listar camporees',
    description: 'Obtiene todos los camporees disponibles',
  })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiResponse({ status: 200, description: 'Lista paginada de camporees' })
  async findAll(
    @Request() req: any,
    @Query('active') active?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.camporeesService.findAll(
      {
        active:
          active === 'true' ? true : active === 'false' ? false : undefined,
      },
      pagination,
      req.authorization,
    );
  }

  // ========================================
  // UNION CAMPOREES
  // ========================================

  @Get('union')
  @ApiOperation({
    summary: 'Listar camporees de unión',
    description: 'Obtiene todos los camporees a nivel de unión',
  })
  @ApiQuery({ name: 'union_id', required: false, type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de camporees de unión',
  })
  async findAllUnion(
    @Request() req: any,
    @Query('union_id', new ParseIntPipe({ optional: true })) unionId?: number,
    @Query('active') active?: string,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.camporeesService.findAllUnion(
      {
        union_id: unionId,
        active:
          active === 'true' ? true : active === 'false' ? false : undefined,
        year,
      },
      pagination,
      req.authorization,
    );
  }

  @Get('union/:camporeeId')
  @ApiOperation({ summary: 'Obtener camporee de unión por ID' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiResponse({ status: 200, description: 'Camporee de unión encontrado' })
  @ApiResponse({
    status: 404,
    description: 'Camporee de unión no encontrado',
  })
  async findOneUnion(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.findOneUnion(camporeeId);
  }

  @Post('union')
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Crear camporee de unión',
    description:
      'Crea un nuevo camporee a nivel de unión (requiere permisos de actividades)',
  })
  @ApiResponse({ status: 201, description: 'Camporee de unión creado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async createUnion(@Body() dto: CreateUnionCamporeeDto, @Request() req: any) {
    return this.camporeesService.createUnion(
      dto,
      req.user.sub,
      req.authorization,
    );
  }

  @Patch('union/:camporeeId')
  @RequirePermissions('activities:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Actualizar camporee de unión' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Camporee de unión actualizado' })
  @ApiResponse({
    status: 404,
    description: 'Camporee de unión no encontrado',
  })
  async updateUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateUnionCamporeeDto,
  ) {
    return this.camporeesService.updateUnion(camporeeId, dto);
  }

  @Delete('union/:camporeeId')
  @RequirePermissions('activities:delete')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Desactivar camporee de unión' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Camporee de unión desactivado',
  })
  @ApiResponse({
    status: 404,
    description: 'Camporee de unión no encontrado',
  })
  async removeUnion(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.removeUnion(camporeeId);
  }

  // ========================================
  // UNION CAMPOREE ENROLLMENT — CLUBS
  // ========================================

  @Post('union/:camporeeId/clubs')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Inscribir club en camporee de unión',
    description: 'Inscribe una sección de club en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 201, description: 'Club inscrito exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async enrollClubToUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: EnrollClubDto,
    @Request() req: any,
  ) {
    return this.camporeesService.enrollClubToUnion(
      camporeeId,
      dto,
      req.user.sub,
    );
  }

  @Get('union/:camporeeId/clubs')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar clubes inscritos en camporee de unión',
    description:
      'Obtiene la lista de secciones de club inscritas en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiResponse({ status: 200, description: 'Lista de clubes inscritos' })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async getUnionEnrolledClubs(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getUnionEnrolledClubs(
      camporeeId,
      query.status,
    );
  }

  @Delete('union/:camporeeId/clubs/:camporeeClubId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Cancelar inscripción de club en camporee de unión',
    description:
      'Cancela la inscripción de una sección de club en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción cancelada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async cancelUnionClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
  ) {
    return this.camporeesService.cancelUnionClubEnrollment(
      camporeeId,
      camporeeClubId,
    );
  }

  // ========================================
  // UNION CAMPOREE ENROLLMENT — MEMBERS
  // ========================================

  @Post('union/:camporeeId/register')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Registrar miembro en camporee de unión',
    description:
      'Registra un miembro en el camporee de unión con validación de seguro',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 201, description: 'Miembro registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async registerMemberToUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: RegisterMemberDto,
  ) {
    return this.camporeesService.registerMemberToUnion(camporeeId, dto);
  }

  @Get('union/:camporeeId/members')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar miembros del camporee de unión',
    description:
      'Obtiene la lista paginada de miembros registrados en el camporee de unión. ' +
      'Página 1-indexed, límite 1-200 (default 100).',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Elementos por página, máximo 200 (default: 100)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de miembros' })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async getUnionMembers(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
    @Query() pagination: UnionMembersPaginationDto,
  ) {
    return this.camporeesService.getUnionMembers(
      camporeeId,
      query.status,
      pagination,
    );
  }

  @Delete('union/:camporeeId/members/:userId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Remover miembro del camporee de unión',
    description: 'Desactiva el registro de un miembro en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Miembro removido' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async removeUnionMember(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.camporeesService.removeUnionMember(camporeeId, userId);
  }

  // ========================================
  // UNION CAMPOREE ENROLLMENT — PAYMENTS
  // ========================================

  @Post('union/:camporeeId/members/:memberId/payments')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Registrar pago de miembro en camporee de unión',
    description:
      'Registra un pago para un miembro inscrito en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'memberId', type: Number })
  @ApiResponse({ status: 201, description: 'Pago registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({
    status: 404,
    description: 'Miembro o camporee de unión no encontrado',
  })
  async createUnionPayment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() dto: CreatePaymentDto,
    @Request() req: any,
  ) {
    return this.camporeesService.createUnionPayment(
      camporeeId,
      memberId,
      dto,
      req.user.sub,
    );
  }

  @Get('union/:camporeeId/members/:memberId/payments')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar pagos de un miembro en camporee de unión',
    description:
      'Obtiene la lista de pagos realizados por un miembro del camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'memberId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiResponse({ status: 200, description: 'Lista de pagos del miembro' })
  @ApiResponse({
    status: 404,
    description: 'Miembro o camporee de unión no encontrado',
  })
  async getUnionMemberPayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getUnionMemberPayments(
      camporeeId,
      memberId,
      query.status,
    );
  }

  @Get('union/:camporeeId/payments')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar todos los pagos del camporee de unión',
    description: 'Obtiene un resumen de todos los pagos del camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de pagos del camporee de unión',
  })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async getUnionCamporeePayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getUnionCamporeePayments(
      camporeeId,
      query.status,
    );
  }

  // ========================================
  // UNION CAMPOREE ENROLLMENT — APPROVALS
  // ========================================

  @Get('union/:camporeeId/pending')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary:
      'Listar inscripciones pendientes de aprobación en camporee de unión',
    description:
      'Obtiene todos los clubes, miembros y pagos con estado pending_approval en el camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripciones pendientes' })
  @ApiResponse({ status: 404, description: 'Camporee de unión no encontrado' })
  async listUnionPendingApprovals(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return this.camporeeLateApprovalsService.listUnionPending(camporeeId);
  }

  @Patch('union/:camporeeId/clubs/:camporeeClubId/approve')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Aprobar inscripción tardía de club en camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de club aprobada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async approveUnionClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.approveUnionClubEnrollment(
      camporeeId,
      camporeeClubId,
      req.user.sub,
    );
  }

  @Patch('union/:camporeeId/clubs/:camporeeClubId/reject')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Rechazar inscripción tardía de club en camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de club rechazada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async rejectUnionClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.rejectUnionClubEnrollment(
      camporeeId,
      camporeeClubId,
      req.user.sub,
      dto.rejection_reason,
    );
  }

  @Patch('union/:camporeeId/members/:camporeeMemberId/approve')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Aprobar inscripción tardía de miembro en camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeMemberId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de miembro aprobada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async approveUnionMemberEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeMemberId', ParseIntPipe) camporeeMemberId: number,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.approveUnionMemberEnrollment(
      camporeeId,
      camporeeMemberId,
      req.user.sub,
    );
  }

  @Patch('union/:camporeeId/members/:camporeeMemberId/reject')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Rechazar inscripción tardía de miembro en camporee de unión',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeMemberId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de miembro rechazada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async rejectUnionMemberEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeMemberId', ParseIntPipe) camporeeMemberId: number,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.rejectUnionMemberEnrollment(
      camporeeId,
      camporeeMemberId,
      req.user.sub,
      dto.rejection_reason,
    );
  }

  // ========================================
  // LATE ENROLLMENT APPROVALS
  // ========================================

  @Get(':camporeeId/pending')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar inscripciones pendientes de aprobación',
    description:
      'Obtiene todos los clubes, miembros y pagos con estado pending_approval en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripciones pendientes' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async listPendingApprovals(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return this.camporeeLateApprovalsService.listPending(camporeeId);
  }

  @Patch(':camporeeId/clubs/:camporeeClubId/approve')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Aprobar inscripción tardía de club' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de club aprobada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async approveClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.approveLocalClubEnrollment(
      camporeeId,
      camporeeClubId,
      req.user.sub,
    );
  }

  @Patch(':camporeeId/clubs/:camporeeClubId/reject')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Rechazar inscripción tardía de club' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de club rechazada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async rejectClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.rejectLocalClubEnrollment(
      camporeeId,
      camporeeClubId,
      req.user.sub,
      dto.rejection_reason,
    );
  }

  @Patch(':camporeeId/members/:camporeeMemberId/approve')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Aprobar inscripción tardía de miembro' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeMemberId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de miembro aprobada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async approveMemberEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeMemberId', ParseIntPipe) camporeeMemberId: number,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.approveLocalMemberEnrollment(
      camporeeId,
      camporeeMemberId,
      req.user.sub,
    );
  }

  @Patch(':camporeeId/members/:camporeeMemberId/reject')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Rechazar inscripción tardía de miembro' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeMemberId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción de miembro rechazada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async rejectMemberEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeMemberId', ParseIntPipe) camporeeMemberId: number,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.rejectLocalMemberEnrollment(
      camporeeId,
      camporeeMemberId,
      req.user.sub,
      dto.rejection_reason,
    );
  }

  // ========================================
  // LOCAL CAMPOREES (detail)
  // ========================================

  @Get(':camporeeId')
  @ApiOperation({ summary: 'Obtener camporee por ID' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @RequirePermissions('activities:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiResponse({ status: 200, description: 'Camporee encontrado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async findOne(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.findOne(camporeeId);
  }

  @Post()
  @RequirePermissions('activities:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Crear camporee',
    description:
      'Crea un nuevo camporee (requiere permisos de actividades en el contexto activo)',
  })
  @ApiResponse({ status: 201, description: 'Camporee creado' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes' })
  async create(@Body() dto: CreateCamporeeDto, @Request() req: any) {
    return this.camporeesService.create(dto, req.user.sub, req.authorization);
  }

  @Patch(':camporeeId')
  @RequirePermissions('activities:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Actualizar camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Camporee actualizado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async update(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: UpdateCamporeeDto,
  ) {
    return this.camporeesService.update(camporeeId, dto);
  }

  @Delete(':camporeeId')
  @RequirePermissions('activities:delete')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({ summary: 'Desactivar camporee' })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Camporee desactivado' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async remove(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.remove(camporeeId);
  }

  // ========================================
  // INSCRIPCIONES
  // ========================================

  @Post(':camporeeId/register')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Registrar miembro en camporee',
    description: 'Registra un miembro en el camporee con validación de seguro',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 201, description: 'Miembro registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async registerMember(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: RegisterMemberDto,
  ) {
    return this.camporeesService.registerMember(camporeeId, dto);
  }

  @Get(':camporeeId/members')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar miembros del camporee',
    description:
      'Obtiene la lista paginada de miembros registrados en el camporee. ' +
      'Página 1-indexed, límite 1-100 (default 50).',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['registered', 'pending_approval', 'approved', 'rejected'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Elementos por página, máximo 100 (default: 50)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de miembros' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getMembers(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
    @Query() pagination: CamporeeMembersPaginationDto,
  ) {
    return this.camporeesService.getMembers(camporeeId, query.status, pagination);
  }

  @Delete(':camporeeId/members/:userId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Remover miembro del camporee',
    description: 'Desactiva el registro de un miembro en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Miembro removido' })
  @ApiResponse({ status: 404, description: 'Registro no encontrado' })
  async removeMember(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.camporeesService.removeMember(camporeeId, userId);
  }

  // ========================================
  // CLUB ENROLLMENT
  // ========================================

  @Post(':camporeeId/clubs')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Inscribir club en camporee',
    description:
      'Inscribe una sección de club en el camporee (requiere permisos de registro)',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 201, description: 'Club inscrito exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async enrollClub(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: EnrollClubDto,
    @Request() req: any,
  ) {
    return this.camporeesService.enrollClub(camporeeId, dto, req.user.sub);
  }

  @Get(':camporeeId/clubs')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar clubes inscritos en camporee',
    description:
      'Obtiene la lista de secciones de club inscritas en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['registered', 'pending_approval', 'approved', 'rejected'],
  })
  @ApiResponse({ status: 200, description: 'Lista de clubes inscritos' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getEnrolledClubs(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getEnrolledClubs(camporeeId, query.status);
  }

  @Delete(':camporeeId/clubs/:camporeeClubId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Cancelar inscripción de club',
    description: 'Cancela la inscripción de una sección de club en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'camporeeClubId', type: Number })
  @ApiResponse({ status: 200, description: 'Inscripción cancelada' })
  @ApiResponse({ status: 404, description: 'Inscripción no encontrada' })
  async cancelClubEnrollment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('camporeeClubId', ParseIntPipe) camporeeClubId: number,
  ) {
    return this.camporeesService.cancelClubEnrollment(
      camporeeId,
      camporeeClubId,
    );
  }

  // ========================================
  // PAYMENTS
  // ========================================

  @Post(':camporeeId/members/:memberId/payments')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Registrar pago de miembro',
    description: 'Registra un pago para un miembro inscrito en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'memberId', type: Number })
  @ApiResponse({ status: 201, description: 'Pago registrado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación' })
  @ApiResponse({ status: 404, description: 'Miembro o camporee no encontrado' })
  async createPayment(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() dto: CreatePaymentDto,
    @Request() req: any,
  ) {
    return this.camporeesService.createPayment(
      camporeeId,
      memberId,
      dto,
      req.user.sub,
    );
  }

  @Get(':camporeeId/members/:memberId/payments')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar pagos de un miembro',
    description:
      'Obtiene la lista de pagos realizados por un miembro del camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiParam({ name: 'memberId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiResponse({ status: 200, description: 'Lista de pagos del miembro' })
  @ApiResponse({ status: 404, description: 'Miembro o camporee no encontrado' })
  async getMemberPayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getMemberPayments(
      camporeeId,
      memberId,
      query.status,
    );
  }

  @Get(':camporeeId/payments')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar todos los pagos del camporee',
    description: 'Obtiene un resumen de todos los pagos del camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  @ApiResponse({ status: 200, description: 'Lista de pagos del camporee' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getCamporeePayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: CamporeeStatusQueryDto,
  ) {
    return this.camporeesService.getCamporeePayments(camporeeId, query.status);
  }

  @Patch('payments/:paymentId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Actualizar pago',
    description: 'Actualiza los datos de un pago registrado',
  })
  @ApiParam({ name: 'paymentId', type: String })
  @ApiResponse({ status: 200, description: 'Pago actualizado' })
  @ApiResponse({ status: 404, description: 'Pago no encontrado' })
  async updatePayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.camporeesService.updatePayment(paymentId, dto);
  }

  @Patch('payments/:camporeePaymentId/approve')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Aprobar pago tardío de camporee' })
  @ApiParam({
    name: 'camporeePaymentId',
    type: String,
    description: 'UUID del pago',
  })
  @ApiResponse({ status: 200, description: 'Pago aprobado' })
  @ApiResponse({ status: 404, description: 'Pago no encontrado' })
  async approvePayment(
    @Param('camporeePaymentId', ParseUUIDPipe) camporeePaymentId: string,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.approvePayment(
      camporeePaymentId,
      req.user.sub,
    );
  }

  @Patch('payments/:camporeePaymentId/reject')
  @RequirePermissions('attendance:approve_late')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Rechazar pago tardío de camporee' })
  @ApiParam({
    name: 'camporeePaymentId',
    type: String,
    description: 'UUID del pago',
  })
  @ApiResponse({ status: 200, description: 'Pago rechazado' })
  @ApiResponse({ status: 404, description: 'Pago no encontrado' })
  async rejectPayment(
    @Param('camporeePaymentId', ParseUUIDPipe) camporeePaymentId: string,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.camporeeLateApprovalsService.rejectPayment(
      camporeePaymentId,
      req.user.sub,
      dto.rejection_reason,
    );
  }
}
