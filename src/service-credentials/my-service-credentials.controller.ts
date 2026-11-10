import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { JwtAuthGuard } from '../common/guards';
import { ParseUuidParamPipe } from '../common/pipes/parse-uuid-param.pipe';
import { namedThrottle } from '../config/throttler.helpers';
import { CreateServiceCredentialDto } from './dto/create-service-credential.dto';
import { MyServiceCredentialsService } from './my-service-credentials.service';

type MeRequest = { user: { sub: string } };

/**
 * The own counselor «constancia» of an adult account.
 *
 * No `@ActingScope` on purpose: a guardian acting for a dependent, a
 * supervised teen and a linked device are denied by default.
 */
@ApiTags('service-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@SkipPermissions()
@Controller('users/me/service-credentials')
export class MyServiceCredentialsController {
  constructor(private readonly service: MyServiceCredentialsService) {}

  @Get()
  @Throttle(namedThrottle({ ttl: 60000, limit: 60 }))
  @ApiOperation({
    summary: 'Mis constancias de consejería activas, nuevas primero',
  })
  async list(@Req() req: MeRequest) {
    return { status: 'success', data: await this.service.list(req.user.sub) };
  }

  @Post()
  @Throttle(namedThrottle({ ttl: 60000, limit: 10 }))
  @ApiOperation({
    summary: 'Registrar una constancia y obtener la URL firmada de subida',
    description:
      'Crea la fila con upload_status=PENDING_UPLOAD y devuelve una URL PUT firmada a un bucket privado. 409 SERVICE_CREDENTIAL_PENDING_EXISTS si ya hay una constancia confirmada en revisión del mismo tipo.',
  })
  @ApiResponse({ status: 201, description: '{ credential, upload }' })
  async create(@Req() req: MeRequest, @Body() dto: CreateServiceCredentialDto) {
    return {
      status: 'success',
      data: await this.service.create(req.user.sub, dto),
    };
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 20 }))
  @ApiOperation({ summary: 'Confirmar que el archivo ya se subió' })
  async confirm(
    @Req() req: MeRequest,
    @Param('id', ParseUuidParamPipe) id: string,
  ) {
    return {
      status: 'success',
      data: await this.service.confirm(req.user.sub, id),
    };
  }

  @Delete(':id')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 20 }))
  @ApiOperation({
    summary: 'Retirar una constancia que no está aprobada',
  })
  async withdraw(
    @Req() req: MeRequest,
    @Param('id', ParseUuidParamPipe) id: string,
  ) {
    await this.service.withdraw(req.user.sub, id);
    return { status: 'success', data: { credential_id: id, withdrawn: true } };
  }
}
