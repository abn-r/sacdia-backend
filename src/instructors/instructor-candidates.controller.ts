import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { namedThrottle } from '../config/throttler.helpers';
import { SearchInstructorCandidatesDto } from './dto/search-instructor-candidates.dto';
import { InstructorsService } from './instructors.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('instructors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@Controller('instructor-candidates')
export class InstructorCandidatesController {
  constructor(private readonly instructors: InstructorsService) {}

  @Get()
  @Throttle(namedThrottle({ ttl: 60_000, limit: 30 }))
  @ApiOperation({
    summary: 'Buscar instructores de especialidad de tu Campo Local',
    description:
      'Compartido por la carga por certificado y por "Mis especialidades". Solo devuelve usuarios activos, aprobados y mayores de edad de tu mismo Campo Local, sin incluirte. Busca por nombre y apellidos (nunca por correo; mínimo 3 caracteres y 2 por palabra, si no responde []). Máximo 10 resultados. Expone solo `user_id`, `display_name` y `photo_url` (URL firmada de vida corta o null). Límite: 30 consultas por minuto.',
  })
  async search(
    @Request() req: AuthenticatedRequest,
    @Query() query: SearchInstructorCandidatesDto,
  ) {
    const data = await this.instructors.searchCandidates(req.user.sub, query.q);
    return { status: 'success', data };
  }
}
