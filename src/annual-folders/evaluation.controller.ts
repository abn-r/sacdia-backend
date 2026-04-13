import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { EvaluateSectionDto } from './dto';
import { AuthorizationResource, CurrentUser, RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('Annual Folders - Evaluation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('annual-folders')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  // ========================================
  // EVALUATE A SECTION
  // ========================================

  @Post(':folderId/sections/:sectionId/evaluate')
  @RequirePermissions('annual_folders:evaluate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Evaluate a section of an annual folder' })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiParam({ name: 'sectionId', description: 'Template section UUID' })
  @ApiResponse({ status: 201, description: 'Section evaluated' })
  @ApiResponse({
    status: 400,
    description: 'Folder status invalid or earned_points exceeds max_points',
  })
  @ApiResponse({ status: 404, description: 'Folder or section not found' })
  async evaluateSection(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: EvaluateSectionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evaluationService.evaluateSection(
      folderId,
      sectionId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  // ========================================
  // REOPEN A SECTION
  // ========================================

  @Post(':folderId/sections/:sectionId/reopen')
  @RequirePermissions('annual_folders:evaluate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Reopen a section for re-evaluation (removes existing evaluation)',
  })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiParam({ name: 'sectionId', description: 'Template section UUID' })
  @ApiResponse({ status: 201, description: 'Section reopened' })
  @ApiResponse({
    status: 400,
    description: 'Folder status does not allow reopening',
  })
  @ApiResponse({ status: 404, description: 'Folder or evaluation not found' })
  async reopenSection(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evaluationService.reopenSection(
      folderId,
      sectionId,
      user.sub,
    );
    return { status: 'success', data };
  }

  // ========================================
  // GET FOLDER EVALUATIONS
  // ========================================

  @Get(':folderId/evaluations')
  @RequirePermissions({
    permissions: ['annual_folders:evaluate', 'evidence_folders:read'],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Get all section evaluations for a folder' })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiResponse({ status: 200, description: 'List of section evaluations' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  async getFolderEvaluations(
    @Param('folderId', ParseUUIDPipe) folderId: string,
  ) {
    const data = await this.evaluationService.getFolderEvaluations(folderId);
    return { status: 'success', data };
  }
}
