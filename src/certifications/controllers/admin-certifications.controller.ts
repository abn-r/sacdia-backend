import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Patch,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CertificationDefinitionsService } from '../definitions/certification-definitions.service';
import {
  AuthorizationResource,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { CreateCertificationDto } from '../dto/admin/create-certification.dto';
import { UpsertCertificationVersionDto } from '../dto/admin/upsert-certification-version.dto';
import { UpsertCertificationTreeDto } from '../dto/admin/upsert-certification-tree.dto';
import { UpsertEligibilityRulesDto } from '../dto/admin/upsert-eligibility-rules.dto';

type CurrentUserPayload = {
  sub: string;
};

@ApiTags('Admin - Certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'global' })
@Controller('admin/certifications')
export class AdminCertificationsController {
  constructor(private readonly service: CertificationDefinitionsService) {}

  @Post()
  @RequirePermissions('certifications:configure')
  @ApiOperation({
    summary: 'Crear una nueva certificación con versión inicial en DRAFT',
  })
  @ApiResponse({ status: 201, description: 'Certificación creada' })
  async createCertification(@Body() dto: CreateCertificationDto) {
    return this.service.createCertification(dto.name, dto.description);
  }

  @Post(':certificationId/versions')
  @RequirePermissions('certifications:configure')
  @ApiOperation({
    summary: 'Crear una nueva versión DRAFT de la certificación',
  })
  @ApiParam({ name: 'certificationId', type: Number })
  async createDraftVersion(
    @Param('certificationId', ParseIntPipe) certificationId: number,
  ) {
    return this.service.createDraftVersion(certificationId);
  }

  @Post(':certificationId/versions/:versionId/clone')
  @RequirePermissions('certifications:configure')
  @ApiOperation({
    summary: 'Clonar una versión PUBLISHED/RETIRED en una nueva versión DRAFT',
  })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async cloneVersion(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.service.cloneVersion(certificationId, versionId);
  }

  @Patch(':certificationId/versions/:versionId')
  @RequirePermissions('certifications:configure')
  @ApiOperation({ summary: 'Actualizar metadatos de una versión DRAFT' })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async updateVersionMetadata(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: UpsertCertificationVersionDto,
  ) {
    return this.service.updateVersionMetadata(certificationId, versionId, dto);
  }

  @Patch(':certificationId/versions/:versionId/eligibility-rules')
  @RequirePermissions('certifications:configure')
  @ApiOperation({
    summary: 'Reemplazar las reglas de elegibilidad de una versión DRAFT',
  })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async replaceEligibilityRules(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: UpsertEligibilityRulesDto,
  ) {
    return this.service.replaceEligibilityRules(
      certificationId,
      versionId,
      dto.rules,
    );
  }

  @Patch(':certificationId/versions/:versionId/tree')
  @RequirePermissions('certifications:configure')
  @ApiOperation({
    summary:
      'Reemplazar el árbol de módulos/secciones/componentes de una versión DRAFT',
  })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async replaceTree(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: UpsertCertificationTreeDto,
  ) {
    return this.service.replaceModulesTree(
      certificationId,
      versionId,
      dto.modules,
    );
  }

  @Post(':certificationId/versions/:versionId/publish')
  @RequirePermissions('certifications:publish')
  @ApiOperation({
    summary:
      'Publicar una versión DRAFT (retira la versión PUBLISHED anterior, si existe)',
  })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async publishVersion(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.publishVersion(certificationId, versionId, user.sub);
  }

  @Delete(':certificationId/versions/:versionId/publish')
  @RequirePermissions('certifications:publish')
  @ApiOperation({ summary: 'Retirar una versión PUBLISHED' })
  @ApiParam({ name: 'certificationId', type: Number })
  @ApiParam({ name: 'versionId', type: Number })
  async retireVersion(
    @Param('certificationId', ParseIntPipe) certificationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.service.retireVersion(certificationId, versionId);
  }
}
