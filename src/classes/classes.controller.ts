import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
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
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ClassesService } from './classes.service';
import { EnrollClassDto, UpdateProgressDto } from './dto';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import {
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { PaginationDto } from '../common/dto/pagination.dto';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('classes')
@Controller('classes')
@UseGuards(OptionalJwtAuthGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  // ========================================
  // CLASSES - Public browsing
  // ========================================

  @Get()
  @ApiOperation({
    summary: 'Listar clases',
    description:
      'Lista todas las clases activas con paginación, opcionalmente filtradas por tipo de club',
  })
  @ApiQuery({
    name: 'clubTypeId',
    required: false,
    type: Number,
    description:
      'Filtrar por tipo de club (1=Aventureros, 2=Conquistadores, 3=GM)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (1-indexed)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página (max 100)',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de clases' })
  async findAll(
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.classesService.findAll(clubTypeId, pagination);
  }

  @Get(':classId')
  @ApiOperation({
    summary: 'Obtener clase por ID',
    description: 'Retorna la clase con todos sus módulos y secciones',
  })
  @ApiParam({ name: 'classId', type: Number })
  @ApiResponse({ status: 200, description: 'Clase encontrada' })
  @ApiResponse({ status: 404, description: 'Clase no encontrada' })
  async findOne(@Param('classId', ParseIntPipe) classId: number) {
    return this.classesService.findOne(classId);
  }

  @Get(':classId/modules')
  @ApiOperation({
    summary: 'Obtener módulos de una clase',
    description: 'Lista los módulos con sus secciones',
  })
  @ApiParam({ name: 'classId', type: Number })
  @ApiResponse({ status: 200, description: 'Módulos de la clase' })
  async getModules(@Param('classId', ParseIntPipe) classId: number) {
    return this.classesService.getModules(classId);
  }
}

// ========================================
// USER ENROLLMENTS CONTROLLER
// ========================================

@ApiTags('user-classes')
@Controller('users/:userId/classes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @RequirePermissions('classes:read')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Obtener inscripciones del usuario',
    description: 'Lista las clases en las que está inscrito el usuario',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiQuery({
    name: 'yearId',
    required: false,
    type: Number,
    description: 'Filtrar por año eclesiástico',
  })
  @ApiResponse({ status: 200, description: 'Inscripciones del usuario' })
  async getEnrollments(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('yearId', new ParseIntPipe({ optional: true })) yearId?: number,
  ) {
    return this.classesService.getUserEnrollments(userId, yearId);
  }

  @Post('enroll')
  @RequirePermissions('classes:submit_progress')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Inscribir usuario en clase',
    description: 'Inscribe al usuario en una clase para el año eclesiástico',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 201, description: 'Inscripción creada' })
  async enroll(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: EnrollClassDto,
  ) {
    return this.classesService.enrollUser(
      userId,
      dto.class_id,
      dto.ecclesiastical_year_id,
    );
  }

  @Get(':classId/progress')
  @RequirePermissions('classes:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary: 'Obtener progreso del usuario en una clase',
    description:
      'Retorna el progreso detallado por módulo y sección resolviendo una inscripción anual única; usa enrollmentId si el contexto class-scoped es ambiguo',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'classId', type: Number })
  @ApiQuery({
    name: 'enrollmentId',
    required: false,
    type: Number,
    description:
      'Override aditivo para seleccionar una inscripción anual específica',
  })
  @ApiResponse({ status: 200, description: 'Progreso del usuario' })
  @ApiResponse({
    status: 404,
    description: 'No existe inscripción anual resoluble',
  })
  @ApiResponse({
    status: 409,
    description: 'La solicitud class-scoped es ambigua; enviar enrollmentId',
  })
  async getProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('classId', ParseIntPipe) classId: number,
    @Query('enrollmentId', new ParseIntPipe({ optional: true }))
    enrollmentId?: number,
    @CurrentUser() currentUser?: CurrentUserPayload,
  ) {
    return this.classesService.getUserProgress(
      userId,
      classId,
      enrollmentId,
      currentUser?.sub ?? userId,
    );
  }

  @Patch(':classId/progress')
  @RequirePermissions('classes:submit_progress')
  @AuthorizationResource({ type: 'active_assignment', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Actualizar progreso de sección',
    description:
      'Actualiza el puntaje y evidencias de una sección específica resolviendo una inscripción anual; usa enrollment_id si el contexto class-scoped es ambiguo',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'classId', type: Number })
  @ApiResponse({ status: 200, description: 'Progreso actualizado' })
  @ApiResponse({
    status: 404,
    description: 'No existe inscripción anual resoluble',
  })
  @ApiResponse({
    status: 409,
    description: 'La solicitud class-scoped es ambigua; enviar enrollment_id',
  })
  async updateProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() currentUser?: CurrentUserPayload,
  ) {
    return this.classesService.updateSectionProgress(
      userId,
      classId,
      dto.module_id,
      dto.section_id,
      dto.score,
      dto.evidences,
      dto.enrollment_id,
      currentUser?.sub ?? userId,
    );
  }

  // ========================================
  // CLASS SECTION SUBMIT FOR VALIDATION
  // ========================================

  @Post(':classId/sections/:sectionId/submit')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('classes:submit_progress')
  @AuthorizationResource({ type: 'active_assignment', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Submit a class section for validation',
    description:
      'Marks a section as submitted for review. Requires at least one evidence file.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'classId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({
    name: 'enrollmentId',
    required: false,
    type: Number,
    description:
      'Enrollment anual explícito para desambiguar evidencias de clase',
  })
  @ApiResponse({ status: 200, description: 'Section submitted successfully' })
  @ApiResponse({ status: 400, description: 'No evidence files to submit' })
  @ApiResponse({ status: 404, description: 'Section progress not found' })
  async submitSection(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('classId', ParseIntPipe) classId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Query('enrollmentId', new ParseIntPipe({ optional: true }))
    enrollmentId: number | undefined,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.classesService.submitSection(
      userId,
      currentUser.sub,
      classId,
      sectionId,
      enrollmentId,
    );
    return { status: 'success', data };
  }

  // ========================================
  // CLASS SECTION FILE EVIDENCE
  // ========================================

  @Post(':classId/sections/:sectionId/files')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('classes:submit_progress')
  @AuthorizationResource({ type: 'active_assignment', ownerParam: 'userId' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload evidence file for a class section',
    description:
      'Uploads a file (PDF, JPG, PNG, WEBP) as evidence for a class section. Auto-creates section progress if it does not exist.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'classId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiQuery({
    name: 'enrollmentId',
    required: false,
    type: Number,
    description:
      'Enrollment anual explícito para desambiguar evidencias de clase',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or missing file' })
  @ApiResponse({ status: 404, description: 'Section or enrollment not found' })
  async uploadSectionFile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('classId', ParseIntPipe) classId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @UploadedFile(
      new FileValidationPipe({
        allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
      }),
    )
    file: Express.Multer.File,
    @Query('enrollmentId', new ParseIntPipe({ optional: true }))
    enrollmentId: number | undefined,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.classesService.uploadSectionFile(
      userId,
      currentUser.sub,
      classId,
      sectionId,
      file,
      enrollmentId,
    );
    return { status: 'success', data };
  }

  @Delete(':classId/sections/:sectionId/files/:fileId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('classes:submit_progress')
  @AuthorizationResource({ type: 'active_assignment', ownerParam: 'userId' })
  @ApiOperation({
    summary: 'Delete evidence file for a class section',
    description: 'Soft-deletes an evidence file and removes it from R2 storage',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'classId', type: Number })
  @ApiParam({ name: 'sectionId', type: Number })
  @ApiParam({ name: 'fileId', type: Number })
  @ApiQuery({
    name: 'enrollmentId',
    required: false,
    type: Number,
    description:
      'Enrollment anual explícito para desambiguar evidencias de clase',
  })
  @ApiResponse({ status: 200, description: 'File deleted successfully' })
  @ApiResponse({ status: 404, description: 'Evidence file not found' })
  async deleteSectionFile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('classId', ParseIntPipe) classId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Query('enrollmentId', new ParseIntPipe({ optional: true }))
    enrollmentId: number | undefined,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const data = await this.classesService.deleteSectionFile(
      userId,
      currentUser.sub,
      classId,
      sectionId,
      fileId,
      enrollmentId,
    );
    return { status: 'success', data };
  }
}
