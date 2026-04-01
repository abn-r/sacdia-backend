import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FilesValidationPipe,
  ALLOWED_MIME_TYPES,
} from '../common/pipes/file-validation.pipe';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { HonorsService } from './honors.service';
import {
  StartHonorDto,
  UpdateUserHonorDto,
  CreateUserHonorDto,
  BulkCreateUserHonorsDto,
} from './dto';
import {
  JwtAuthGuard,
  OptionalJwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { PaginationDto } from '../common/dto/pagination.dto';

// ========================================
// CATÁLOGO DE HONORES (Público)
// ========================================

@ApiTags('honors')
@Controller('honors')
@UseGuards(OptionalJwtAuthGuard)
export class HonorsController {
  constructor(private readonly honorsService: HonorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar honores',
    description: 'Lista todos los honores activos con paginación y filtros',
  })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'clubTypeId', required: false, type: Number })
  @ApiQuery({
    name: 'skillLevel',
    required: false,
    type: Number,
    description: '1=Básico, 2=Avanzado, 3=Máster',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista paginada de honores' })
  async findAll(
    @Query('categoryId', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('skillLevel', new ParseIntPipe({ optional: true }))
    skillLevel?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const pagination = new PaginationDto();
    if (page) pagination.page = page;
    if (limit) pagination.limit = Math.min(limit, 100);

    return this.honorsService.findAll(
      { categoryId, clubTypeId, skillLevel },
      pagination,
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorías de honores' })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  async getCategories() {
    return this.honorsService.getCategories();
  }

  @Get('grouped-by-category')
  @ApiOperation({ summary: 'Listar honores agrupados por categoría' })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'clubTypeId', required: false, type: Number })
  @ApiQuery({
    name: 'skillLevel',
    required: false,
    type: Number,
    description: '1=Básico, 2=Avanzado, 3=Máster',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorías con sus honores asociados',
  })
  async getGroupedByCategory(
    @Query('categoryId', new ParseIntPipe({ optional: true }))
    categoryId?: number,
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
    @Query('skillLevel', new ParseIntPipe({ optional: true }))
    skillLevel?: number,
  ) {
    return this.honorsService.getGroupedByCategory({
      categoryId,
      clubTypeId,
      skillLevel,
    });
  }

  @Get(':honorId')
  @ApiOperation({ summary: 'Obtener honor por ID' })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({ status: 200, description: 'Honor encontrado' })
  @ApiResponse({ status: 404, description: 'Honor no encontrado' })
  async findOne(@Param('honorId', ParseIntPipe) honorId: number) {
    return this.honorsService.findOne(honorId);
  }
}

// ========================================
// HONORES DE USUARIO (Autenticado)
// ========================================

@ApiTags('user-honors')
@Controller('users/:userId/honors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserHonorsController {
  constructor(private readonly honorsService: HonorsService) {}

  @Get()
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({
    summary: 'Obtener honores del usuario',
    description:
      'Lista los honores en los que el usuario está inscrito o ha completado',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiQuery({ name: 'validated', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Honores del usuario' })
  async getUserHonors(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('validated') validated?: string,
  ) {
    const validatedBool =
      validated === 'true' ? true : validated === 'false' ? false : undefined;
    return this.honorsService.getUserHonors(userId, validatedBool);
  }

  @Get('stats')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:read')
  @ApiOperation({ summary: 'Obtener estadísticas de honores del usuario' })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Estadísticas de honores' })
  async getStats(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.honorsService.getUserHonorStats(userId);
  }

  @Post()
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @ApiOperation({
    summary: 'Registrar honor con datos iniciales',
    description:
      'Registra (o reactiva) un honor del usuario permitiendo enviar evidencias en el alta',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 201, description: 'Honor registrado para el usuario' })
  async createUserHonor(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateUserHonorDto,
  ) {
    return this.honorsService.createUserHonor(userId, dto);
  }

  @Post('bulk')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @ApiOperation({
    summary: 'Registrar honores de usuario de forma masiva',
    description:
      'Registra o reactiva múltiples honores en una sola petición para acelerar carga inicial',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({
    status: 201,
    description: 'Honores registrados de forma masiva',
  })
  async createUserHonorsBulk(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: BulkCreateUserHonorsDto,
  ) {
    return this.honorsService.createUserHonorsBulk(userId, dto);
  }

  @Post(':honorId/files')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'certificate', maxCount: 1 },
      { name: 'document', maxCount: 1 },
      { name: 'images', maxCount: 10 },
    ]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir evidencias del honor',
    description:
      'Sube certificado, documento e imágenes a R2 (users_honors/users_honors_cert) y actualiza users_honors',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        certificate: { type: 'string', format: 'binary' },
        document: { type: 'string', format: 'binary' },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Evidencias subidas y asociadas al honor del usuario',
  })
  async uploadHonorFiles(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @UploadedFiles(
      new FilesValidationPipe({
        certificate: {
          allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS,
        },
        document: { allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS },
        images: { allowedMimeTypes: ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS },
      }),
    )
    files: {
      certificate?: Express.Multer.File[];
      document?: Express.Multer.File[];
      images?: Express.Multer.File[];
    },
  ) {
    return this.honorsService.uploadUserHonorFiles(userId, honorId, files);
  }

  @Post(':honorId')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:create')
  @ApiOperation({
    summary: 'Iniciar un honor',
    description: 'Inscribe al usuario en un honor para comenzar a trabajarlo',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({ status: 201, description: 'Honor iniciado' })
  @ApiResponse({ status: 409, description: 'Usuario ya tiene este honor' })
  async startHonor(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: StartHonorDto,
  ) {
    return this.honorsService.startHonor(userId, honorId, dto);
  }

  @Patch(':honorId')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:update')
  @ApiOperation({
    summary: 'Actualizar progreso de honor',
    description: 'Actualiza evidencias, validación o certificado del honor',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({ status: 200, description: 'Honor actualizado' })
  async updateHonor(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: UpdateUserHonorDto,
  ) {
    return this.honorsService.updateUserHonor(userId, honorId, dto);
  }

  @Delete(':honorId')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @RequirePermissions('user_honors:delete')
  @ApiOperation({
    summary: 'Abandonar honor',
    description: 'Desactiva el honor del usuario (no lo elimina)',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiParam({ name: 'honorId', type: Number })
  @ApiResponse({ status: 200, description: 'Honor abandonado' })
  async abandonHonor(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('honorId', ParseIntPipe) honorId: number,
  ) {
    return this.honorsService.abandonHonor(userId, honorId);
  }
}
