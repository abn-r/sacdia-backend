import { Test } from '@nestjs/testing';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CriticalAuditEvent,
  CriticalAuditWriterService,
} from '../audit-logs/critical-audit-writer.service';
import { SectionRoleMutationPolicy } from '../common/authorization/section-role-mutation.policy';
import { TemporalContextFactory } from '../common/clock/temporal-context.factory';
import { RoleRequirementService } from '../role-requirements/role-requirement.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from './clubs.service';

// D1/D4 are covered in club-role-candidates.queries.spec.ts; this spec only
// checks the audit trail, so its fake transaction has no section tables.
jest.mock('./club-role-candidates.queries', () => ({
  assertServiceRoleAssignable: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../membership-requests/assignment-activation-gate', () => ({
  assertAssignmentActivationAllowed: jest.fn().mockResolvedValue(undefined),
}));

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT = '33333333-3333-4333-8333-333333333333';
const SECTION = 7;
const ROLES = [
  'director',
  'deputy-director',
  'secretary',
  'treasurer',
  'counselor',
  'instructor',
] as const;

const row = (roleName: string, over: Record<string, unknown> = {}) => ({
  assignment_id: ASSIGNMENT,
  user_id: TARGET,
  role_id: `role-${roleName}`,
  club_section_id: SECTION,
  status: 'active',
  active: true,
  start_date: new Date('2026-01-01'),
  end_date: null,
  expires_at: null,
  ecclesiastical_year_id: 2026,
  roles: { role_name: roleName },
  users: { name: 'Ana', paternal_last_name: 'Pérez' },
  ...over,
});

describe('ClubsService role mutations: durable audit with the real actor', () => {
  let service: ClubsService;
  let committed: string[];
  let events: CriticalAuditEvent[];
  let writeImpl: jest.Mock;
  let assertCanMutate: jest.Mock;
  let prisma: any;

  beforeEach(async () => {
    committed = [];
    events = [];
    writeImpl = jest.fn(async (_tx: unknown, event: CriticalAuditEvent) => {
      events.push(event);
      return { auditLogId: 1n, replayed: false };
    });
    assertCanMutate = jest.fn().mockResolvedValue(undefined);
    prisma = {
      roles: { findUnique: jest.fn(), findFirst: jest.fn() },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({
          clubs: {
            club_id: 3,
            local_field_id: 5,
            local_fields: {
              local_field_id: 5,
              timezone: 'America/Mexico_City',
            },
          },
        }),
      },
      club_role_assignments: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    // Minimal transactional fake: writes are staged and only "committed" when
    // the callback resolves; a throw discards them (rollback).
    prisma.$transaction.mockImplementation(async (cb: (tx: any) => any) => {
      const staged: string[] = [];
      const tx = {
        club_role_assignments: {
          create: jest.fn(async (args: { data: unknown }) => {
            staged.push('create');
            return args.data && row(currentRole);
          }),
          update: jest.fn(async () => {
            staged.push('update');
            return row(currentRole, updatedOver);
          }),
        },
      };
      const result = await cb(tx);
      committed.push(...staged);
      return result;
    });

    const module = await Test.createTestingModule({
      providers: [
        ClubsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FILE_STORAGE_SERVICE, useValue: {} },
        {
          provide: AuthorizationContextService,
          useValue: { invalidateUserAuthorizationCache: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendSilentToSection: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditLogsService, useValue: { recordEvent: jest.fn() } },
        {
          provide: EcclesiasticalYearService,
          useValue: {
            getCurrentYear: jest.fn().mockResolvedValue({ year_id: 2026 }),
          },
        },
        {
          provide: ClubRoleEligibilityService,
          useValue: {
            assertAssignment: jest.fn().mockResolvedValue({ allowed: true }),
          },
        },
        { provide: CriticalAuditWriterService, useValue: { write: writeImpl } },
        { provide: SectionRoleMutationPolicy, useValue: { assertCanMutate } },
        {
          provide: RoleRequirementService,
          useValue: { assertMet: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: TemporalContextFactory,
          useValue: {
            forLocalField: jest.fn().mockReturnValue({
              now: new Date('2026-03-01T15:00:00Z'),
              businessDate: '2026-03-01',
              businessTimeZone: 'America/Mexico_City',
              localFieldId: 5,
            }),
          },
        },
      ],
    }).compile();
    service = module.get(ClubsService);
    jest.spyOn(service as any, 'validateRoleSlot').mockResolvedValue(undefined);
  });

  let currentRole = 'secretary';
  let updatedOver: Record<string, unknown> = {};

  describe.each(ROLES)('%s', (roleName) => {
    beforeEach(() => {
      currentRole = roleName;
      updatedOver = {};
      prisma.roles.findUnique.mockResolvedValue({ role_name: roleName });
      prisma.roles.findFirst.mockResolvedValue({ role_id: `role-${roleName}` });
      prisma.club_role_assignments.findUnique.mockResolvedValue(row(roleName));
    });

    it('assign: actor is the caller, target is the assignee, same transaction', async () => {
      expect(ACTOR).not.toBe(TARGET);
      await service.assignRole(
        {
          user_id: TARGET,
          role_id: `role-${roleName}`,
          club_section_id: SECTION,
          ecclesiastical_year_id: 2026,
        },
        ACTOR,
      );

      expect(assertCanMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ACTOR,
          targetUserId: TARGET,
          targetRoleName: roleName,
          mutation: 'assign',
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: 'club_role_assignment',
        entityId: ASSIGNMENT,
        action: 'CLUB_ROLE_ASSIGNED',
        actor: { userId: ACTOR },
        target: {
          userId: TARGET,
          scope: { club_section_id: SECTION, club_id: 3, local_field_id: 5 },
        },
        clubId: 3,
        before: {},
        after: { role_name: roleName, active: true, status: 'active' },
        temporal: {
          businessDate: '2026-03-01',
          businessTimezone: 'America/Mexico_City',
        },
      });
      expect(events[0].eventKey).toMatch(/^club-role-assignment:/);
      expect(committed).toEqual(['create']);
    });

    it('update: audits before/after with the real actor', async () => {
      updatedOver = { end_date: new Date('2026-06-30') };
      await service.updateRoleAssignment(
        ASSIGNMENT,
        { end_date: new Date('2026-06-30') },
        ACTOR,
      );
      expect(assertCanMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ACTOR,
          targetRoleName: roleName,
          mutation: 'update',
        }),
      );
      expect(events[0]).toMatchObject({
        action: 'CLUB_ROLE_UPDATED',
        actor: { userId: ACTOR },
        target: { userId: TARGET },
        before: { end_date: null },
        after: { end_date: '2026-06-30T00:00:00.000Z' },
      });
      expect(committed).toEqual(['update']);
    });

    it('revoke: audits the ended state with the real actor', async () => {
      updatedOver = { active: false, status: 'ended' };
      await service.removeRoleAssignment(ASSIGNMENT, ACTOR);
      expect(assertCanMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ACTOR,
          targetRoleName: roleName,
          mutation: 'revoke',
        }),
      );
      expect(events[0]).toMatchObject({
        action: 'CLUB_ROLE_REVOKED',
        actor: { userId: ACTOR },
        target: { userId: TARGET },
        before: { active: true, status: 'active' },
        after: { active: false, status: 'ended' },
      });
      expect(committed).toEqual(['update']);
    });

    it('assign: rolls back when the audit writer throws', async () => {
      writeImpl.mockRejectedValueOnce(new Error('audit down'));
      await expect(
        service.assignRole(
          {
            user_id: TARGET,
            role_id: `role-${roleName}`,
            club_section_id: SECTION,
            ecclesiastical_year_id: 2026,
          },
          ACTOR,
        ),
      ).rejects.toThrow('audit down');
      expect(committed).toEqual([]);
    });

    it('update and revoke roll back when the audit writer throws', async () => {
      writeImpl.mockRejectedValue(new Error('audit down'));
      await expect(
        service.updateRoleAssignment(
          ASSIGNMENT,
          { end_date: new Date('2026-06-30') },
          ACTOR,
        ),
      ).rejects.toThrow('audit down');
      await expect(
        service.removeRoleAssignment(ASSIGNMENT, ACTOR),
      ).rejects.toThrow('audit down');
      expect(committed).toEqual([]);
    });
  });

  it('update evaluates the current role and the new role when role_id changes', async () => {
    currentRole = 'director';
    updatedOver = {};
    prisma.roles.findFirst.mockResolvedValue({ role_id: 'role-director' });
    prisma.roles.findUnique.mockResolvedValue({ role_name: 'director' });
    prisma.club_role_assignments.findUnique.mockResolvedValue(
      row('secretary', { role_id: 'role-secretary' }),
    );

    await service.updateRoleAssignment(
      ASSIGNMENT,
      { role_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      ACTOR,
    );

    expect(assertCanMutate.mock.calls.map(([i]) => i.targetRoleName)).toEqual([
      'secretary',
      'director',
    ]);
  });

  it('does not touch the database when the policy denies', async () => {
    currentRole = 'secretary';
    prisma.roles.findUnique.mockResolvedValue({ role_name: 'secretary' });
    prisma.roles.findFirst.mockResolvedValue({ role_id: 'role-secretary' });
    prisma.club_role_assignments.findUnique.mockResolvedValue(row('secretary'));
    assertCanMutate.mockRejectedValue(new Error('forbidden'));

    await expect(
      service.assignRole(
        {
          user_id: TARGET,
          role_id: 'role-secretary',
          club_section_id: SECTION,
          ecclesiastical_year_id: 2026,
        },
        ACTOR,
      ),
    ).rejects.toThrow('forbidden');
    await expect(
      service.updateRoleAssignment(ASSIGNMENT, { end_date: new Date() }, ACTOR),
    ).rejects.toThrow('forbidden');
    await expect(
      service.removeRoleAssignment(ASSIGNMENT, ACTOR),
    ).rejects.toThrow('forbidden');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
