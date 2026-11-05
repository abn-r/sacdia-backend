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
import { ExactGlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { UpdateInvestitureWindowDto } from './dto/update-investiture-window.dto';
import {
  FieldInvestitureWindowConfigService,
  INVESTITURE_WINDOW_CONSULT_ROLES,
} from './field-investiture-window-config.service';
import { GlobalRole } from '../common/authorization/roles';

type AuthenticatedRequest = {
  user: { sub: string };
};

@ApiTags('investiture-windows')
@ApiBearerAuth()
@Controller('local-fields/:localFieldId/investiture-windows')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
// Roles exactos por método, sin alias: unión y división solo LEEN la ventana;
// escribirla es trabajo del Campo (director/asistente), admin/assistant-admin
// y super-admin. El servicio repite esa frontera y valida el alcance.
@SkipPermissions()
export class FieldInvestitureWindowController {
  constructor(
    private readonly windows: FieldInvestitureWindowConfigService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Get(':ecclesiasticalYearId')
  @ExactGlobalRoles(...INVESTITURE_WINDOW_CONSULT_ROLES)
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
  @ExactGlobalRoles(
    GlobalRole.SUPER_ADMIN,
    GlobalRole.ADMIN,
    GlobalRole.ASSISTANT_ADMIN,
    GlobalRole.DIRECTOR_LF,
    GlobalRole.ASSISTANT_LF,
  )
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
