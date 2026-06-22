import {
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  ParseIntPipe,
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
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { ClubEnrollmentsService } from '../club-enrollments/club-enrollments.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { AnnualFoldersService } from './annual-folders.service';
import { ErrorCode } from '../common/errors/error-codes';
import { AppNotFoundException } from '../common/errors/app.exception';

@ApiTags('Annual Evidence Folders')
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
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @ApiOperation({
    summary: 'Get annual evidence folder for a club section (current year)',
    description:
      'Resolves the active ecclesiastical year, finds the enrollment for the given section, and returns the full annual evidence folder. ' +
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
      'Annual Evidence Folder details, or { status: "success", data: null } if no active enrollment or folder exists yet',
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
    @CurrentUser() user: { sub: string },
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
        user.sub,
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

  @Post()
  @RequirePermissions('evidence_folders:update')
  @AuthorizationResource({ type: 'club_section', idParam: 'sectionId' })
  @ApiOperation({
    summary: 'Create annual evidence folder for a club section',
    description:
      'Resolves the current ecclesiastical-year enrollment for the section and creates its annual evidence folder. This is the user-facing creation path; users do not need the enrollment UUID.',
  })
  @ApiParam({
    name: 'sectionId',
    description: 'Club section ID (integer)',
    example: 1,
    type: Number,
  })
  @ApiResponse({ status: 201, description: 'Annual Evidence Folder created' })
  @ApiResponse({
    status: 404,
    description: 'No current enrollment or matching template was found',
  })
  @ApiResponse({
    status: 409,
    description: 'Folder already exists for the current enrollment',
  })
  async createFolderBySection(
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @CurrentUser() user: { sub: string },
  ) {
    const enrollment =
      await this.clubEnrollmentsService.findCurrentBySectionId(sectionId);

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_NOT_FOUND,
        { id: sectionId },
      );
    }

    const data = await this.annualFoldersService.createFolderForEnrollment(
      enrollment.club_enrollment_id,
      user.sub,
    );

    return { status: 'success', data };
  }
}
