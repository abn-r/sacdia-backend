import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthorizationResource, RequirePermissions } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CreateResourceDto } from './dto/create-resource.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { ResourceQueryDto } from './dto/resource-query.dto';
import { ResourcesService } from './resources.service';

@ApiTags('Resources')
@Controller('resources')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@ApiBearerAuth()
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  // ---------------------------------------------------------------------------
  // POST /resources — Crear recurso (con archivo adjunto opcional)
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions('resources:create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Crear recurso',
    description:
      'Crea un nuevo recurso. El campo `file` es el archivo a subir (max 50 MB). ' +
      'Para recursos de tipo `video_link` o `text` el archivo es opcional.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'resource_type', 'scope_level'],
      properties: {
        title: { type: 'string', maxLength: 255 },
        description: { type: 'string' },
        resource_type: {
          type: 'string',
          enum: ['document', 'audio', 'image', 'video_link', 'text'],
        },
        resource_category_id: { type: 'integer' },
        club_type_id: { type: 'integer' },
        scope_level: {
          type: 'string',
          enum: ['system', 'union', 'local_field'],
        },
        scope_id: { type: 'integer' },
        external_url: { type: 'string', maxLength: 1000 },
        content: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Recurso creado correctamente' })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o archivo no permitido',
  })
  @ApiResponse({
    status: 403,
    description: 'Sin permiso para el scope indicado',
  })
  async create(
    @Body() dto: CreateResourceDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: any,
  ) {
    const data = await this.resourcesService.create(
      dto,
      file,
      req.user.sub,
      req.authorization,
    );
    return { status: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // GET /resources — Listar todos los recursos (admin, paginado + filtrado)
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions('resources:read')
  @ApiOperation({
    summary: 'Listar recursos',
    description:
      'Devuelve todos los recursos activos con paginación. ' +
      'Acepta filtros por tipo, categoría, tipo de club, scope y texto libre.',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de recursos' })
  async findAll(@Query() query: ResourceQueryDto) {
    return this.resourcesService.findAll(query);
  }

  // ---------------------------------------------------------------------------
  // GET /resources/:id — Obtener recurso con URL firmada
  // ---------------------------------------------------------------------------

  @Get(':id')
  @RequirePermissions('resources:read')
  @ApiOperation({
    summary: 'Obtener recurso',
    description: 'Devuelve el recurso con su URL firmada (si tiene archivo).',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'Recurso encontrado' })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.resourcesService.findOne(id);
    return { status: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // GET /resources/:id/signed-url — Obtener URL firmada fresca
  // ---------------------------------------------------------------------------

  @Get(':id/signed-url')
  @RequirePermissions('resources:read')
  @ApiOperation({
    summary: 'Obtener URL firmada',
    description:
      'Genera una URL firmada nueva para descargar el archivo del recurso (TTL 1 hora).',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'URL firmada generada' })
  @ApiResponse({
    status: 400,
    description: 'El recurso no tiene archivo asociado',
  })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async getSignedUrl(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.resourcesService.getSignedUrl(id);
    return { status: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // PATCH /resources/:id — Actualizar metadatos del recurso
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermissions('resources:update')
  @ApiOperation({
    summary: 'Actualizar recurso',
    description:
      'Actualiza los metadatos del recurso (sin reemplazar el archivo).',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'Recurso actualizado' })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
  ) {
    const data = await this.resourcesService.update(id, dto);
    return { status: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // DELETE /resources/:id — Soft delete del recurso
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @RequirePermissions('resources:delete')
  @ApiOperation({
    summary: 'Eliminar recurso',
    description:
      'Desactiva el recurso (soft delete). El archivo en R2 no se elimina.',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'Recurso eliminado correctamente' })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.resourcesService.remove(id);
    return { status: 'success', data };
  }
}
