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
import { CatalogsService } from '../catalogs/catalogs.service';
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
    private readonly catalogsService: CatalogsService,
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
  @ApiResponse({
    status: 200,
    description:
      'Annual folder details, or null if no active enrollment or no folder created yet for this section',
  })
  async getFolderBySection(
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    const [activeYear, enrollment] = await Promise.all([
      this.catalogsService.getCurrentEcclesiasticalYear(),
      this.clubEnrollmentsService.findCurrentBySectionId(sectionId),
    ]);

    // Ausencia de año eclesiástico o de inscripción son estados de negocio
    // válidos (club recién creado, campo local aún no hizo el setup anual).
    // Devolvemos 200 + null, igual que GET /enrollments/current (commit 0d97360).
    if (!activeYear || !enrollment) {
      return { status: 'success', data: null };
    }

    let data: unknown;
    try {
      data = await this.annualFoldersService.getFolderByEnrollment(
        enrollment.club_enrollment_id,
      );
    } catch (err: unknown) {
      // La carpeta no existe todavía — estado de negocio válido, no un error.
      // Dejamos pasar cualquier otro error (ForbiddenException, 500, etc.).
      if (err instanceof NotFoundException) {
        return { status: 'success', data: null };
      }
      throw err;
    }

    return { status: 'success', data };
  }
}
