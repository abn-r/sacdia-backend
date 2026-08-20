import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
  SkipPermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CamporeeScoringService } from './camporee-scoring.service';
import {
  AddCamporeeJudgeDto,
  AssignCamporeeEventJudgeDto,
  ReplaceCamporeeEventRubricsDto,
  SubmitCamporeeEventScoreDto,
  UpdateCamporeeJudgeDto,
  UpdateCamporeeEventJudgeAssignmentDto,
} from './dto';

@ApiTags('camporee-scoring')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CamporeeScoringController {
  private readonly idempotencyKeyPipe = new ParseUUIDPipe({ optional: true });

  constructor(private readonly service: CamporeeScoringService) {}

  @Get('camporee-events/:eventId/rubrics')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  @ApiOperation({ summary: 'List active rubrics for a camporee event' })
  @ApiParam({ name: 'eventId', type: Number })
  async getEventRubrics(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Request() req: any,
  ) {
    const data = await this.service.getEventRubrics(eventId, req.user.sub);
    return { status: 'success', data };
  }

  @Put('camporee-events/:eventId/rubrics')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  @ApiOperation({ summary: 'Replace rubrics for a camporee event' })
  @ApiParam({ name: 'eventId', type: Number })
  async replaceEventRubrics(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: ReplaceCamporeeEventRubricsDto,
    @Request() req: any,
  ) {
    const data = await this.service.replaceEventRubrics(
      eventId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('local-camporees/:camporeeId/judges')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  async listLocalJudges(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    const data = await this.service.listCamporeeJudges({
      type: 'local',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Get('local-camporees/:camporeeId/judge-candidates')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  async listLocalJudgeCandidates(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listCamporeeJudgeCandidates({
      type: 'local',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Post('local-camporees/:camporeeId/judges')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  async addLocalJudge(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AddCamporeeJudgeDto,
    @Request() req: any,
  ) {
    const data = await this.service.addJudgeToCamporee(
      { type: 'local', camporeeId },
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/judges')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  async listUnionJudges(@Param('camporeeId', ParseIntPipe) camporeeId: number) {
    const data = await this.service.listCamporeeJudges({
      type: 'union',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/judge-candidates')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  async listUnionJudgeCandidates(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.listCamporeeJudgeCandidates({
      type: 'union',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Post('union-camporees/:camporeeId/judges')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  async addUnionJudge(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AddCamporeeJudgeDto,
    @Request() req: any,
  ) {
    const data = await this.service.addJudgeToCamporee(
      { type: 'union', camporeeId },
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch('camporee-judges/:judgeId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Update a camporee judge roster member' })
  @ApiParam({ name: 'judgeId', type: String, format: 'uuid' })
  async updateCamporeeJudge(
    @Param('judgeId', ParseUUIDPipe) judgeId: string,
    @Body() dto: UpdateCamporeeJudgeDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateCamporeeJudge(
      judgeId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('camporee-judges/:judgeId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Deactivate a camporee judge roster member' })
  @ApiParam({ name: 'judgeId', type: String, format: 'uuid' })
  async deactivateCamporeeJudge(
    @Param('judgeId', ParseUUIDPipe) judgeId: string,
    @Request() req: any,
  ) {
    const data = await this.service.deactivateCamporeeJudge(
      judgeId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('camporee-events/:eventId/judge-assignments')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  async listEventJudgeAssignments(
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    const data = await this.service.listEventJudgeAssignments(eventId);
    return { status: 'success', data };
  }

  @Post('camporee-events/:eventId/judge-assignments')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  async assignJudgeToSection(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: AssignCamporeeEventJudgeDto,
    @Request() req: any,
  ) {
    const data = await this.service.assignJudgeToSection(
      eventId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Patch('camporee-event-judge-assignments/:assignmentId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'global' })
  async updateJudgeAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UpdateCamporeeEventJudgeAssignmentDto,
    @Request() req: any,
  ) {
    const data = await this.service.updateJudgeAssignment(
      assignmentId,
      dto,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Delete('camporee-event-judge-assignments/:assignmentId')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'global' })
  async deactivateJudgeAssignment(
    @Param('assignmentId') assignmentId: string,
    @Request() req: any,
  ) {
    const data = await this.service.deactivateJudgeAssignment(
      assignmentId,
      req.user.sub,
    );
    return { status: 'success', data };
  }

  @Get('camporee-events/:eventId/scoring-targets')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  @ApiOperation({ summary: 'List enrolled sections that can receive scores' })
  async getScoringTargets(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Request() req: any,
  ) {
    const data = await this.service.getScoringTargets(eventId, req.user.sub);
    return { status: 'success', data };
  }

  @Post('camporee-events/:eventId/sections/:clubSectionId/scores')
  @RequirePermissions('camporee_events:update')
  @AuthorizationResource({ type: 'camporee_event', idParam: 'eventId' })
  @ApiOperation({ summary: 'Submit official camporee score by rubric' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Optional UUID used to safely replay the same score submission.',
  })
  async submitScore(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('clubSectionId', ParseIntPipe) clubSectionId: number,
    @Body() dto: SubmitCamporeeEventScoreDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const validatedIdempotencyKey =
      idempotencyKey === undefined
        ? undefined
        : await this.idempotencyKeyPipe.transform(idempotencyKey, {
            type: 'custom',
            data: 'idempotency-key',
          });
    const data = await this.service.submitScore(
      eventId,
      clubSectionId,
      dto,
      req.user.sub,
      validatedIdempotencyKey,
    );
    return { status: 'success', data };
  }

  @Get('local-camporees/:camporeeId/leaderboard')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'camporee', idParam: 'camporeeId' })
  async getLocalLeaderboard(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.getCamporeeLeaderboard({
      type: 'local',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Get('union-camporees/:camporeeId/leaderboard')
  @RequirePermissions('camporee_events:read')
  @AuthorizationResource({ type: 'union_camporee', idParam: 'camporeeId' })
  async getUnionLeaderboard(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
  ) {
    const data = await this.service.getCamporeeLeaderboard({
      type: 'union',
      camporeeId,
    });
    return { status: 'success', data };
  }

  @Get('camporee-judges/me/assignments')
  @SkipPermissions()
  @ApiOperation({ summary: 'List current user camporee judge assignments' })
  async getMyJudgeAssignments(@Request() req: any) {
    const data = await this.service.getMyJudgeAssignments(req.user.sub);
    return { status: 'success', data };
  }
}
