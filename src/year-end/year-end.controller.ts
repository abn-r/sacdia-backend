import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { YearEndService } from './year-end.service';
import { GlobalRoles } from '../common/decorators';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';

@ApiTags('year-end')
@Controller('year-end')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@ApiBearerAuth()
export class YearEndController {
  constructor(private readonly yearEndService: YearEndService) {}

  // ========================================
  // PREVIEW CLOSURE IMPACT
  // ========================================

  @Get(':yearId/preview')
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Vista previa del impacto de cierre de ano',
    description:
      'Muestra que matriculas, carpetas e informes serian afectados al cerrar el ano eclesiastico. No realiza cambios.',
  })
  @ApiParam({
    name: 'yearId',
    description: 'ID del ano eclesiastico',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Vista previa del impacto de cierre',
  })
  @ApiResponse({ status: 404, description: 'Ano eclesiastico no encontrado' })
  async previewClosure(@Param('yearId', ParseIntPipe) yearId: number) {
    const data = await this.yearEndService.previewClosureImpact(yearId);
    return { status: 'success', data };
  }

  // ========================================
  // CLOSE YEAR
  // ========================================

  @Post(':yearId/close')
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Cerrar ano eclesiastico',
    description:
      'Ejecuta el cierre completo del ano eclesiastico: cierra matriculas, carpetas anuales y auto-genera informes mensuales en borrador. Operacion irreversible.',
  })
  @ApiParam({
    name: 'yearId',
    description: 'ID del ano eclesiastico a cerrar',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del cierre ejecutado',
  })
  @ApiResponse({
    status: 400,
    description: 'El ano ya esta inactivo o cerrado',
  })
  @ApiResponse({ status: 404, description: 'Ano eclesiastico no encontrado' })
  async closeYear(@Param('yearId', ParseIntPipe) yearId: number) {
    const data = await this.yearEndService.closeYear(yearId);
    return { status: 'success', data };
  }
}
