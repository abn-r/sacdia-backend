import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import {
  CreateInsuranceReassignmentDto,
  ListReassignmentsQueryDto,
} from './dto/insurance-reassignments.dto';
import { RejectPaymentOrderDto } from './dto/field-payment-orders.dto';
import { InsuranceReassignmentsService } from './insurance-reassignments.service';
import { resolveOrderActor } from './order-actor';
import type { RequestWithProfile } from './order-actor';

@ApiTags('insurance reassignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('insurance/reassignments')
export class InsuranceReassignmentsController {
  constructor(private readonly service: InsuranceReassignmentsService) {}

  @Post()
  @RequirePermissions('insurance:create')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Solicitar reasignación de cobertura activa' })
  async create(
    @Body() dto: CreateInsuranceReassignmentDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.create(dto, resolveOrderActor(request)),
    };
  }

  @Get()
  @RequirePermissions('insurance:read')
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Listar solicitudes de reasignación del alcance' })
  async list(
    @Query() query: ListReassignmentsQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.list(query, resolveOrderActor(request)),
    };
  }

  @Post(':requestId/approve')
  @RequirePermissions('insurance:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Aprobar reasignación (cierra y abre assignment)' })
  @ApiParam({ name: 'requestId', type: Number })
  async approve(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.approve(requestId, resolveOrderActor(request)),
    };
  }

  @Post(':requestId/reject')
  @RequirePermissions('insurance:review')
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Rechazar reasignación con comentario' })
  @ApiParam({ name: 'requestId', type: Number })
  async reject(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() dto: RejectPaymentOrderDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.service.reject(
        requestId,
        dto.reason,
        resolveOrderActor(request),
      ),
    };
  }
}
