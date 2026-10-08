import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { throwLegacyInvestiturePipelineRetired } from './legacy-investiture-pipeline-retired';

const GONE = {
  status: 410,
  description:
    'INVESTITURE_LEGACY_PIPELINE_RETIRED — vía anterior apagada (fase 8)',
};

/**
 * Sin @Body ni pipes de parámetros: ningún 400 tapa el 410. Solo el JWT global;
 * sin permisos ni roles, para que ningún actor reciba un 403 engañoso.
 */
@ApiTags('investiture')
@ApiBearerAuth()
@SkipPermissions()
@Controller()
export class LegacyInvestitureRetiredController {
  @Post('investiture/enrollments/:enrollmentId/submit')
  @ApiOperation({ summary: '[RETIRADA] Enviar a la validación anterior' })
  @ApiResponse(GONE)
  submit(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/:enrollmentId/club-approve')
  @ApiOperation({ summary: '[RETIRADA] Aprobación del club' })
  @ApiResponse(GONE)
  clubApprove(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/:enrollmentId/coordinator-approve')
  @ApiOperation({ summary: '[RETIRADA] Aprobación de coordinación' })
  @ApiResponse(GONE)
  coordinatorApprove(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/:enrollmentId/field-approve')
  @ApiOperation({ summary: '[RETIRADA] Aprobación del Campo' })
  @ApiResponse(GONE)
  fieldApprove(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/:enrollmentId/invest')
  @ApiOperation({ summary: '[RETIRADA] Investir por la vía anterior' })
  @ApiResponse(GONE)
  invest(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/:enrollmentId/reject')
  @ApiOperation({ summary: '[RETIRADA] Rechazar en la vía anterior' })
  @ApiResponse(GONE)
  reject(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/bulk-approve')
  @ApiOperation({ summary: '[RETIRADA] Aprobación en bloque' })
  @ApiResponse(GONE)
  bulkApprove(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('investiture/enrollments/bulk-reject')
  @ApiOperation({ summary: '[RETIRADA] Rechazo en bloque' })
  @ApiResponse(GONE)
  bulkReject(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Get('investiture/pending')
  @ApiOperation({ summary: '[RETIRADA] Pendientes de la vía anterior' })
  @ApiResponse(GONE)
  pending(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('enrollments/:enrollmentId/submit-for-validation')
  @ApiOperation({ summary: '[RETIRADA] Alias de envío a validación' })
  @ApiResponse(GONE)
  submitForValidationAlias(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('enrollments/:enrollmentId/validate')
  @ApiOperation({ summary: '[RETIRADA] Alias de validación' })
  @ApiResponse(GONE)
  validateAlias(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('enrollments/:enrollmentId/investiture')
  @ApiOperation({ summary: '[RETIRADA] Alias de investir' })
  @ApiResponse(GONE)
  investitureAlias(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Get('admin/investiture/config')
  @ApiOperation({
    summary: '[RETIRADA] Configuraciones de la investidura anterior',
  })
  @ApiResponse(GONE)
  listConfigs(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Get('admin/investiture/config/:configId')
  @ApiOperation({
    summary: '[RETIRADA] Configuración de la investidura anterior',
  })
  @ApiResponse(GONE)
  getConfig(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Post('admin/investiture/config')
  @ApiOperation({ summary: '[RETIRADA] Crear configuración anterior' })
  @ApiResponse(GONE)
  createConfig(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Patch('admin/investiture/config/:configId')
  @ApiOperation({ summary: '[RETIRADA] Editar configuración anterior' })
  @ApiResponse(GONE)
  updateConfig(): never {
    return throwLegacyInvestiturePipelineRetired();
  }

  @Delete('admin/investiture/config/:configId')
  @ApiOperation({ summary: '[RETIRADA] Desactivar configuración anterior' })
  @ApiResponse(GONE)
  deleteConfig(): never {
    return throwLegacyInvestiturePipelineRetired();
  }
}
