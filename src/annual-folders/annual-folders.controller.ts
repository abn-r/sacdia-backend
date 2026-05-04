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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Multer } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  FileValidationPipe,
  ALLOWED_MIME_TYPES,
} from '../common/pipes/file-validation.pipe';
import { AnnualFoldersService } from './annual-folders.service';
import {
  CreateTemplateDto,
  CreateTemplateSectionDto,
  UpdateTemplateSectionDto,
  UploadEvidenceDto,
  UpdateEvidenceDto,
} from './dto';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

type CurrentUserPayload = {
  sub: string;
};

// ========================================
// TEMPLATE MANAGEMENT (Admin)
// ========================================

@ApiTags('Annual Folders - Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('annual-folders/templates')
export class AnnualFolderTemplatesController {
  constructor(private readonly service: AnnualFoldersService) {}

  @Post()
  @RequirePermissions('annual_folder_templates:create')
  @ApiOperation({ summary: 'Create folder template for a club type and year' })
  @ApiResponse({ status: 201, description: 'Template created' })
  @ApiResponse({
    status: 409,
    description: 'Template already exists for this combination',
  })
  async createTemplate(@Body() dto: CreateTemplateDto) {
    const data = await this.service.createTemplate(dto);
    return { status: 'success', data };
  }

  @Get(':templateId')
  @RequirePermissions('annual_folder_templates:read')
  @ApiOperation({ summary: 'Get template by ID with all sections' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Template details' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async getTemplate(@Param('templateId', ParseUUIDPipe) templateId: string) {
    const data = await this.service.getTemplate(templateId);
    return { status: 'success', data };
  }

  @Get()
  @RequirePermissions('annual_folder_templates:read')
  @ApiOperation({ summary: 'Get template by club type and year' })
  @ApiQuery({
    name: 'club_type_id',
    required: true,
    description: 'Club type ID',
    example: 2,
  })
  @ApiQuery({
    name: 'year_id',
    required: true,
    description: 'Ecclesiastical year ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Template with sections' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async getTemplateByClubTypeAndYear(
    @Query('club_type_id', ParseIntPipe) clubTypeId: number,
    @Query('year_id', ParseIntPipe) yearId: number,
  ) {
    const data = await this.service.getTemplateByClubTypeAndYear(
      clubTypeId,
      yearId,
    );
    return { status: 'success', data };
  }

  @Post(':templateId/sections')
  @RequirePermissions('annual_folder_templates:update')
  @ApiOperation({ summary: 'Add section to template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 201, description: 'Section added' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async addSection(
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: CreateTemplateSectionDto,
  ) {
    const data = await this.service.addTemplateSection(templateId, dto);
    return { status: 'success', data };
  }

  @Patch('sections/:sectionId')
  @RequirePermissions('annual_folder_templates:update')
  @ApiOperation({ summary: 'Update template section' })
  @ApiParam({ name: 'sectionId', description: 'Section UUID' })
  @ApiResponse({ status: 200, description: 'Section updated' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  async updateSection(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateTemplateSectionDto,
  ) {
    const data = await this.service.updateTemplateSection(sectionId, dto);
    return { status: 'success', data };
  }

  @Delete('sections/:sectionId')
  @RequirePermissions('annual_folder_templates:delete')
  @ApiOperation({ summary: 'Remove template section' })
  @ApiParam({ name: 'sectionId', description: 'Section UUID' })
  @ApiResponse({ status: 200, description: 'Section deleted' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  @ApiResponse({ status: 409, description: 'Section has evidences' })
  async removeSection(@Param('sectionId', ParseUUIDPipe) sectionId: string) {
    const data = await this.service.removeTemplateSection(sectionId);
    return { status: 'success', ...data };
  }
}

// ========================================
// ANNUAL FOLDER OPERATIONS (Club level)
// ========================================

@ApiTags('Annual Folders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('annual-folders')
export class AnnualFoldersController {
  constructor(private readonly service: AnnualFoldersService) {}

  @Post('enrollments/:enrollmentId')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({ summary: 'Create annual folder for a club enrollment' })
  @ApiParam({ name: 'enrollmentId', description: 'Club enrollment UUID' })
  @ApiResponse({ status: 201, description: 'Annual folder created' })
  @ApiResponse({ status: 404, description: 'Enrollment or template not found' })
  @ApiResponse({
    status: 409,
    description: 'Folder already exists for enrollment',
  })
  async createFolderForEnrollment(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    const data = await this.service.createFolderForEnrollment(enrollmentId);
    return { status: 'success', data };
  }

  @Get(':folderId')
  @RequirePermissions('evidence_folders:read')
  @ApiOperation({ summary: 'Get annual folder with sections and evidences' })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiResponse({
    status: 200,
    description: 'Folder details',
    schema: {
      example: {
        status: 'success',
        data: {
          annual_folder_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          status: 'open',
          submitted_at: null,
          closed_at: null,
          evaluated_at: null,
          created_at: '2026-04-14T10:00:00.000Z',
          total_earned_points: 0,
          total_max_points: 100,
          progress_percentage: 0,
          local_camporee_id: 5,
          union_camporee_id: null,
          requires_union_confirmation: false,
          club_enrollment: {},
          template: {},
          sections: [],
          total_sections: 0,
          total_evidences: 0,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  async getFolder(@Param('folderId', ParseUUIDPipe) folderId: string) {
    const data = await this.service.getFolder(folderId);
    return { status: 'success', data };
  }

  @Get('by-enrollment/:enrollmentId')
  @RequirePermissions('evidence_folders:read')
  @ApiOperation({ summary: 'Get annual folder by enrollment ID' })
  @ApiParam({ name: 'enrollmentId', description: 'Club enrollment UUID' })
  @ApiResponse({
    status: 200,
    description: 'Folder details',
    schema: {
      example: {
        status: 'success',
        data: {
          annual_folder_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          status: 'open',
          submitted_at: null,
          closed_at: null,
          evaluated_at: null,
          created_at: '2026-04-14T10:00:00.000Z',
          total_earned_points: 0,
          total_max_points: 100,
          progress_percentage: 0,
          local_camporee_id: null,
          union_camporee_id: 12,
          requires_union_confirmation: true,
          club_enrollment: {},
          template: {},
          sections: [],
          total_sections: 0,
          total_evidences: 0,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Folder not found for enrollment' })
  async getFolderByEnrollment(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    const data = await this.service.getFolderByEnrollment(enrollmentId);
    return { status: 'success', data };
  }

  @Post(':folderId/sections/:sectionId/evidences')
  @RequirePermissions('evidence_folders:update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload evidence to a folder section' })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiParam({ name: 'sectionId', description: 'Template section UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Evidence file (image or PDF, max 5MB)',
        },
        notes: {
          type: 'string',
          description: 'Optional notes about the evidence',
          example: 'Acta de la reunión del 15 de enero',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Evidence uploaded' })
  @ApiResponse({
    status: 400,
    description: 'Folder is not open or invalid file',
  })
  @ApiResponse({ status: 404, description: 'Folder or section not found' })
  async uploadEvidence(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
      }),
    )
    file: Multer.File,
    @Body() dto: UploadEvidenceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.uploadEvidence(
      folderId,
      sectionId,
      dto,
      user.sub,
      file,
    );
    return { status: 'success', data };
  }

  @Patch('evidences/:evidenceId')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({ summary: 'Update evidence metadata' })
  @ApiParam({ name: 'evidenceId', description: 'Evidence UUID' })
  @ApiResponse({ status: 200, description: 'Evidence updated' })
  @ApiResponse({ status: 400, description: 'Folder is not open' })
  @ApiResponse({ status: 404, description: 'Evidence not found' })
  async updateEvidence(
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Body() dto: UpdateEvidenceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.updateEvidence(evidenceId, dto, user.sub);
    return { status: 'success', data };
  }

  @Delete('evidences/:evidenceId')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({ summary: 'Delete evidence' })
  @ApiParam({ name: 'evidenceId', description: 'Evidence UUID' })
  @ApiResponse({ status: 200, description: 'Evidence deleted' })
  @ApiResponse({ status: 400, description: 'Folder is not open' })
  @ApiResponse({ status: 404, description: 'Evidence not found' })
  async deleteEvidence(
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.deleteEvidence(evidenceId, user.sub);
    return { status: 'success', ...data };
  }

  /**
   * Section status — club user or coordinator read operation.
   * Returns the current snapshot for one section: evidence count,
   * submission record (if any), and evaluation record (if any).
   */
  @Get(':folderId/sections/:sectionId/status')
  @RequirePermissions('evidence_folders:read')
  @ApiOperation({
    summary:
      'Get the current status of a single section within an annual folder',
    description:
      'Returns section metadata, evidence count, submission record (if submitted), and evaluation record (if evaluated). Useful for the Flutter app to show per-section progress.',
  })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiParam({ name: 'sectionId', description: 'Template section UUID' })
  @ApiResponse({ status: 200, description: 'Section status snapshot' })
  @ApiResponse({ status: 404, description: 'Folder or section not found' })
  async getSectionStatus(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ) {
    const data = await this.service.getSectionStatus(folderId, sectionId);
    return { status: 'success', data };
  }

  /**
   * Per-section submit — club user operation.
   * Marks a single section as submitted. The folder-level status is NOT changed.
   * The Flutter app should call this after uploading evidence for each section.
   */
  @Post(':folderId/sections/:sectionId/submit')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({
    summary: 'Submit a single section of an annual folder',
    description:
      'Club-user operation. Records that the user has finished uploading evidence for this section. Does NOT change the overall folder status.',
  })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiParam({ name: 'sectionId', description: 'Template section UUID' })
  @ApiResponse({ status: 201, description: 'Section submitted' })
  @ApiResponse({
    status: 400,
    description: 'Folder is not open or section has no evidence',
  })
  @ApiResponse({ status: 404, description: 'Folder or section not found' })
  async submitSection(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.submitSection(
      folderId,
      sectionId,
      user.sub,
    );
    return { status: 'success', data };
  }

  /**
   * Folder-level submit — coordinator / field admin operation only.
   * Permission: annual_folders:submit (NOT evidence_folders:update).
   * Regular club users must NOT call this endpoint; they use the per-section
   * submit above and the coordinator closes the loop from the admin panel.
   */
  @Post(':folderId/submit')
  @RequirePermissions('annual_folders:submit')
  @ApiOperation({
    summary: 'Submit entire folder for review (coordinator/admin only)',
    description:
      "Changes folder status from 'open' to 'submitted'. Restricted to coordinators and field admins (annual_folders:submit permission). Club users should submit per-section instead.",
  })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiResponse({ status: 200, description: 'Folder submitted' })
  @ApiResponse({ status: 400, description: 'Folder is not open' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  async submitFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.submitFolder(folderId, user.sub);
    return { status: 'success', data };
  }

  @Post(':folderId/close')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({
    summary: 'Close folder (field-level action)',
    description:
      "Closes an annual folder. Accepts folders in 'submitted' or 'evaluated' status.",
  })
  @ApiParam({ name: 'folderId', description: 'Annual folder UUID' })
  @ApiResponse({ status: 200, description: 'Folder closed' })
  @ApiResponse({
    status: 400,
    description: "Folder is not in 'submitted' or 'evaluated' status",
  })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  async closeFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.service.closeFolder(folderId, user.sub);
    return { status: 'success', data };
  }
}
