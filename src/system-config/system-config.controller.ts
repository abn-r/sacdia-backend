import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import { GlobalRoles } from '../common/decorators';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

@ApiTags('system-config')
@Controller('system-config')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@ApiBearerAuth()
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  // ========================================
  // LIST ALL CONFIG VALUES
  // ========================================

  @Get()
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Listar todas las configuraciones del sistema',
    description:
      'Obtiene todas las claves de configuracion del sistema. Solo admin/super_admin.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de configuraciones del sistema',
  })
  async findAll() {
    return this.systemConfigService.findAll();
  }

  // ========================================
  // GET SINGLE CONFIG VALUE
  // ========================================

  @Get(':key')
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Obtener una configuracion por clave',
    description:
      'Obtiene el valor de una configuracion especifica del sistema.',
  })
  @ApiParam({
    name: 'key',
    type: String,
    description:
      'Clave de configuracion (e.g. investiture.min_approval_percentage)',
  })
  @ApiResponse({ status: 200, description: 'Configuracion encontrada' })
  @ApiResponse({ status: 404, description: 'Configuracion no encontrada' })
  async findByKey(@Param('key') key: string) {
    return this.systemConfigService.findByKey(key);
  }

  // ========================================
  // UPDATE CONFIG VALUE
  // ========================================

  @Patch(':key')
  @GlobalRoles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Actualizar una configuracion del sistema',
    description:
      'Actualiza el valor de una configuracion existente. Solo admin/super_admin.',
  })
  @ApiParam({
    name: 'key',
    type: String,
    description: 'Clave de configuracion (max 100 caracteres)',
  })
  @ApiResponse({ status: 200, description: 'Configuracion actualizada' })
  @ApiResponse({ status: 400, description: 'Clave o valor invalido' })
  @ApiResponse({ status: 404, description: 'Configuracion no encontrada' })
  async updateByKey(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
  ) {
    if (!key || key.length > 100) {
      throw new AppBadRequestException(ErrorCode.SYSTEM_CONFIG_VALUE_REQUIRED);
    }
    return this.systemConfigService.updateByKey(key, dto.config_value);
  }
}
