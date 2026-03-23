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
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards';
import { EvidenceFolderService } from './evidence-folder.service';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('Evidence Folder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('club-sections/:sectionId/evidence-folder')
export class EvidenceFolderController {
  constructor(
    private readonly evidenceFolderService: EvidenceFolderService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get evidence folder for club section' })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  async getFolder(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.evidenceFolderService.getFolder(user.sub, sectionId);
    return { status: 'success', data };
  }

  @Post('sections/:efSectionId/submit')
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
  async uploadFile(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('efSectionId', ParseIntPipe) efSectionId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({
            fileType: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
          }),
        ],
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
