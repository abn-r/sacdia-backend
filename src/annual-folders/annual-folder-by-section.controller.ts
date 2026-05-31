import {
  Controller,
  Get,
  HttpException,
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
import { ErrorCode } from '../common/errors/error-codes';

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
      'Resolves the active ecclesiastical year, finds the enrollment for the given section, and returns the full annual folder. ' +
      'Returns 200 with data: null when no active enrollment or no folder has been created yet — both are valid business states.',
  })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID (integer)',
    example: 1,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description:
      'Annual folder details, or { status: "success", data: null } if no active enrollment or folder exists yet',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid JWT',
  })
  @ApiResponse({
    status: 403,
    description:
      'Caller lacks the evidence_folders:read permission for this section',
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
      if (
        err instanceof NotFoundException ||
        (err instanceof HttpException &&
          'code' in err &&
          (err.code === ErrorCode.ANNUAL_FOLDER_NOT_FOUND ||
            err.code === ErrorCode.ANNUAL_FOLDER_ENROLLMENT_NOT_FOUND))
      ) {
        return { status: 'success', data: null };
      }
      throw err;
    }

    return { status: 'success', data };
  }
}
