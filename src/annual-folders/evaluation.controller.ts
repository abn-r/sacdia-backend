import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { AnnualFoldersService } from './annual-folders.service';
import { EvaluateSectionDto, SetReviewerNoteDto } from './dto';
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
  constructor(
    private readonly evaluationService: EvaluationService,
    private readonly annualFoldersService: AnnualFoldersService,
  ) {}

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

  // ========================================
  // SET REVIEWER NOTE ON EVIDENCE
  // ========================================

  /**
   * Set or clear a granular reviewer note on a single evidence file.
   *
   * This is a surgical field for per-file feedback — it does NOT change the
   * section evaluation, folder status, or any points. It complements the
   * existing section-level notes in annual_folder_section_evaluations.
   *
   * Authorization: requires annual_folders:evaluate (global scope).
   * In practice: assistant-lf, director-lf, and higher global roles.
   *
   * Passing null or empty string clears the note and audit fields.
   */
  @Patch('evidences/:evidenceId/reviewer-note')
  @RequirePermissions('annual_folders:evaluate')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Set or clear a reviewer note on a specific evidence file',
    description:
      'Allows a local-field reviewer (assistant-lf, director-lf) to leave granular feedback on a single evidence file. ' +
      'Does NOT affect the section evaluation or folder status. ' +
      'Send null or empty string to clear an existing note.',
  })
  @ApiParam({ name: 'evidenceId', description: 'Evidence UUID' })
  @ApiBody({ type: SetReviewerNoteDto })
  @ApiResponse({
    status: 200,
    description: 'Reviewer note saved (or cleared) successfully',
    schema: {
      example: {
        status: 'success',
        data: {
          evidence_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          file_url: 'https://storage.example.com/evidence/acta-enero.pdf',
          file_name: 'acta-enero.pdf',
          notes: 'Acta de la reunión del 15 de enero',
          reviewer_note: 'Le falta la firma del secretario en la página 2.',
          reviewer_noted_by: 'Juan Pérez',
          reviewer_noted_at: '2026-04-13T14:00:00.000Z',
          section: { section_id: '...', name: 'Actas' },
          uploader: 'María García',
          reviewer: 'Juan Pérez',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Evidence not found' })
  @ApiResponse({
    status: 403,
    description: 'Missing annual_folders:evaluate permission',
  })
  async setReviewerNote(
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Body() dto: SetReviewerNoteDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.annualFoldersService.setReviewerNote(
      evidenceId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }
}
