import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { ParseUuidParamPipe } from '../common/pipes/parse-uuid-param.pipe';
import { namedThrottle } from '../config/throttler.helpers';
import {
  ApproveServiceCredentialDto,
  RejectServiceCredentialDto,
} from './dto/review-service-credential.dto';
import { ReviewServiceCredentialsQueryDto } from './dto/review-service-credentials-query.dto';
import { ServiceCredentialReviewService } from './service-credential-review.service';

type ReviewerRequest = { user: { sub: string } };

/**
 * Review queue of the counselor «constancia». The permission opens the door;
 * the scope (Local Field, coordinator territory, district pastor) is enforced
 * in the service and an out-of-scope id answers 404.
 */
@ApiTags('service-credentials')
@ApiBearerAuth()
@Controller('service-credentials/review')
export class ServiceCredentialsReviewController {
  constructor(private readonly service: ServiceCredentialReviewService) {}

  @Get()
  @RequirePermissions('service_credentials:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Bandeja de constancias de consejería en mi alcance',
  })
  async list(
    @Req() req: ReviewerRequest,
    @Query() query: ReviewServiceCredentialsQueryDto,
  ) {
    return {
      status: 'success',
      data: await this.service.list(req.user.sub, query),
    };
  }

  @Get(':id')
  @RequirePermissions('service_credentials:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Detalle de una constancia con URL firmada del archivo (900 s)',
  })
  async detail(
    @Req() req: ReviewerRequest,
    @Param('id', ParseUuidParamPipe) id: string,
  ) {
    return {
      status: 'success',
      data: await this.service.getDetail(req.user.sub, id),
    };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @RequirePermissions('service_credentials:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Aprobar una constancia (una aprobación basta)' })
  async approve(
    @Req() req: ReviewerRequest,
    @Param('id', ParseUuidParamPipe) id: string,
    @Body() dto: ApproveServiceCredentialDto,
  ) {
    return {
      status: 'success',
      data: await this.service.approve(req.user.sub, id, dto),
    };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Throttle(namedThrottle({ ttl: 60000, limit: 30 }))
  @RequirePermissions('service_credentials:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Rechazar una constancia con motivo' })
  async reject(
    @Req() req: ReviewerRequest,
    @Param('id', ParseUuidParamPipe) id: string,
    @Body() dto: RejectServiceCredentialDto,
  ) {
    return {
      status: 'success',
      data: await this.service.reject(req.user.sub, id, dto),
    };
  }
}
