import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { ClassProgressScopeService } from './class-progress-scope.service';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('class-progress-scope')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClassProgressScopeController {
  constructor(
    private readonly progressScopeService: ClassProgressScopeService,
  ) {}

  @Get('clubs/:clubId/sections/:sectionId/classes/progress-scope')
  @RequirePermissions('classes:read')
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'sectionId',
    clubIdParam: 'clubId',
  })
  @ApiOperation({
    summary: 'Listar clases visibles para seguimiento de progreso',
    description:
      'Retorna las clases que el actor puede supervisar en una sección: toda la sección para roles directivos/secretaría o sólo clases asignadas para consejeros.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({ name: 'yearId', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Scope de clases del actor' })
  async getProgressScope(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('yearId', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId: number | undefined,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    return this.progressScopeService.getProgressScope({
      actorUserId: currentUser.sub,
      clubId,
      sectionId,
      ecclesiasticalYearId,
    });
  }

  @Get('clubs/:clubId/sections/:sectionId/classes/:classId/members-progress')
  @RequirePermissions('classes:read')
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'sectionId',
    clubIdParam: 'clubId',
  })
  @ApiOperation({
    summary: 'Listar avance de miembros por clase en una sección',
    description:
      'Retorna el avance resumido de los miembros activos de la sección inscritos en la clase solicitada.',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiParam({ name: 'classId', type: Number })
  @ApiQuery({ name: 'yearId', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Avance resumido por miembro' })
  @ApiResponse({ status: 403, description: 'Clase fuera del scope del actor' })
  async getClassMembersProgress(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('classId', ParseIntPipe) classId: number,
    @Query('yearId', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId: number | undefined,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    return this.progressScopeService.getClassMembersProgress({
      actorUserId: currentUser.sub,
      clubId,
      sectionId,
      classId,
      ecclesiasticalYearId,
    });
  }
}
