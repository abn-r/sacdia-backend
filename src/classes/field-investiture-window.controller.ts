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
import { UpdateInvestitureWindowDto } from './dto/update-investiture-window.dto';
import { FieldInvestitureWindowConfigService } from './field-investiture-window-config.service';

type AuthenticatedRequest = {
  user: { sub: string };
};

@ApiTags('investiture-windows')
@ApiBearerAuth()
@Controller('local-fields/:localFieldId/investiture-windows')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
// El alias de director-lf también admite unión y división, y el de admin admite
// assistant-admin. El servicio deja consultar a unión y división, y editar solo
// a director/asistente de su Campo, admin/assistant-admin en su alcance y super-admin.
@GlobalRoles('super-admin', 'admin', 'director-lf', 'assistant-lf')
@SkipPermissions()
export class FieldInvestitureWindowController {
  constructor(
    private readonly windows: FieldInvestitureWindowConfigService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Get(':ecclesiasticalYearId')
  @ApiOperation({
    summary:
      'Leer la ventana de investidura del Campo. Sin fila, el valor es del 1 de octubre al 20 de diciembre recortado al año. Sin intersección y sin configuración válida, start_date y end_date son null y operational es false.',
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
    const data = await this.windows.get(
      profile.authorization,
      localFieldId,
      ecclesiasticalYearId,
    );
    return { status: 'success', data };
  }

  @Patch(':ecclesiasticalYearId')
  @ApiOperation({
    summary:
      'Guardar la ventana de investidura. No otorga autorización ni permiso para editar el porcentaje de clase.',
  })
  @ApiParam({ name: 'localFieldId', type: Number })
  @ApiParam({ name: 'ecclesiasticalYearId', type: Number })
  @ApiBody({ type: UpdateInvestitureWindowDto })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Param('ecclesiasticalYearId', ParseIntPipe) ecclesiasticalYearId: number,
    @Body() dto: UpdateInvestitureWindowDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.windows.update(
      profile.authorization,
      localFieldId,
      ecclesiasticalYearId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }
}
