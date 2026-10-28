import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import {
  type ActorTerritoryScope,
  localFieldsWhereForActor,
  memberInLocalFieldWhere,
} from './actor-territory-scope';
import { ClubAssignmentEffectivityPolicy } from './club-assignment-effectivity.policy';
import { LocalFieldTimezoneResolver } from './local-field-timezone.resolver';

/**
 * Fuente única del predicado de vigencia que alimenta los filtros
 * miembro-céntricos (`memberIn*Where`). No define vigencia: delega en
 * `ClubAssignmentEffectivityPolicy` con un `TemporalContext` construido por
 * `TemporalContextFactory` a partir de la zona horaria del Campo Local.
 */
@Injectable()
export class MemberTerritoryScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ClubAssignmentEffectivityPolicy,
    private readonly contexts: TemporalContextFactory,
    private readonly timezones: LocalFieldTimezoneResolver,
  ) {}

  /** Predicado efectivo con la fecha de negocio del Campo Local. */
  async effectiveAssignmentForLocalField(
    localFieldId: number,
  ): Promise<Prisma.club_role_assignmentsWhereInput> {
    const localField = await this.timezones.forLocalField(localFieldId);
    return this.policy.toPrismaWhere(this.contexts.forLocalField(localField));
  }

  /**
   * Predicado efectivo para un recorte territorial. Campo Local: el suyo. Unión
   * / división abarcan varios Campos Locales y la consulta lleva un solo
   * predicado: se usa la zona del Campo Local de menor id del territorio (todos
   * comparten país en la práctica). Sin Campos Locales no hay a quién incluir
   * por club: no coincide nada.
   */
  async effectiveAssignmentForScope(
    scope: ActorTerritoryScope,
  ): Promise<Prisma.club_role_assignmentsWhereInput> {
    if (scope.level === 'local_field') {
      return this.effectiveAssignmentForLocalField(scope.localFieldId);
    }
    if (scope.level === 'union' || scope.level === 'division') {
      const representative = await this.prisma.local_fields.findFirst({
        where: localFieldsWhereForActor(scope),
        orderBy: { local_field_id: 'asc' },
        select: { local_field_id: true },
      });
      return representative
        ? this.effectiveAssignmentForLocalField(representative.local_field_id)
        : { assignment_id: { in: [] } };
    }
    return {};
  }

  /** Miembros de CUALQUIERA de los Campos Locales, cada uno con su propia fecha de negocio. */
  async memberInLocalFieldsWhere(
    localFieldIds: readonly number[],
  ): Promise<Prisma.usersWhereInput> {
    const clauses = await Promise.all(
      localFieldIds.map(async (id) =>
        memberInLocalFieldWhere(
          id,
          await this.effectiveAssignmentForLocalField(id),
        ),
      ),
    );
    return clauses.length === 1 ? clauses[0] : { OR: clauses };
  }

  /**
   * Campos Locales de un miembro: el de su fila `users` más los de los clubes
   * donde tiene un rol EFECTIVO. Cada rol se evalúa con la fecha de negocio de
   * SU Campo Local (`policy.isEffective`).
   */
  async resolveMemberLocalFieldIds(userId: string): Promise<number[]> {
    const [user, assignments] = await Promise.all([
      this.prisma.users.findUnique({
        where: { user_id: userId },
        select: { local_field_id: true },
      }),
      this.prisma.club_role_assignments.findMany({
        where: { user_id: userId },
        select: {
          active: true,
          status: true,
          start_date: true,
          end_date: true,
          expires_at: true,
          club_sections: {
            select: {
              clubs: {
                select: {
                  local_fields: {
                    select: { local_field_id: true, timezone: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    if (!user) {
      return [];
    }
    const ids = new Set<number>();
    if (user.local_field_id != null) {
      ids.add(user.local_field_id);
    }
    for (const assignment of assignments ?? []) {
      const localField = assignment.club_sections?.clubs?.local_fields;
      if (!localField || ids.has(localField.local_field_id)) {
        continue;
      }
      const context = this.contexts.forLocalField({
        local_field_id: localField.local_field_id,
        timezone: this.timezones.assertTimezone(localField.timezone),
      });
      if (this.policy.isEffective(assignment, context)) {
        ids.add(localField.local_field_id);
      }
    }
    return [...ids];
  }
}
