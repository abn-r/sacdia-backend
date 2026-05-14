import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { MATERIALES_READ } from '../shared/permissions';
import { CatalogoService } from './catalogo.service';
import { ListCatalogoQueryDto } from './dto/list-catalogo.query.dto';
import {
  MaterialProductDto,
  PaginatedMaterialProductDto,
} from './dto/material-product.dto';

@ApiTags('Materiales — Catálogo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materiales/catalogo')
export class CatalogoController {
  constructor(private readonly cataloService: CatalogoService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/catalogo/categorias
  // MUST be declared BEFORE /:id to avoid NestJS route-order capture (R-1)
  // ---------------------------------------------------------------------------

  @Get('categorias')
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'List all categories with active product count' })
  @ApiResponse({ status: 200 })
  listCategorias() {
    return this.cataloService.listCategorias();
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/catalogo/programas
  // MUST be declared BEFORE /:id to avoid NestJS route-order capture (R-1)
  // ---------------------------------------------------------------------------

  @Get('programas')
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'List all programas (club types)' })
  @ApiResponse({ status: 200 })
  listProgramas() {
    return this.cataloService.listProgramas();
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/catalogo
  // REQ-CAT-001, REQ-CAT-005
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'List products (paginated, filtered)' })
  @ApiResponse({ status: 200, type: PaginatedMaterialProductDto })
  list(@Query() query: ListCatalogoQueryDto) {
    // Catalog endpoint always excludes inactive products (REQ-CAT-005).
    // Inventory managers see inactive products via /inventario (PR5).
    return this.cataloService.list(query, false);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/catalogo/:id
  // MUST be LAST among GET routes to avoid capturing static segments
  // ---------------------------------------------------------------------------

  @Get(':id')
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({ summary: 'Get product detail by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: MaterialProductDto })
  @ApiResponse({ status: 404 })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    // Catalog endpoint returns 404 for inactive products (REQ-CAT-005).
    return this.cataloService.getById(id, false);
  }
}
