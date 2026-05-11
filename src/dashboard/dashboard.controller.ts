import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Resumen del dashboard del usuario autenticado',
    description:
      'Retorna estadísticas agregadas: clase actual y progreso, honores, actividades próximas e información del club',
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
  @ApiResponse({ status: 401, description: 'No autorizado — JWT ausente o inválido' })
  @ApiResponse({ status: 403, description: 'Token válido pero sin acceso al recurso' })
  async getSummary(@Request() req) {
    return this.dashboardService.getSummary(req.user.sub);
  }
}
