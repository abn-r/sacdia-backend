import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardPendingService } from './dashboard-pending.service';
import { JwtAuthGuard } from '../common/guards';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { ActingScope } from '../auth/acting-for/acting-scope.decorator';
import {
  principalSeesClubData,
  type AuthPrincipal,
} from '../auth/acting-for/auth-principal';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly dashboardPendingService: DashboardPendingService,
  ) {}

  @Get('summary')
  @ActingScope('self:read')
  @ApiOperation({
    summary: 'Resumen del dashboard del usuario autenticado',
    description:
      'Retorna estadísticas agregadas: clase actual y progreso, honores, actividades próximas e información del club. Un adolescente sin tutor verificado (supervised_user pendiente) o una cuenta sin edad conocida recibe club_name, club_type y user_role en null y upcoming_activities vacío: ven su propio progreso, nunca datos del club.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del dashboard',
    schema: {
      example: {
        user_name: 'Juan Pérez',
        user_avatar: null,
        club_name: 'Club Central',
        club_type: 'Conquistadores',
        user_role: 'member',
        current_class_name: 'Amigo',
        current_class_id: 1,
        investiture_status: 'IN_PROGRESS',
        class_progress: 40,
        honors_completed: 3,
        honors_in_progress: 1,
        upcoming_activities: [
          {
            id: 1,
            title: 'Campamento de Verano',
            date: '2026-04-10T09:00:00',
            activity_date: '2026-04-10',
            activity_time: '09:00',
            location: 'Parque Nacional',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado — JWT ausente o inválido',
  })
  @ApiResponse({
    status: 403,
    description: 'Token válido pero sin acceso al recurso',
  })
  async getSummary(@Request() req: { user: AuthPrincipal }) {
    return this.dashboardService.getSummary(req.user.sub, {
      includeClubData: principalSeesClubData(req.user),
    });
  }

  @Get('pending')
  @ActingScope('self:read')
  @ApiOperation({
    summary: 'Pendientes accionables del usuario en su sección activa',
    description:
      'Solo lectura. Cuenta lo que el usuario puede atender en su sección de club activa (la misma que resuelve la autorización: users_pr.active_club_assignment_id o la primera asignación operativa): solicitudes de membresía (club_members:approve o consent:verify; un revisor solo-verificación ve solo lo que le muestra GET /club-sections/:sectionId/membership-requests), secciones de la carpeta anual del año actual rechazadas o sin enviar (evidence_folders:read), informe mensual del periodo vigente sin enviar (reports:submit) y autorizaciones de investidura pendientes (mismas reglas que GET /investiture-requests; no depende de la sección). Cada permiso se evalúa sobre la asignación activa, no sobre permisos globales. Un item solo aparece con count > 0. Orden: urgent, warning, info. Si una sub-consulta falla se registra y se omite ese item. Sin pendientes (o un adolescente sin tutor verificado / cuenta sin edad conocida): items vacío, total 0.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pendientes del usuario',
    schema: {
      example: {
        section_id: 123,
        generated_at: '2026-11-04T18:00:00.000Z',
        total: 13,
        urgent: 1,
        items: [
          {
            type: 'evidence_folder',
            count: 2,
            rejected_count: 1,
            not_submitted_count: 1,
            severity: 'urgent',
          },
          {
            type: 'monthly_report',
            count: 1,
            period_month: 10,
            period_year: 2026,
            report_status: 'draft',
            due_date: '2026-11-05',
            days_left: 1,
            severity: 'urgent',
          },
          { type: 'membership_requests', count: 3, severity: 'warning' },
          { type: 'investiture_authorizations', count: 7, severity: 'info' },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado — JWT ausente o inválido',
  })
  @ApiResponse({
    status: 403,
    description: 'Token válido pero sin acceso al recurso',
  })
  async getPending(@Request() req: { user: AuthPrincipal }) {
    return this.dashboardPendingService.getPending(req.user.sub, {
      includeClubData: principalSeesClubData(req.user),
    });
  }
}
