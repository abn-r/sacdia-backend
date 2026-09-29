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
import { JwtAuthGuard } from '../common/guards';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';
import { CreateInstitutionalCertificateRequestDto } from './dto/create-institutional-certificate-request.dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('certificate-import-institutional-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@Controller('certificate-import-institutional-requests')
export class InstitutionalCertificateRequestsController {
  constructor(
    private readonly service: InstitutionalCertificateRequestsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Enviar solicitud de Guía Mayor Avanzado o Instructor',
  })
  async submit(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateInstitutionalCertificateRequestDto,
  ) {
    const data = await this.service.submit(req.user.sub, dto);
    return { status: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Consultar mis solicitudes institucionales' })
  async listMine(
    @Request() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.listMine(
      req.user.sub,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
    return { status: 'success', data };
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Detalle de una solicitud institucional propia' })
  async getMine(
    @Request() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
  ) {
    const data = await this.service.getMine(req.user.sub, requestId);
    return { status: 'success', data };
  }
}
