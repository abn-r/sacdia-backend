import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { CatalogsService } from './catalogs.service';
import { PrismaService } from '../prisma/prisma.service';
import { OptionalJwtAuthGuard } from '../common/guards';
import { CurrentUser, Public } from '../common/decorators';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  assertCatalogFiltersInCountry,
  resolveActorCatalogCountryId,
} from '../common/authorization/actor-territory-scope';

@ApiTags('catalogs')
@Controller('catalogs')
// @Public exime del guard JWT global; OptionalJwtAuthGuard puebla req.user
// cuando llega token.
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class CatalogsController {
  constructor(
    private readonly catalogsService: CatalogsService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
  ) {}

  private async actorCatalogCountryId(
    user?: { sub?: string },
  ): Promise<number | undefined> {
    const userId = user?.sub;
    if (!userId || !isUUID(userId, 'all')) {
      return undefined;
    }

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    return resolveActorCatalogCountryId(this.prisma, resolved);
  }

  // ========================================
  // CLUB TYPES
  // ========================================
  @Get('club-types')
  @ApiOperation({
    summary: 'Obtener tipos de club',
    description:
      'Lista los tipos de club disponibles (Aventureros, Conquistadores, Guías Mayores)',
  })
  @ApiResponse({ status: 200, description: 'Lista de tipos de club' })
  async getClubTypes() {
    return this.catalogsService.getClubTypes();
  }

  @Get('activity-types')
  @ApiOperation({
    summary: 'Obtener tipos de actividad',
    description:
      'Lista los tipos de actividad disponibles para registrar actividades',
  })
  @ApiResponse({ status: 200, description: 'Lista de tipos de actividad' })
  async getActivityTypes() {
    return this.catalogsService.getActivityTypes();
  }

  @Get('relationship-types')
  @ApiOperation({
    summary: 'Obtener tipos de relación',
    description:
      'Lista tipos de relación activos para formularios (padre, madre, tutor, etc.)',
  })
  @ApiResponse({ status: 200, description: 'Lista de tipos de relación' })
  async getRelationshipTypes() {
    return this.catalogsService.getRelationshipTypes();
  }

  // ========================================
  // COUNTRIES
  // ========================================
  @Get('countries')
  @ApiOperation({
    summary: 'Obtener países',
    description:
      'Lista países activos. Sin JWT o sin rol territorial: directorio completo. Con rol territorial: solo el país del actor.',
  })
  @ApiResponse({ status: 200, description: 'Lista de países' })
  @ApiResponse({ status: 403, description: 'Rol territorial sin país resoluble' })
  async getCountries(@CurrentUser() user?: { sub: string }) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    return this.catalogsService.getCountries(actorCountryId);
  }

  // ========================================
  // DIVISIONS
  // ========================================
  @Get('divisions')
  @ApiOperation({
    summary: 'Obtener divisiones',
    description:
      'Lista divisiones institucionales activas. Con rol territorial: solo divisiones que tienen uniones en el país del actor.',
  })
  @ApiResponse({ status: 200, description: 'Lista de divisiones' })
  @ApiResponse({ status: 403, description: 'Rol territorial sin país resoluble' })
  async getDivisions(@CurrentUser() user?: { sub: string }) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    return this.catalogsService.getDivisions(actorCountryId);
  }

  // ========================================
  // UNIONS
  // ========================================
  @Get('unions')
  @ApiOperation({
    summary: 'Obtener uniones',
    description:
      'Lista uniones de la organización, opcionalmente filtradas por división. countryId queda como compatibilidad legacy solo si es un alias no ambiguo. Con rol territorial: uniones del país del actor; un countryId/divisionId fuera de ese país responde 403.',
  })
  @ApiQuery({
    name: 'divisionId',
    required: false,
    type: Number,
    description: 'ID de la división institucional para filtrar',
  })
  @ApiQuery({
    name: 'countryId',
    required: false,
    type: Number,
    description: 'ID del país para compatibilidad legacy',
  })
  @ApiResponse({ status: 200, description: 'Lista de uniones' })
  @ApiResponse({
    status: 403,
    description: 'Filtro geográfico fuera del país del actor territorial',
  })
  async getUnions(
    @Query('countryId', new ParseIntPipe({ optional: true }))
    countryId?: number,
    @Query('divisionId', new ParseIntPipe({ optional: true }))
    divisionId?: number,
    @CurrentUser() user?: { sub: string },
  ) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    if (actorCountryId !== undefined) {
      await assertCatalogFiltersInCountry(this.prisma, actorCountryId, {
        countryId,
        divisionId,
      });
    }
    return this.catalogsService.getUnions({
      countryId,
      divisionId,
      actorCountryId,
    });
  }

  // ========================================
  // LOCAL FIELDS
  // ========================================
  @Get('local-fields')
  @ApiOperation({
    summary: 'Obtener campos locales',
    description:
      'Lista campos locales, opcionalmente filtrados por unión. Con rol territorial: campos del país del actor; un unionId de otro país responde 403.',
  })
  @ApiQuery({
    name: 'unionId',
    required: false,
    type: Number,
    description: 'ID de la unión para filtrar',
  })
  @ApiResponse({ status: 200, description: 'Lista de campos locales' })
  @ApiResponse({
    status: 403,
    description: 'Filtro geográfico fuera del país del actor territorial',
  })
  async getLocalFields(
    @Query('unionId', new ParseIntPipe({ optional: true }))
    unionId?: number,
    @CurrentUser() user?: { sub: string },
  ) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    if (actorCountryId !== undefined) {
      await assertCatalogFiltersInCountry(this.prisma, actorCountryId, {
        unionId,
      });
    }
    return this.catalogsService.getLocalFields(unionId, actorCountryId);
  }

  // ========================================
  // DISTRICTS
  // ========================================
  @Get('districts')
  @ApiOperation({
    summary: 'Obtener distritos',
    description:
      'Lista distritos, opcionalmente filtrados por campo local. Con rol territorial: distritos del país del actor; un localFieldId de otro país responde 403.',
  })
  @ApiQuery({
    name: 'localFieldId',
    required: false,
    type: Number,
    description: 'ID del campo local para filtrar',
  })
  @ApiResponse({ status: 200, description: 'Lista de distritos' })
  @ApiResponse({
    status: 403,
    description: 'Filtro geográfico fuera del país del actor territorial',
  })
  async getDistricts(
    @Query('localFieldId', new ParseIntPipe({ optional: true }))
    localFieldId?: number,
    @CurrentUser() user?: { sub: string },
  ) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    if (actorCountryId !== undefined) {
      await assertCatalogFiltersInCountry(this.prisma, actorCountryId, {
        localFieldId,
      });
    }
    return this.catalogsService.getDistricts(localFieldId, actorCountryId);
  }

  // ========================================
  // CHURCHES
  // ========================================
  @Get('churches')
  @ApiOperation({
    summary: 'Obtener iglesias',
    description:
      'Lista iglesias, opcionalmente filtradas por distrito. Con rol territorial: iglesias del país del actor; un districtId de otro país responde 403.',
  })
  @ApiQuery({
    name: 'districtId',
    required: false,
    type: Number,
    description: 'ID del distrito para filtrar',
  })
  @ApiResponse({ status: 200, description: 'Lista de iglesias' })
  @ApiResponse({
    status: 403,
    description: 'Filtro geográfico fuera del país del actor territorial',
  })
  async getChurches(
    @Query('districtId', new ParseIntPipe({ optional: true }))
    districtId?: number,
    @CurrentUser() user?: { sub: string },
  ) {
    const actorCountryId = await this.actorCatalogCountryId(user);
    if (actorCountryId !== undefined) {
      await assertCatalogFiltersInCountry(this.prisma, actorCountryId, {
        districtId,
      });
    }
    return this.catalogsService.getChurches(districtId, actorCountryId);
  }

  // ========================================
  // ROLES
  // ========================================
  @Get('roles')
  @ApiOperation({
    summary: 'Obtener roles disponibles',
    description:
      'Lista roles del sistema, opcionalmente filtrados por categoría (GLOBAL o CLUB)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    enum: ['GLOBAL', 'CLUB'],
    description: 'Categoría de rol para filtrar',
  })
  @ApiResponse({ status: 200, description: 'Lista de roles' })
  async getRoles(@Query('category') category?: string) {
    return this.catalogsService.getRoles(category);
  }

  // ========================================
  // ECCLESIASTICAL YEARS
  // ========================================
  @Get('ecclesiastical-years')
  @ApiOperation({
    summary: 'Obtener años eclesiásticos',
    description: 'Lista todos los años eclesiásticos registrados',
  })
  @ApiResponse({ status: 200, description: 'Lista de años eclesiásticos' })
  async getEcclesiasticalYears() {
    return this.catalogsService.getEcclesiasticalYears();
  }

  @Get('ecclesiastical-years/current')
  @ApiOperation({
    summary: 'Obtener año eclesiástico actual',
    description:
      'Retorna el año eclesiástico vigente basado en la fecha actual',
  })
  @ApiResponse({ status: 200, description: 'Año eclesiástico actual' })
  async getCurrentEcclesiasticalYear() {
    return this.catalogsService.getCurrentEcclesiasticalYear();
  }

  // ========================================
  // CLUB IDEALS
  // ========================================
  @Get('club-ideals')
  @ApiOperation({
    summary: 'Obtener ideales de club',
    description: 'Lista los ideales (ley, voto, lema, etc.) por tipo de club',
  })
  @ApiQuery({
    name: 'clubTypeId',
    required: false,
    type: Number,
    description: 'ID del tipo de club para filtrar',
  })
  @ApiResponse({ status: 200, description: 'Lista de ideales' })
  async getClubIdeals(
    @Query('clubTypeId', new ParseIntPipe({ optional: true }))
    clubTypeId?: number,
  ) {
    return this.catalogsService.getClubIdeals(clubTypeId);
  }

  // ========================================
  // ALLERGIES
  // ========================================
  @Get('allergies')
  @ApiOperation({
    summary: 'Obtener catálogo de alergias',
    description: 'Lista alergias activas para selección en formularios',
  })
  @ApiResponse({ status: 200, description: 'Lista de alergias' })
  async getAllergies() {
    return this.catalogsService.getAllergies();
  }

  // ========================================
  // DISEASES
  // ========================================
  @Get('diseases')
  @ApiOperation({
    summary: 'Obtener catálogo de enfermedades',
    description: 'Lista enfermedades activas para selección en formularios',
  })
  @ApiResponse({ status: 200, description: 'Lista de enfermedades' })
  async getDiseases() {
    return this.catalogsService.getDiseases();
  }

  // ========================================
  // MEDICINES
  // ========================================
  @Get('medicines')
  @ApiOperation({
    summary: 'Obtener catálogo de medicamentos',
    description: 'Lista medicamentos activos para selección en formularios',
  })
  @ApiResponse({ status: 200, description: 'Lista de medicamentos' })
  async getMedicines() {
    return this.catalogsService.getMedicines();
  }
}
