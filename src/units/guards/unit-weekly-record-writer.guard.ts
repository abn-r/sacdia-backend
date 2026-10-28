import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { RequirePermissions } from '../../common/decorators';

/** Permission that has always gated weekly-record writes (club scope). */
export const WEEKLY_RECORD_WRITE_PERMISSION = 'units:update';

const POSITIVE_INT_PARAM = /^[1-9]\d{0,9}$/;

/**
 * Second gate for the weekly-record write endpoints of a unit.
 *
 * Runs AFTER the global `PermissionsGuard`, which has already checked that the
 * caller holds `units:update` or `units:read` and that the club in the route is
 * inside the caller's scope (active club assignment or territory). This guard
 * only answers "which of the two did they hold?":
 *
 *  - `units:update` in the caller's effective permissions -> allowed, exactly
 *    as before (directors, secretaries, territorial roles, ...).
 *  - otherwise, the caller must be the captain, secretary, advisor or
 *    substitute advisor of THIS unit, and the unit must be active and belong
 *    to the `:clubId` of the route. A plain member with `units:read` who leads
 *    another unit (or no unit) gets the same `403 GUARD_PERMISSION_DENIED` the
 *    permissions guard raises.
 *
 * It never widens anything else: it is only attached through
 * {@link UnitWeeklyRecordWriter}, which also swaps the route permission to the
 * `units:update` OR `units:read` pair this guard needs.
 */
@Injectable()
export class UnitWeeklyRecordWriterGuard implements CanActivate {
  constructor(
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: unknown = request.user?.sub;

    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    // PermissionsGuard stores the resolved profile on the request. Resolving
    // here when it is absent keeps this guard fail-closed on its own instead
    // of depending on guard ordering (the context itself is cached 5 min).
    const resolved =
      request.authorizationProfile ??
      (await this.authorizationContext.resolveUserAuthorization(userId));

    const effectivePermissions: string[] =
      resolved?.authorization?.effective?.permissions ?? [];

    if (effectivePermissions.includes(WEEKLY_RECORD_WRITE_PERMISSION)) {
      return true;
    }

    const clubId = this.parsePositiveInt(request.params?.clubId);
    const unitId = this.parsePositiveInt(request.params?.unitId);

    if (clubId !== null && unitId !== null) {
      const ledUnit = await this.prisma.units.findFirst({
        where: {
          unit_id: unitId,
          active: true,
          club_sections: { main_club_id: clubId },
          OR: [
            { captain_id: userId },
            { secretary_id: userId },
            { advisor_id: userId },
            { substitute_advisor_id: userId },
          ],
        },
        select: { unit_id: true },
      });

      if (ledUnit) {
        return true;
      }
    }

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private parsePositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && POSITIVE_INT_PARAM.test(value)) {
      return Number(value);
    }
    return null;
  }
}

/**
 * Marks a unit weekly-record WRITE route. Bundles the route permission with the
 * guard that narrows it, so the two cannot drift apart: the global guard lets
 * through `units:update` OR `units:read` holders of the club, and
 * {@link UnitWeeklyRecordWriterGuard} then admits only `units:update` holders
 * and leaders of the unit. Use together with `@AuthorizationResource` (club).
 */
export const UnitWeeklyRecordWriter = () =>
  applyDecorators(
    RequirePermissions({
      permissions: [WEEKLY_RECORD_WRITE_PERMISSION, 'units:read'],
      mode: 'any',
    }),
    UseGuards(UnitWeeklyRecordWriterGuard),
  );
