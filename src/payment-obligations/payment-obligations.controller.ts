import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthorizationResource,
  RequirePermissions,
} from '../common/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { CAMPOREE_ORDERS_READ } from '../camporee-orders/permissions';
import { CAMPOREE_SUPPLIES_READ } from '../camporee-supplies/permissions';
import {
  resolveOrderActor,
  type RequestWithProfile,
} from '../field-payment-orders/order-actor';
import { MATERIALS_READ } from '../materials/shared/permissions';
import { ListPaymentObligationsQueryDto } from './dto/list-payment-obligations.query.dto';
import { PaymentObligationsService } from './payment-obligations.service';

@ApiTags('payment obligations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payment-obligations')
export class PaymentObligationsController {
  constructor(private readonly obligations: PaymentObligationsService) {}

  @Get('pending')
  @RequirePermissions({
    permissions: [
      CAMPOREE_ORDERS_READ,
      CAMPOREE_SUPPLIES_READ,
      'field-payment-orders:read',
      MATERIALS_READ,
    ],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({
    summary:
      'Listar obligaciones pendientes (inscripción, materiales, pedidos e insumos de camporee) sin fusionar folios',
  })
  async listPending(
    @Query() query: ListPaymentObligationsQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return {
      status: 'success',
      data: await this.obligations.listPending(
        query,
        resolveOrderActor(request),
      ),
    };
  }
}
