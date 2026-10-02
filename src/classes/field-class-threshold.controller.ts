import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { UpdateFieldClassThresholdDto } from './dto/update-field-class-threshold.dto';
import { FieldClassThresholdConfigService } from './field-class-threshold-config.service';

type AuthenticatedRequest = {
  user: { sub: string };
};

@ApiTags('class-thresholds')
@ApiBearerAuth()
@Controller('local-fields/:localFieldId/class-thresholds')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
// El alias de `director-lf` en GlobalRolesGuard también admite unión y división.
// El servicio rechaza esos roles, a admin y a un Campo ajeno.
@GlobalRoles('super-admin', 'director-lf', 'assistant-lf')
@SkipPermissions()
export class FieldClassThresholdController {
  constructor(
    private readonly thresholds: FieldClassThresholdConfigService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Get(':ecclesiasticalYearId')
  @ApiOperation({
    summary:
      'Leer el porcentaje de clase del Campo para un año eclesiástico. Sin fila, el valor efectivo es 80.',
  })
  @ApiParam({ name: 'localFieldId', type: Number })
  @ApiParam({ name: 'ecclesiasticalYearId', type: Number })
  async get(
    @Request() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Param('ecclesiasticalYearId', ParseIntPipe) ecclesiasticalYearId: number,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.thresholds.get(
      profile.authorization,
      localFieldId,
      ecclesiasticalYearId,
    );
    return { status: 'success', data };
  }

  @Patch(':ecclesiasticalYearId')
  @ApiOperation({
    summary:
      'Guardar el porcentaje de clase. Director y asistente del Campo hasta el 30 de junio 23:59 en la zona del Campo. Después, solo super-admin, y solo dentro del año eclesiástico vigente.',
  })
  @ApiParam({ name: 'localFieldId', type: Number })
  @ApiParam({ name: 'ecclesiasticalYearId', type: Number })
  @ApiBody({ type: UpdateFieldClassThresholdDto })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Param('ecclesiasticalYearId', ParseIntPipe) ecclesiasticalYearId: number,
    @Body() dto: UpdateFieldClassThresholdDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.thresholds.update(
      profile.authorization,
      localFieldId,
      ecclesiasticalYearId,
      dto.minimum_percent,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
