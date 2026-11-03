import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ParseUuidParamPipe } from '../common/pipes/parse-uuid-param.pipe';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { LegalRepresentativesService } from './legal-representatives.service';
import { SensitiveUserSubresource } from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('legal-representatives')
@Controller('users/:userId/legal-representative')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LegalRepresentativesController {
  constructor(
    private readonly legalRepresentativesService: LegalRepresentativesService,
  ) {}

  @Get()
  @SensitiveUserSubresource('legal_representative', 'read')
  @ApiOperation({ summary: 'Obtener representante legal del usuario' })
  @ApiResponse({
    status: 200,
    description:
      'Respuesta exitosa. Retorna representante o data=null cuando no existe',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({
    status: 403,
    description:
      'Access denied: caller is not the user or does not have admin role',
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async findOne(@Param('userId', ParseUuidParamPipe) userId: string) {
    return this.legalRepresentativesService.findOne(userId);
  }
}
