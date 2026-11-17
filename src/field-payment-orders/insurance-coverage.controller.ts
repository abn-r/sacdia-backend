import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { InsuranceCoverageService } from './insurance-coverage.service';

@ApiTags('insurance coverage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class InsuranceCoverageController {
  constructor(private readonly coverage: InsuranceCoverageService) {}

  @Get('club-sections/:sectionId/insurance/overview')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @ApiOperation({
    summary:
      'Resumen anual de seguros de la sección: ciclo, conteos y estado por persona (miembros y directiva)',
  })
  @ApiParam({ name: 'sectionId', type: Number })
  async overview(@Param('sectionId', ParseIntPipe) sectionId: number) {
    return {
      status: 'success',
      data: await this.coverage.getOverview(sectionId),
    };
  }

  @Get('club-sections/:sectionId/insurance/free-coverages')
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @ApiOperation({
    summary:
      'Seguros libres: coberturas vigentes de la sección cuyo titular ya no es miembro/directiva del club (reasignables directamente)',
  })
  @ApiParam({ name: 'sectionId', type: Number })
  async freeCoverages(@Param('sectionId', ParseIntPipe) sectionId: number) {
    const items = await this.coverage.getFreeCoverages(sectionId);
    return {
      status: 'success',
      data: { count: items.length, items },
    };
  }
}
