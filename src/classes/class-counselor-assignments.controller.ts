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
import {
  CreateClassCounselorAssignmentDto,
  UpdateClassCounselorAssignmentDto,
} from './dto';
import { ClassCounselorAssignmentsService } from './class-counselor-assignments.service';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('class-counselor-assignments')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClassCounselorAssignmentsController {
  constructor(
    private readonly assignmentsService: ClassCounselorAssignmentsService,
  ) {}

  @Get('clubs/:clubId/sections/:sectionId/class-counselor-assignments')
  @RequirePermissions('club_roles:read')
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'sectionId',
    clubIdParam: 'clubId',
  })
  @ApiOperation({
    summary: 'Listar asignaciones pedagógicas de clases por sección',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({ name: 'yearId', required: false, type: Number })
  @ApiQuery({ name: 'classId', required: false, type: Number })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Asignaciones de clase' })
  async listAssignments(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('yearId', new ParseIntPipe({ optional: true }))
    ecclesiasticalYearId?: number,
    @Query('classId', new ParseIntPipe({ optional: true }))
    classId?: number,
    @Query('active') active?: string,
  ) {
    return this.assignmentsService.listAssignments({
      clubId,
      sectionId,
      ecclesiasticalYearId,
      classId,
      active: this.parseOptionalBoolean(active),
    });
  }

  @Post('clubs/:clubId/sections/:sectionId/class-counselor-assignments')
  @RequirePermissions('club_roles:assign')
  @AuthorizationResource({
    type: 'club_section',
    idParam: 'sectionId',
    clubIdParam: 'clubId',
  })
  @ApiOperation({
    summary: 'Asignar un consejero o secretario a una clase progresiva',
  })
  @ApiParam({ name: 'clubId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiResponse({ status: 201, description: 'Asignación creada' })
  async createAssignment(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: CreateClassCounselorAssignmentDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    return this.assignmentsService.createAssignment({
      clubId,
      sectionId,
      actorUserId: currentUser.sub,
      dto,
    });
  }

  @Patch('class-counselor-assignments/:assignmentId')
  @RequirePermissions('club_roles:assign')
  @AuthorizationResource({
    type: 'class_counselor_assignment',
    idParam: 'assignmentId',
  })
  @ApiOperation({ summary: 'Actualizar una asignación pedagógica de clase' })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Asignación actualizada' })
  async updateAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateClassCounselorAssignmentDto,
  ) {
    return this.assignmentsService.updateAssignment(assignmentId, dto);
  }

  @Delete('class-counselor-assignments/:assignmentId')
  @RequirePermissions('club_roles:revoke')
  @AuthorizationResource({
    type: 'class_counselor_assignment',
    idParam: 'assignmentId',
  })
  @ApiOperation({ summary: 'Revocar una asignación pedagógica de clase' })
  @ApiParam({ name: 'assignmentId', type: String })
  @ApiResponse({ status: 200, description: 'Asignación revocada' })
  async removeAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.assignmentsService.removeAssignment(assignmentId);
  }

  private parseOptionalBoolean(value?: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }
}
