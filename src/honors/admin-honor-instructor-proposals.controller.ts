import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { HonorInstructorProposalsService } from './honor-instructor-proposals.service';
import {
  ListHonorInstructorProposalsDto,
  RejectHonorInstructorProposalDto,
} from './dto/honor-instructor-proposals.dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

/**
 * Cola del Campo Local (D11). Mismo revisor y mismo patrón que
 * `admin/certificate-bulk-imports`; el alcance es el Campo Local del DUEÑO de
 * la especialidad (403 `HONOR_INSTRUCTOR_PROPOSAL_FORBIDDEN` fuera de él).
 */
@ApiTags('admin-honor-instructor-proposals')
@ApiBearerAuth()
@Controller('admin/honor-instructor-proposals')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles(
  'super-admin',
  'admin',
  'assistant-admin',
  'director-lf',
  'assistant-lf',
)
@SkipPermissions()
export class AdminHonorInstructorProposalsController {
  constructor(private readonly service: HonorInstructorProposalsService) {}

  @Get()
  @ApiOperation({
    summary: 'Cola de propuestas de instructor',
    description:
      'Más antigua primero. `status` admite PENDING (por defecto), APPROVED y REJECTED. Sin correo ni foto firmada.',
  })
  async list(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListHonorInstructorProposalsDto,
  ) {
    const data = await this.service.list(req.user.sub, query);
    return { status: 'success', data };
  }

  @Post(':proposalId/approve')
  @ApiOperation({
    summary: 'Aprobar una propuesta de instructor',
    description:
      'Revalida al instructor y escribe solo users_honors.instructor_* (nunca el estado ni las fechas).',
  })
  @ApiParam({ name: 'proposalId', description: 'ID UUID de la propuesta' })
  async approve(
    @Request() req: AuthenticatedRequest,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    const data = await this.service.approve(req.user.sub, proposalId);
    return { status: 'success', data };
  }

  @Post(':proposalId/reject')
  @ApiOperation({
    summary: 'Rechazar una propuesta de instructor con motivo',
    description: 'No toca users_honors. El miembro ve el motivo.',
  })
  @ApiParam({ name: 'proposalId', description: 'ID UUID de la propuesta' })
  async reject(
    @Request() req: AuthenticatedRequest,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: RejectHonorInstructorProposalDto,
  ) {
    const data = await this.service.reject(req.user.sub, proposalId, dto);
    return { status: 'success', data };
  }
}
