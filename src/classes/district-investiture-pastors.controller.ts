import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRoles } from '../common/decorators';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AssignDistrictInvestiturePastorDto } from './dto/assign-district-investiture-pastor.dto';
import { SearchPastorCandidatesDto } from './dto/search-pastor-candidates.dto';
import { UpdateInvestiturePastorQuotaDto } from './dto/update-investiture-pastor-quota.dto';
import { DistrictInvestiturePastorService } from './district-investiture-pastors.service';

type AuthenticatedRequest = {
  user: { sub: string };
};

@ApiTags('investiture-pastors')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
// El alias de director-lf también admite unión y división. El servicio deja
// asignar solo a director y asistente de Campo o de unión, dentro de su alcance.
// super-admin cambia el cupo global y no asigna por ese rol.
@GlobalRoles('super-admin', 'director-lf', 'assistant-lf')
@SkipPermissions()
export class DistrictInvestiturePastorsController {
  constructor(
    private readonly pastors: DistrictInvestiturePastorService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Get('investiture-pastor-quota')
  @ApiOperation({
    summary:
      'Leer el cupo global de pastores por distrito. Sin fila, el valor es 2 y no se inserta.',
  })
  async getQuota(@Request() req: AuthenticatedRequest) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.getQuota(profile.authorization);
    return { status: 'success', data };
  }

  @Patch('investiture-pastor-quota')
  @ApiOperation({
    summary:
      'Cambiar el cupo global. Solo super-admin. El mismo tope vale para todos los distritos.',
  })
  @ApiBody({ type: UpdateInvestiturePastorQuotaDto })
  async updateQuota(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateInvestiturePastorQuotaDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.updateQuota(
      profile.authorization,
      dto.slots,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('districts/:districtId/investiture-pastors')
  @ApiOperation({
    summary:
      'Listar los pastores asignados al distrito. Cada cupo activo puede autorizar.',
  })
  async list(
    @Request() req: AuthenticatedRequest,
    @Param('districtId', ParseIntPipe) districtId: number,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.list(profile.authorization, districtId);
    return { status: 'success', data };
  }

  @Post('districts/:districtId/investiture-pastors')
  @ApiOperation({
    summary:
      'Asignar un pastor al distrito. No autoriza investiduras por sí mismo ni usa el pipeline anterior.',
  })
  @ApiBody({ type: AssignDistrictInvestiturePastorDto })
  async assign(
    @Request() req: AuthenticatedRequest,
    @Param('districtId', ParseIntPipe) districtId: number,
    @Body() dto: AssignDistrictInvestiturePastorDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.assign(
      profile.authorization,
      districtId,
      dto.user_id,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('districts/:districtId/investiture-pastors/:userId')
  @ApiOperation({
    summary:
      'Quitar la asignación de un pastor. Libera el cupo. No inviste ni rechaza.',
  })
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('districtId', ParseIntPipe) districtId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.remove(
      profile.authorization,
      districtId,
      userId,
    );
    return { status: 'success', data };
  }

  @Get('investiture-pastor-candidates')
  @ApiOperation({
    summary:
      'Buscar candidatos a pastor por nombre o correo (mínimo 3 caracteres y 2 por palabra, hasta 20). Solo quien puede asignar: director y asistente de Campo o de unión. Devuelve únicamente pastores de su Campo (o de los Campos de su unión). Con `districtId` solo devuelve pastores del Campo de ese distrito.',
  })
  async candidates(
    @Request() req: AuthenticatedRequest,
    @Query() query: SearchPastorCandidatesDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.searchCandidates(
      profile.authorization,
      query.q,
      query.districtId,
    );
    return { status: 'success', data };
  }

  @Get('clubs/:clubId/investiture-authorizers')
  @ApiOperation({
    summary:
      'Leer quién puede autorizar por el distrito de la iglesia del club. No usa el distrito guardado en el club ni un dato del usuario.',
  })
  async authorizers(
    @Request() req: AuthenticatedRequest,
    @Param('clubId', ParseIntPipe) clubId: number,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.pastors.authorizersForClub(
      profile.authorization,
      clubId,
    );
    return { status: 'success', data };
  }
}
