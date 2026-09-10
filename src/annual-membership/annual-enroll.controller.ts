import {
  Controller,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AnnualMembershipService } from './annual-membership.service';
import { AnnualEnrollBodyDto } from './dto/annual-continuation.dto';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';

@ApiTags('annual-membership')
@Controller('users/:userId/membership')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AnnualEnrollController {
  constructor(
    private readonly annualMembershipService: AnnualMembershipService,
  ) {}

  @Post('annual-enroll')
  @RequirePermissions('registration:complete')
  @AuthorizationResource({ type: 'user', ownerParam: 'userId' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autoinscripción anual (bloqueada — D01 pendiente)',
    description:
      'D01 no está resuelto: el titular del perfil no puede autoactivar la membresía anual. ' +
      'La inscripción la realiza la directiva. Siempre 403 ANNUAL_ENROLL_REQUIRES_DIRECTIVE, sin efectos.',
  })
  @ApiParam({ name: 'userId', type: String, description: 'UUID del usuario' })
  @ApiResponse({
    status: 403,
    description: '403 ANNUAL_ENROLL_REQUIRES_DIRECTIVE — D01 pendiente; la directiva inscribe',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async annualEnroll(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AnnualEnrollBodyDto,
  ) {
    const result = await this.annualMembershipService.annualEnroll(
      userId,
      body.club_section_id,
    );
    return { status: 'success', data: result };
  }
}
