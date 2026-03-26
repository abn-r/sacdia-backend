import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';
import { GlobalRoles } from '../common/decorators';
import { AnalyticsService } from './analytics.service';
import { SlaDashboardDto } from './dto/sla-dashboard.dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  @Get('sla-dashboard')
  @GlobalRoles('admin', 'coordinator')
  @ApiOperation({
    summary: 'SLA Dashboard',
    description:
      'Returns aggregated SLA metrics for investiture pipeline, validation queues, camporee approvals, timing, and throughput. ' +
      'Coordinators are automatically scoped to their local_field_id. ' +
      'Cached for 60 seconds.',
  })
  @ApiOkResponse({
    description: 'SLA Dashboard data',
    type: SlaDashboardDto,
  })
  async getSlaDashboard(
    @Request() req: ExpressRequest & { user: { sub: string } },
  ): Promise<{ status: string; data: SlaDashboardDto }> {
    const userId = req.user.sub;

    // Coordinators are scoped to their local_field_id; admins see the global view
    const localFieldId = await this.resolveLocalFieldScope(userId);

    const data = await this.analyticsService.getSlaDashboard(localFieldId);

    return { status: 'ok', data };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the local_field_id if the user is a coordinator (and NOT an admin).
   * Admins see the global view (no filter).
   */
  private async resolveLocalFieldScope(userId: string): Promise<number | undefined> {
    const resolved = await this.authorizationContext.resolveUserAuthorization(userId);

    const roleNames = resolved.authorization.grants.global_roles.map(
      (g) => g.role_name.toLowerCase(),
    );

    const isAdmin = roleNames.some((r) =>
      ['admin', 'assistant_admin', 'super_admin'].includes(r),
    );

    if (isAdmin) {
      return undefined;
    }

    // For coordinators, return the local_field_id from their effective scope
    const scopeLocalFieldId =
      resolved.authorization.effective.scope.global.local_field?.id;

    if (typeof scopeLocalFieldId === 'number') {
      return scopeLocalFieldId;
    }

    // Fallback: use the local_field_id from the user's profile
    const profileLocalFieldId = resolved.profile.local_field_id;
    return typeof profileLocalFieldId === 'number' ? profileLocalFieldId : undefined;
  }
}
