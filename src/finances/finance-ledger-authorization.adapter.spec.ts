import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { FinanceLedgerAuthorizationAdapter } from './finance-ledger-authorization.adapter';

const ACTOR = '11111111-1111-4111-8111-111111111111';

type AssignmentInput = {
  id?: string;
  role?: string;
  permission?: string;
  permissionActive?: boolean;
  status?: string | null;
  sectionId?: number;
  clubId?: number | null;
};

const assignment = ({
  id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role = 'treasurer',
  permission = 'finances:register',
  permissionActive = true,
  status = 'active',
  sectionId = 10,
  clubId = 20,
}: AssignmentInput = {}) => ({
  assignment_id: id,
  status,
  roles: {
    role_name: role,
    active: true,
    role_permissions: [
      {
        permissions: { permission_name: permission, active: permissionActive },
      },
    ],
  },
  club_sections: { club_section_id: sectionId, main_club_id: clubId },
});

const context = (transaction: Prisma.TransactionClient) => ({
  transaction,
  actorUserId: ACTOR,
  clubId: 20,
  clubSectionId: 10,
});

const denied = (assertion: Promise<void>) =>
  expect(assertion).rejects.toMatchObject({
    status: HttpStatus.FORBIDDEN,
    code: ErrorCode.GUARD_PERMISSION_DENIED,
  });

describe('FinanceLedgerAuthorizationAdapter', () => {
  const findUnique = jest.fn();
  const transaction = {
    users: { findUnique },
  } as unknown as Prisma.TransactionClient;
  const adapter = new FinanceLedgerAuthorizationAdapter();

  it('allows treasurer and secretary-treasurer to register', async () => {
    for (const role of ['treasurer', 'secretary-treasurer']) {
      findUnique.mockResolvedValue({
        users_pr: {
          active_club_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        club_role_assignments: [assignment({ role })],
      });
      await expect(
        adapter.assertCanRegister(context(transaction)),
      ).resolves.toBeUndefined();
    }
  });

  it('falls back to the canonical first active assignment when persisted is stale', async () => {
    findUnique.mockResolvedValue({
      users_pr: { active_club_assignment_id: 'stale' },
      club_role_assignments: [assignment({ status: null })],
    });

    await expect(
      adapter.assertCanRegister(context(transaction)),
    ).resolves.toBeUndefined();
  });

  it('allows only a director with finances:approve to decide', async () => {
    findUnique.mockResolvedValue({
      users_pr: {
        active_club_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      club_role_assignments: [
        assignment({ role: 'director', permission: 'finances:approve' }),
      ],
    });

    await expect(
      adapter.assertCanDecide(context(transaction)),
    ).resolves.toBeUndefined();
  });

  it('denies a matching later grant because selection happens before role and scope checks', async () => {
    findUnique.mockResolvedValue({
      users_pr: { active_club_assignment_id: null },
      club_role_assignments: [
        assignment({ role: 'director' }),
        assignment({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          role: 'treasurer',
        }),
      ],
    });

    await denied(adapter.assertCanRegister(context(transaction)));
  });

  it.each([
    ['register', 'director', 'finances:register'],
    ['register', 'deputy-director', 'finances:register'],
    ['register', 'treasurer', 'finances:approve'],
    ['decide', 'treasurer', 'finances:approve'],
    ['decide', 'assistant-director', 'finances:approve'],
    ['decide', 'director', 'finances:register'],
  ] as const)(
    'denies %s for %s without the exact role and permission',
    async (operation, role, permission) => {
      findUnique.mockResolvedValue({
        users_pr: {
          active_club_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        club_role_assignments: [assignment({ role, permission })],
      });
      const assertion =
        operation === 'register'
          ? adapter.assertCanRegister(context(transaction))
          : adapter.assertCanDecide(context(transaction));

      await denied(assertion);
    },
  );

  it.each([
    ['register', 'treasurer', 'finances:register'],
    ['decide', 'director', 'finances:approve'],
  ] as const)(
    'denies %s when its dedicated permission is soft-disabled',
    async (operation, role, permission) => {
      findUnique.mockResolvedValue({
        users_pr: {
          active_club_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        club_role_assignments: [
          assignment({ role, permission, permissionActive: false }),
        ],
      });
      const assertion =
        operation === 'register'
          ? adapter.assertCanRegister(context(transaction))
          : adapter.assertCanDecide(context(transaction));

      await denied(assertion);
    },
  );

  it.each([
    ['wrong club', assignment({ clubId: 21 })],
    ['wrong section', assignment({ sectionId: 11 })],
    ['no assignment', undefined],
  ])('returns the same forbidden error for %s', async (_case, selected) => {
    findUnique.mockResolvedValue({
      users_pr: {
        active_club_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      club_role_assignments: selected ? [selected] : [],
    });

    await denied(adapter.assertCanRegister(context(transaction)));
  });

  it('rejects malformed context without querying or disclosing scope', async () => {
    findUnique.mockClear();
    await denied(
      adapter.assertCanRegister({
        ...context(transaction),
        actorUserId: 'invalid',
      }),
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
