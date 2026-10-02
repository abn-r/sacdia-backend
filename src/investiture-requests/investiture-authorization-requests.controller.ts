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
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AddInvestitureRequestPeopleDto } from './dto/add-investiture-request-people.dto';
import { ChangeInvestitureRequestDatesDto } from './dto/change-investiture-request-dates.dto';
import { PresentInvestitureRequestDto } from './dto/present-investiture-request.dto';
import { ResolveInvestitureRequestDto } from './dto/resolve-investiture-request.dto';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';

type AuthenticatedRequest = {
  user: { sub: string };
};

@ApiTags('investiture-requests')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
@SkipPermissions()
export class InvestitureAuthorizationRequestsController {
  constructor(
    private readonly requests: InvestitureAuthorizationRequestService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Post('club-sections/:sectionId/investiture-requests')
  @ApiOperation({
    summary:
      'Presentar personas de una sección para investidura por autorización. No usa el pipeline anterior.',
  })
  @ApiBody({ type: PresentInvestitureRequestDto })
  async present(
    @Request() req: AuthenticatedRequest,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: PresentInvestitureRequestDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.present(
      profile.authorization,
      req.user.sub,
      sectionId,
      dto.ecclesiastical_year_id,
      dto.investiture_date,
      dto.enrollment_ids,
    );
    return { status: 'success', data };
  }

  @Get('club-sections/:sectionId/investiture-requests')
  @ApiOperation({
    summary:
      'Leer la solicitud con personas pendientes de la sección y el año. Sin pendientes no inserta.',
  })
  async list(
    @Request() req: AuthenticatedRequest,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('ecclesiastical_year_id', ParseIntPipe) ecclesiasticalYearId: number,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.list(
      profile.authorization,
      sectionId,
      ecclesiasticalYearId,
    );
    return { status: 'success', data };
  }

  @Post('investiture-requests/:requestId/people')
  @ApiOperation({
    summary:
      'Agregar personas a una solicitud. La fecha nueva no reescribe a quienes ya estaban.',
  })
  @ApiBody({ type: AddInvestitureRequestPeopleDto })
  async addPeople(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: AddInvestitureRequestPeopleDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.addPeople(
      profile.authorization,
      req.user.sub,
      requestId,
      dto.investiture_date,
      dto.enrollment_ids,
    );
    return { status: 'success', data };
  }

  @Delete('investiture-requests/:requestId/people/:personId')
  @ApiOperation({
    summary:
      'Quitar a una persona pendiente. Libera solo el bloqueo de esa solicitud.',
  })
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.remove(
      profile.authorization,
      req.user.sub,
      requestId,
      personId,
    );
    return { status: 'success', data };
  }

  @Patch('investiture-requests/:requestId/dates')
  @ApiOperation({
    summary:
      'Aplicar una fecha válida a los pendientes seleccionados. No toca al resto.',
  })
  @ApiBody({ type: ChangeInvestitureRequestDatesDto })
  async changeDates(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ChangeInvestitureRequestDatesDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.changeDates(
      profile.authorization,
      req.user.sub,
      requestId,
      dto.investiture_date,
      dto.person_ids,
    );
    return { status: 'success', data };
  }

  @Get('investiture-requests')
  @ApiOperation({
    summary:
      'Solicitudes con pendientes que este pastor o Campo puede autorizar.',
  })
  async listForAuthorizer(
    @Request() req: AuthenticatedRequest,
    @Query('ecclesiastical_year_id', ParseIntPipe) ecclesiasticalYearId: number,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.listForAuthorizer(
      profile.authorization,
      req.user.sub,
      ecclesiasticalYearId,
    );
    return { status: 'success', data };
  }

  @Get('investiture-requests/:requestId')
  @ApiOperation({
    summary:
      'Leer una solicitud para autorizarla. Incluye investidos y rechazados.',
  })
  async readForAuthorizer(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.readForAuthorizer(
      profile.authorization,
      req.user.sub,
      requestId,
    );
    return { status: 'success', data };
  }

  @Post('investiture-requests/:requestId/resolutions')
  @ApiOperation({
    summary:
      'Autorizar o rechazar personas pendientes. No usa el pipeline anterior.',
  })
  @ApiBody({ type: ResolveInvestitureRequestDto })
  async resolve(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ResolveInvestitureRequestDto,
  ) {
    const profile = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    const data = await this.requests.resolve(
      profile.authorization,
      req.user.sub,
      requestId,
      dto,
    );
    return { status: 'success', data };
  }
}
