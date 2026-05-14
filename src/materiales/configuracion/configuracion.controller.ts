import {
  Body,
  Controller,
  Get,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { MATERIALES_CONFIGURE, MATERIALES_READ } from '../shared/permissions';
import { ConfiguracionService } from './configuracion.service';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ConfigDto } from './dto/config.dto';

@ApiTags('Materiales — Configuración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@AuthorizationResource({ type: 'active_assignment' })
@Controller('materiales/configuracion')
export class ConfiguracionController {
  constructor(private readonly configuracionService: ConfiguracionService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/materiales/configuracion
  // Permission: materiales:read (accessible by all authenticated with the perm)
  // REQ-CFG-001
  // ---------------------------------------------------------------------------

  @Get()
  @RequirePermissions(MATERIALES_READ)
  @ApiOperation({
    summary: 'Get payment configuration (bank data, delivery options)',
  })
  @ApiResponse({ status: 200, type: ConfigDto })
  get() {
    return this.configuracionService.get();
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/materiales/configuracion
  // Permission: materiales:configure (super-admin only)
  // REQ-CFG-002
  // ---------------------------------------------------------------------------

  @Patch()
  @RequirePermissions(MATERIALES_CONFIGURE)
  @ApiOperation({ summary: 'Update payment configuration (super-admin only)' })
  @ApiResponse({ status: 200, type: ConfigDto })
  @ApiResponse({ status: 400, description: 'Invalid CLABE format' })
  update(@Body() dto: UpdateConfigDto, @Request() req: any) {
    const userId: string = req.user.sub;
    return this.configuracionService.update(dto, userId);
  }
}
