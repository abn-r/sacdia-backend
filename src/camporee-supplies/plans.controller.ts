import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  resolveCamporeeSupplyActor,
  type RequestWithProfile,
} from './camporee-supply-actor';
import {
  AdjustSupplyLineDto,
  DeliverSupplyLineDto,
  KitchenReportQueryDto,
  ReplaceSupplyPlanDto,
} from './dto/supply.dto';
import {
  CAMPOREE_SUPPLIES_CONFIGURE,
  CAMPOREE_SUPPLIES_DELIVER,
  CAMPOREE_SUPPLIES_PLAN,
  CAMPOREE_SUPPLIES_READ,
  CAMPOREE_SUPPLIES_REVIEW_PAY,
} from './permissions';
import { CamporeeSupplyPlansService } from './plans.service';

@ApiTags('camporee supplies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CamporeeSupplyPlansController {
  constructor(private readonly plans: CamporeeSupplyPlansService) {}

  @Get('camporees/:camporeeId/supply-plan')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Plan de insumos de la sección activa (local)' })
  async getLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.getOwnPlan(
        camporeeId,
        'local',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Get('union-camporees/:camporeeId/supply-plan')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Plan de insumos de la sección activa (unión)' })
  async getUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.getOwnPlan(
        camporeeId,
        'union',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Put('camporees/:camporeeId/supply-plan')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Reemplazar líneas del plan en DRAFT (local)' })
  async putLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: ReplaceSupplyPlanDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.replaceDraft(
        camporeeId,
        'local',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Put('union-camporees/:camporeeId/supply-plan')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Reemplazar líneas del plan en DRAFT (unión)' })
  async putUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: ReplaceSupplyPlanDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.replaceDraft(
        camporeeId,
        'union',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Post('camporees/:camporeeId/supply-plan/submit')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Enviar plan y emitir folio PRINCIPAL (local)' })
  async submitLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.submit(camporeeId, 'local', resolveCamporeeSupplyActor(request)),
    );
  }

  @Post('union-camporees/:camporeeId/supply-plan/submit')
  @RequirePermissions(CAMPOREE_SUPPLIES_PLAN)
  @AuthorizationResource({ type: 'active_assignment' })
  @ApiOperation({ summary: 'Enviar plan y emitir folio PRINCIPAL (unión)' })
  async submitUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.submit(camporeeId, 'union', resolveCamporeeSupplyActor(request)),
    );
  }

  @Patch('camporees/:camporeeId/supply-plan/lines')
  @RequirePermissions({
    permissions: [
      CAMPOREE_SUPPLIES_PLAN,
      CAMPOREE_SUPPLIES_REVIEW_PAY,
      CAMPOREE_SUPPLIES_CONFIGURE,
    ],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Ajustar una línea de un plan SUBMITTED (local)' })
  async adjustLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AdjustSupplyLineDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.adjustLine(
        camporeeId,
        'local',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Patch('union-camporees/:camporeeId/supply-plan/lines')
  @RequirePermissions({
    permissions: [
      CAMPOREE_SUPPLIES_PLAN,
      CAMPOREE_SUPPLIES_REVIEW_PAY,
      CAMPOREE_SUPPLIES_CONFIGURE,
    ],
    mode: 'any',
  })
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Ajustar una línea de un plan SUBMITTED (unión)' })
  async adjustUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Body() dto: AdjustSupplyLineDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.adjustLine(
        camporeeId,
        'union',
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Get('camporees/:camporeeId/supply-plans')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Listar planes de insumos del camporee local' })
  async listLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.listPlans(
        camporeeId,
        'local',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Get('union-camporees/:camporeeId/supply-plans')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({ summary: 'Listar planes de insumos del camporee de unión' })
  async listUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.listPlans(
        camporeeId,
        'union',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Post('camporees/:camporeeId/supply-lines/:lineId/deliveries')
  @RequirePermissions(CAMPOREE_SUPPLIES_DELIVER)
  @AuthorizationResource({ type: 'global' })
  @ApiParam({ name: 'lineId', type: String })
  async deliverLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: DeliverSupplyLineDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.deliver(
        camporeeId,
        'local',
        lineId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Post('union-camporees/:camporeeId/supply-lines/:lineId/deliveries')
  @RequirePermissions(CAMPOREE_SUPPLIES_DELIVER)
  @AuthorizationResource({ type: 'global' })
  async deliverUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: DeliverSupplyLineDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.deliver(
        camporeeId,
        'union',
        lineId,
        dto,
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Get('camporees/:camporeeId/supply-reports/kitchen')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  async kitchenLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: KitchenReportQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.kitchenReport(
        camporeeId,
        'local',
        resolveCamporeeSupplyActor(request),
        query.date,
      ),
    );
  }

  @Get('union-camporees/:camporeeId/supply-reports/kitchen')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  async kitchenUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Query() query: KitchenReportQueryDto,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.kitchenReport(
        camporeeId,
        'union',
        resolveCamporeeSupplyActor(request),
        query.date,
      ),
    );
  }

  @Get('camporees/:camporeeId/supply-reports/cash')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  async cashLocal(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.cashReport(
        camporeeId,
        'local',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Get('union-camporees/:camporeeId/supply-reports/cash')
  @RequirePermissions(CAMPOREE_SUPPLIES_READ)
  @AuthorizationResource({ type: 'global' })
  async cashUnion(
    @Param('camporeeId', ParseIntPipe) camporeeId: number,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.cashReport(
        camporeeId,
        'union',
        resolveCamporeeSupplyActor(request),
      ),
    );
  }

  @Post('camporee-supply-payments/:paymentId/mark-paid')
  @RequirePermissions(CAMPOREE_SUPPLIES_REVIEW_PAY)
  @AuthorizationResource({ type: 'global' })
  @ApiOperation({
    summary: 'Marcar folio de insumos (principal, cargo o devolución) como pagado',
  })
  async markPaid(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Req() request: RequestWithProfile,
  ) {
    return this.wrap(
      this.plans.markPaid(paymentId, resolveCamporeeSupplyActor(request)),
    );
  }

  private async wrap<T>(data: Promise<T>) {
    return { status: 'success', data: await data };
  }
}
