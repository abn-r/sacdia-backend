import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FinanceLedgerDecisionAuthorizationPort,
  FinanceLedgerRegistrationAuthorizationPort,
} from './finance-ledger.service';

type Db = Record<string, any>;
type Operation = { roles: readonly string[]; permission: string };
type Context = {
  transaction: Prisma.TransactionClient;
  actorUserId: string;
  clubId: number;
  clubSectionId: number;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_BY = [{ start_date: 'desc' }, { assignment_id: 'asc' }] as const;

@Injectable()
export class FinanceLedgerAuthorizationAdapter
  implements
    FinanceLedgerRegistrationAuthorizationPort,
    FinanceLedgerDecisionAuthorizationPort
{
  async assertCanRegister(context: Context): Promise<void> {
    return this.assert(context, {
      roles: ['treasurer', 'secretary-treasurer'],
      permission: 'finances:register',
    });
  }

  async assertCanDecide(context: Context): Promise<void> {
    return this.assert(context, {
      roles: ['director'],
      permission: 'finances:approve',
    });
  }

  private async assert(context: Context, operation: Operation): Promise<void> {
    if (!this.validContext(context)) throw this.denied();
    const db = context.transaction as unknown as Db;
    const user = await db.users.findUnique({
      where: { user_id: context.actorUserId },
      select: {
        users_pr: { select: { active_club_assignment_id: true } },
        club_role_assignments: {
          where: {
            active: true,
            OR: [{ status: 'active' }, { status: null }],
          },
          orderBy: ORDER_BY,
          select: {
            assignment_id: true,
            active: true,
            status: true,
            roles: {
              select: {
                role_name: true,
                active: true,
                role_permissions: {
                  where: { active: true },
                  select: {
                    permissions: {
                      select: { permission_name: true, active: true },
                    },
                  },
                },
              },
            },
            club_sections: {
              select: { club_section_id: true, main_club_id: true },
            },
          },
        },
      },
    });
    const assignments = user?.club_role_assignments ?? [];
    const selected =
      assignments.find(
        (assignment: { assignment_id: string }) =>
          assignment.assignment_id ===
          user?.users_pr?.active_club_assignment_id,
      ) ?? assignments[0];
    if (
      !selected ||
      !selected.roles.active ||
      !operation.roles.includes(selected.roles.role_name) ||
      !selected.roles.role_permissions.some(
        (grant: {
          permissions: { permission_name: string; active: boolean };
        }) =>
          grant.permissions.active &&
          grant.permissions.permission_name === operation.permission,
      ) ||
      selected.club_sections?.club_section_id !== context.clubSectionId ||
      selected.club_sections?.main_club_id !== context.clubId
    )
      throw this.denied();
  }

  private validContext(context: Context) {
    return (
      UUID.test(context.actorUserId) &&
      Number.isInteger(context.clubId) &&
      context.clubId > 0 &&
      Number.isInteger(context.clubSectionId) &&
      context.clubSectionId > 0
    );
  }

  private denied() {
    return new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }
}
