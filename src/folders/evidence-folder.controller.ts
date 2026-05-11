import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import {
  FileValidationPipe,
  ALLOWED_MIME_TYPES,
} from '../common/pipes/file-validation.pipe';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { EvidenceFolderService } from './evidence-folder.service';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('Evidence Folder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('club-sections/:sectionId/evidence-folder')
export class EvidenceFolderController {
  constructor(private readonly evidenceFolderService: EvidenceFolderService) {}

  @Get()
  @RequirePermissions('evidence_folders:read')
  @ApiOperation({ summary: 'Get evidence folder for club section' })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Evidence folder with sections and files' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (evidence_folders:read required)',
  })
  @ApiResponse({ status: 404, description: 'Club section not found' })
  async getFolder(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evidenceFolderService.getFolder(
      user.sub,
      sectionId,
    );
    return { status: 'success', data };
  }

  @Post('sections/:efSectionId/submit')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({ summary: 'Submit evidence folder section' })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  @ApiParam({
    name: 'efSectionId',
    description: 'Evidence folder section ID',
    example: 10,
  })
  @ApiResponse({ status: 201, description: 'Section submitted successfully' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (evidence_folders:update required)',
  })
  @ApiResponse({ status: 404, description: 'Club section or evidence folder section not found' })
  async submitSection(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('efSectionId', ParseIntPipe) efSectionId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evidenceFolderService.submitSection(
      user.sub,
      sectionId,
      efSectionId,
    );
    return { status: 'success', data };
  }

  @Post('sections/:efSectionId/files')
  @RequirePermissions('evidence_folders:update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload evidence file' })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  @ApiParam({
    name: 'efSectionId',
    description: 'Evidence folder section ID',
    example: 10,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (evidence_folders:update required)',
  })
  @ApiResponse({ status: 404, description: 'Club section or evidence folder section not found' })
  @ApiResponse({ status: 422, description: 'Invalid file type or size' })
  async uploadFile(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('efSectionId', ParseIntPipe) efSectionId: number,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evidenceFolderService.uploadFile(
      user.sub,
      sectionId,
      efSectionId,
      file,
    );
    return { status: 'success', data };
  }

  @Delete('sections/:efSectionId/files/:fileId')
  @RequirePermissions('evidence_folders:update')
  @ApiOperation({ summary: 'Delete evidence file' })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  @ApiParam({
    name: 'efSectionId',
    description: 'Evidence folder section ID',
    example: 10,
  })
  @ApiParam({
    name: 'fileId',
    description: 'Evidence file ID',
    example: 100,
  })
  @ApiResponse({ status: 200, description: 'File deleted successfully' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (evidence_folders:update required)',
  })
  @ApiResponse({ status: 404, description: 'Evidence file not found' })
  async deleteFile(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('efSectionId', ParseIntPipe) efSectionId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evidenceFolderService.deleteFile(
      user.sub,
      sectionId,
      efSectionId,
      fileId,
    );
    return { status: 'success', data };
  }
}
