import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';
import {
  ApproveInstitutionalCertificateRequestDto,
  RejectInstitutionalCertificateRequestDto,
} from './dto/review-institutional-certificate-request.dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('admin-certificate-import-institutional-requests')
@ApiBearerAuth()
@Controller('admin/certificate-import-institutional-requests')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@GlobalRoles('super-admin')
@SkipPermissions()
export class AdminInstitutionalCertificateRequestsController {
  constructor(
    private readonly service: InstitutionalCertificateRequestsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Bandeja institucional de certificados' })
  async list(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('class_id') classId?: string,
    @Query('q') q?: string,
  ) {
    const parsedClassId = classId ? Number(classId) : undefined;
    const data = await this.service.listForReview(
      req.user.sub,
      Number(page ?? 1),
      Number(limit ?? 20),
      {
        status,
        classId:
          parsedClassId && Number.isInteger(parsedClassId)
            ? parsedClassId
            : undefined,
        q,
      },
    );
    return { status: 'success', data };
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Detalle institucional para el superadministrador' })
  async getOne(
    @Request() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
  ) {
    const data = await this.service.getForReview(req.user.sub, requestId);
    return { status: 'success', data };
  }

  @Post(':requestId/approve')
  @ApiOperation({
    summary: 'Validar solicitud institucional sin crear una inscripción',
  })
  async approve(
    @Request() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveInstitutionalCertificateRequestDto,
  ) {
    const data = await this.service.approve(req.user.sub, requestId, dto);
    return { status: 'success', data };
  }

  @Post(':requestId/reject')
  @ApiOperation({ summary: 'Rechazar solicitud institucional con motivo' })
  async reject(
    @Request() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() dto: RejectInstitutionalCertificateRequestDto,
  ) {
    const data = await this.service.reject(req.user.sub, requestId, dto);
    return { status: 'success', data };
  }
}
