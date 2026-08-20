import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { ResourceQueryDto } from './dto/resource-query.dto';
import { ResourcesService } from './resources.service';

/**
 * Controlador orientado a la app móvil.
 *
 * IMPORTANTE: debe registrarse ANTES de ResourcesController en el módulo para que
 * las rutas `/resources/me` y `/resources/me/:id` no sean capturadas por el
 * param `:id` del controlador admin.
 */
@ApiTags('Resources (App)')
@Controller('resources')
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@ApiBearerAuth()
export class ResourcesAppController {
  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /resources/me — Recursos visibles para el usuario autenticado
  // ---------------------------------------------------------------------------

  @Get('me')
  @ApiOperation({
    summary: 'Mis recursos',
    description:
      'Devuelve los recursos visibles para el usuario según su scope ' +
      '(sistema, división, unión o campo local) y tipo de club. ' +
      'No requiere permiso RBAC explícito — solo autenticación.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de recursos visibles',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async getMyResources(@Query() query: ResourceQueryDto, @Request() req: any) {
    const resolved = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    return this.resourcesService.getVisibleResources(
      query,
      resolved.authorization,
    );
  }

  // ---------------------------------------------------------------------------
  // GET /resources/me/:id — Recurso individual visible para el usuario
  // ---------------------------------------------------------------------------

  @Get('me/:id')
  @ApiOperation({
    summary: 'Obtener recurso visible',
    description:
      'Devuelve un recurso específico si es visible para el usuario autenticado, ' +
      'incluyendo su URL firmada cuando tiene archivo adjunto.',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'Recurso encontrado' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async getMyResource(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const resolved = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    return this.resourcesService.findOneVisible(id, resolved.authorization);
  }

  // ---------------------------------------------------------------------------
  // GET /resources/me/:id/signed-url — URL firmada para el usuario
  // ---------------------------------------------------------------------------

  @Get('me/:id/signed-url')
  @ApiOperation({
    summary: 'Obtener URL firmada (app)',
    description:
      'Genera una URL firmada fresca para descargar el archivo del recurso (TTL 1 hora).',
  })
  @ApiParam({ name: 'id', type: String, description: 'UUID del recurso' })
  @ApiResponse({ status: 200, description: 'URL firmada generada' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 400,
    description: 'El recurso no tiene archivo asociado',
  })
  @ApiResponse({ status: 404, description: 'Recurso no encontrado' })
  async getMyResourceSignedUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const resolved = await this.authorizationContext.resolveUserAuthorization(
      req.user.sub,
    );
    return this.resourcesService.getVisibleSignedUrl(
      id,
      resolved.authorization,
    );
  }
}
