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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { PrismaService } from '../../prisma/prisma.service';
import { MATERIALS_READ } from '../shared/permissions';
import { resolveMaterialsListLocalFieldId } from '../shared/actor-local-field';
import { CatalogService } from './catalog.service';
import { ListCatalogQueryDto } from './dto/list-catalog.query.dto';
import {
  MaterialProductDto,
  PaginatedMaterialProductDto,
} from './dto/material-product.dto';

@ApiTags('Materials — Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  // Resolves the local_field for catalog reads:
  //   - LF-scoped callers (director / director-lf / assistant-lf): forced
  //     to their own LF. Any ?local_field_id= override is ignored.
  //   - Unscoped admin/super-admin: ?local_field_id= filters; without it
  //     they see the merged catalog across every LF.
  private async resolveLfForRead(
    req: any,
    localFieldIdParam: string | undefined,
  ): Promise<number | number[] | undefined> {
    const parsed =
      localFieldIdParam !== undefined ? parseInt(localFieldIdParam, 10) : NaN;
    return resolveMaterialsListLocalFieldId(
      this.prisma,
      req.authorization,
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/catalog/categories
  // MUST be declared BEFORE /:id to avoid NestJS route-order capture (R-1)
  // ---------------------------------------------------------------------------

  @Get('categories')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({ summary: 'List all categories with active product count' })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiResponse({ status: 200 })
  async listCategories(
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ) {
    const localFieldId = await this.resolveLfForRead(req, localFieldIdParam);
    return this.catalogService.listCategories(localFieldId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/catalog/programs
  // MUST be declared BEFORE /:id to avoid NestJS route-order capture (R-1)
  // Programs (club_types) is a global taxonomy — no LF scope.
  // ---------------------------------------------------------------------------

  @Get('programs')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({ summary: 'List all programs (club types)' })
  @ApiResponse({ status: 200 })
  listPrograms() {
    return this.catalogService.listPrograms();
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/catalog
  // REQ-CAT-001, REQ-CAT-005
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({
    summary: 'List products (paginated, filtered, scoped to LF)',
  })
  @ApiQuery({ name: 'local_field_id', required: false, type: Number })
  @ApiResponse({ status: 200, type: PaginatedMaterialProductDto })
  async list(
    @Query() query: ListCatalogQueryDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ) {
    const localFieldId = await this.resolveLfForRead(req, localFieldIdParam);
    // Catalog endpoint always excludes inactive products (REQ-CAT-005).
    // Inventory managers see inactive products via /inventory (PR5).
    return this.catalogService.list(query, false, localFieldId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/catalog/:id
  // MUST be LAST among GET routes to avoid capturing static segments
  // ---------------------------------------------------------------------------

  @Get(':id')
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({ summary: 'Get product detail by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: MaterialProductDto })
  @ApiResponse({ status: 404 })
  async getById(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const localFieldId = await resolveMaterialsListLocalFieldId(
      this.prisma,
      req.authorization,
    );
    // Catalog endpoint returns 404 for inactive products (REQ-CAT-005)
    // and for products that belong to a different LF when caller is scoped.
    return this.catalogService.getById(id, false, localFieldId);
  }
}
