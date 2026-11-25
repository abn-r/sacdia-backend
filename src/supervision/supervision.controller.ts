import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { SupervisionService } from './supervision.service';

type CurrentUserPayload = {
  sub?: string;
  user_id?: string;
};

@ApiTags('supervision')
@Controller('supervision')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SupervisionController {
  constructor(private readonly supervision: SupervisionService) {}

  @Get('pending-counts')
  @RequirePermissions({
    permissions: [
      'club_enrollments:validate',
      'annual_folders:evaluate',
      'requests:review',
      'attendance:approve_late',
    ],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Pendientes de supervisión territorial para el hub de la app',
    description:
      'Conteos de pendientes en el territorio del actor. Cada conteo se calcula solo si el actor tiene la capability de esa función; si no, es null. Con territorio sin configurar responde 200 con todos los conteos en null. Sin caché de servidor.',
  })
  @ApiResponse({ status: 200, description: 'Conteos de pendientes' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getPendingCounts(@CurrentUser() user: CurrentUserPayload) {
    const data = await this.supervision.getPendingCounts(
      user.user_id ?? user.sub ?? 'unknown',
    );
    return { status: 'success', data };
  }
}
