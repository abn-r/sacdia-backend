import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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
import { MATERIALS_CONFIGURE, MATERIALS_READ } from '../shared/permissions';
import {
  resolveActorTerritoryScope,
  resolveLocalFieldIdsForList,
} from '../../common/authorization/actor-territory-scope';
import {
  requireLocalFieldFor,
  resolveActorLocalField,
} from '../shared/actor-local-field';
import { ConfigService } from './config.service';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ConfigDto } from './dto/config.dto';

@ApiTags('Materials — Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materials/config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/config
  // Returns the config for the caller's local_field. Unscoped admins must
  // pass ?local_field_id=N. Use GET /config/all to list every LF.
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALS_READ)
  @ApiOperation({
    summary: "Get the caller's local_field payment + delivery configuration",
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description:
      'Required when the caller is an unscoped admin/super-admin; ignored otherwise.',
  })
  @ApiResponse({ status: 200, type: ConfigDto })
  async get(
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ) {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const override =
      localFieldIdParam !== undefined
        ? parseInt(localFieldIdParam, 10)
        : undefined;
    const localFieldId = await requireLocalFieldFor(
      this.prisma,
      scope,
      override,
      'read',
    );
    return this.configService.get(localFieldId);
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/materials/config/all — recortado al territorio del actor
  // ---------------------------------------------------------------------------

  @Get('all')
  @RequirePermissions(MATERIALS_CONFIGURE)
  @ApiOperation({
    summary:
      'List materials configuration in the caller territory (all local fields for unscoped admins)',
  })
  @ApiResponse({ status: 200, type: ConfigDto, isArray: true })
  async listAll(@Request() req: any) {
    const ids = await resolveLocalFieldIdsForList(
      this.prisma,
      resolveActorTerritoryScope(req.authorization),
    );
    return this.configService.listForScope(ids);
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/materials/config
  // Upserts the caller's (or override's) local_field configuration.
  // ---------------------------------------------------------------------------

  @Patch()
  @RequirePermissions(MATERIALS_CONFIGURE)
  @ApiOperation({
    summary:
      'Upsert the materials configuration for a local_field (matches caller scope)',
  })
  @ApiQuery({
    name: 'local_field_id',
    required: false,
    type: Number,
    description:
      'Required when the caller is an unscoped admin/super-admin; ignored otherwise.',
  })
  @ApiResponse({ status: 200, type: ConfigDto })
  @ApiResponse({ status: 400, description: 'Invalid CLABE format' })
  async update(
    @Body() dto: UpdateConfigDto,
    @Request() req: any,
    @Query('local_field_id') localFieldIdParam?: string,
  ) {
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const override =
      localFieldIdParam !== undefined
        ? parseInt(localFieldIdParam, 10)
        : undefined;
    const localFieldId = await requireLocalFieldFor(
      this.prisma,
      scope,
      override,
      'write',
    );
    const userId: string = req.user.sub;
    return this.configService.upsert(localFieldId, dto, userId);
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/materials/config/:local_field_id — admin-only direct
  // ---------------------------------------------------------------------------

  @Patch(':localFieldId')
  @RequirePermissions(MATERIALS_CONFIGURE)
  @ApiOperation({
    summary: 'Upsert config for a specific local_field (admin direct)',
  })
  @ApiResponse({ status: 200, type: ConfigDto })
  async updateById(
    @Param('localFieldId', ParseIntPipe) localFieldId: number,
    @Body() dto: UpdateConfigDto,
    @Request() req: any,
  ) {
    // Scope still enforced: a single-scope caller can only target their own LF.
    const scope = await resolveActorLocalField(this.prisma, req.authorization);
    const resolvedLfId = await requireLocalFieldFor(
      this.prisma,
      scope,
      localFieldId,
      'write',
    );
    const userId: string = req.user.sub;
    return this.configService.upsert(resolvedLfId, dto, userId);
  }
}
