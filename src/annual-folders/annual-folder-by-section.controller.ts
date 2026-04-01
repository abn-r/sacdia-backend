import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { ClubEnrollmentsService } from '../club-enrollments/club-enrollments.service';
import { AnnualFoldersService } from './annual-folders.service';

@ApiTags('Annual Folders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('club-sections/:sectionId/annual-folder')
export class AnnualFolderBySectionController {
  constructor(
    private readonly annualFoldersService: AnnualFoldersService,
    private readonly clubEnrollmentsService: ClubEnrollmentsService,
  ) {}

  @Get()
  @RequirePermissions('evidence_folders:read')
  @ApiOperation({
    summary: 'Get annual folder for a club section (current year)',
    description:
      'Resolves the active ecclesiastical year, finds the enrollment for the given section, and returns the full annual folder.',
  })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Annual folder details' })
  @ApiResponse({
    status: 404,
    description:
      'No active enrollment for this section, or no annual folder created yet',
  })
  async getFolderBySection(
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    const enrollment =
      await this.clubEnrollmentsService.findCurrentBySectionId(sectionId);

    if (!enrollment) {
      throw new NotFoundException(
        'No hay inscripción activa para esta sección',
      );
    }

    let data: unknown;
    try {
      data = await this.annualFoldersService.getFolderByEnrollment(
        enrollment.club_enrollment_id,
      );
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException &&
        (err.message as string).includes(enrollment.club_enrollment_id)
      ) {
        throw new NotFoundException(
          'No se ha creado carpeta de evidencias para esta sección',
        );
      }
      throw err;
    }

    return { status: 'success', data };
  }
}
