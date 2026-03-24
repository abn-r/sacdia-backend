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
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCamporeeDto,
  UpdateCamporeeDto,
  RegisterMemberDto,
  EnrollClubDto,
  CreatePaymentDto,
  UpdatePaymentDto,
} from './dto';

@ApiTags('camporees')
@Controller('camporees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CamporeesController {
  constructor(private readonly camporeesService: CamporeesService) {}

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
    description: 'Obtiene la lista de miembros registrados en el camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de miembros' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getMembers(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    return this.camporeesService.getMembers(camporeeId);
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
    @Param('userId') userId: string,
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
  @ApiResponse({ status: 200, description: 'Lista de clubes inscritos' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getEnrolledClubs(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return this.camporeesService.getEnrolledClubs(camporeeId);
  }

  @Delete(':camporeeId/clubs/:camporeeClubId')
  @RequirePermissions('attendance:manage')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Cancelar inscripción de club',
    description:
      'Cancela la inscripción de una sección de club en el camporee',
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
    description:
      'Registra un pago para un miembro inscrito en el camporee',
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
  @ApiResponse({ status: 200, description: 'Lista de pagos del miembro' })
  @ApiResponse({ status: 404, description: 'Miembro o camporee no encontrado' })
  async getMemberPayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return this.camporeesService.getMemberPayments(camporeeId, memberId);
  }

  @Get(':camporeeId/payments')
  @RequirePermissions('attendance:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  @ApiOperation({
    summary: 'Listar todos los pagos del camporee',
    description:
      'Obtiene un resumen de todos los pagos del camporee',
  })
  @ApiParam({ name: 'camporeeId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de pagos del camporee' })
  @ApiResponse({ status: 404, description: 'Camporee no encontrado' })
  async getCamporeePayments(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    return this.camporeesService.getCamporeePayments(camporeeId);
  }

  @Patch('payments/:paymentId')
  @RequirePermissions('attendance:manage')
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
}
