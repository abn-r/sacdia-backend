import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';
import {
  INVESTITURE_PERSON_PENDING_TEXT,
  INVESTITURE_PERSON_REJECTED_TEXT,
} from './investiture-communications.rules';
import { HISTORICAL_CERTIFICATE_APPLIED_REASON } from './investiture-request-lock';

const PHRASE = INVESTITURE_PERSON_REJECTED_TEXT;

function board(sectionId: number, role = 'director'): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [],
      direct_permissions: [],
      club_assignments: [
        {
          assignment_id: 'assign-1',
          role_name: role,
          permissions: [],
          operational: true,
          ecclesiastical_year_id: 2026,
          status: 'active',
          club: { club_id: 1, club_name: 'Club' },
          section: { club_section_id: sectionId, club_type_id: 1 },
          scope: {},
        },
      ],
    },
    active_assignment: null,
  } as AuthorizationSnapshot;
}

describe('investiture history and yearbook', () => {
  const closed = {
    person_id: 'person-closed',
    user_id: 'user-ana',
    class_id: 8,
    investiture_date: new Date('2026-11-01T00:00:00.000Z'),
    status: 'CLOSED_YEAR',
    rejection_reason: PHRASE,
    system_reason: PHRASE,
    request: { club_section_id: 4, ecclesiastical_year_id: 2026 },
  };

  function serviceWith(prisma: object) {
    return new InvestitureAuthorizationRequestService(
      prisma as never,
      {} as never,
      {} as never,
    );
  }

  it('keeps class and year for a closed year and omits the rejection text', async () => {
    const prisma = {
      investiture_authorization_people: {
        findMany: jest.fn().mockResolvedValue([closed]),
      },
    };
    const service = serviceWith(prisma);

    const own = await service.ownHistory('user-ana');
    const section = await service.sectionHistory(board(4), 4);

    expect(own[0].class_id).toBe(8);
    expect(own[0].status).toBe('CLOSED_YEAR');
    expect(own[0].person_text).toBeNull();
    expect(own[0]).not.toHaveProperty('rejection_reason');
    expect(own[0]).not.toHaveProperty('system_reason');
    expect(JSON.stringify(own[0])).not.toContain(PHRASE);
    expect(section[0]).toMatchObject({
      class_id: 8,
      ecclesiastical_year_id: 2026,
      status: 'CLOSED_YEAR',
      person_text: null,
      rejection_reason: null,
      system_reason: null,
    });
    expect(JSON.stringify(section[0])).not.toContain(PHRASE);
  });

  it('IA-61 shows the later certificate note on the person and section history', async () => {
    const note =
      'Investidura acreditada posteriormente mediante certificado validado';
    const prisma = {
      investiture_authorization_people: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...closed,
            rejection_reason: null,
            system_reason: note,
          },
        ]),
      },
    };
    const service = serviceWith(prisma);

    const own = await service.ownHistory('user-ana');
    const section = await service.sectionHistory(board(4), 4);

    expect(own[0].status).toBe('CLOSED_YEAR');
    expect(own[0].person_text).toBe(note);
    expect(section[0].system_reason).toBe(note);
    expect(section[0].rejection_reason).toBeNull();
  });

  it('attributes each class to the section of its type in the same club', async () => {
    const rows = [
      {
        enrollment_id: 1,
        user_id: 'user-ana',
        class_id: 3,
        ecclesiastical_year_id: 2026,
        classes: { name: 'Amigo', club_type_id: 10 },
      },
      {
        enrollment_id: 2,
        user_id: 'user-ana',
        class_id: 8,
        ecclesiastical_year_id: 2026,
        classes: { name: 'Guía Mayor', club_type_id: 12 },
      },
    ];
    const sections = [
      { club_section_id: 4, club_type_id: 12, main_club_id: 1 },
      { club_section_id: 5, club_type_id: 10, main_club_id: 1 },
      { club_section_id: 9, club_type_id: 10, main_club_id: 2 },
    ];
    const prisma = {
      club_sections: {
        findUnique: jest.fn(async ({ where }) => {
          return (
            sections.find(
              (section) => section.club_section_id === where.club_section_id,
            ) ?? null
          );
        }),
        findMany: jest.fn(async ({ where }) => {
          return sections.filter(
            (section) => section.main_club_id === where.main_club_id,
          );
        }),
      },
      club_role_assignments: {
        findMany: jest.fn(async ({ where }) => {
          const allowed = new Set(where.club_section_id.in as number[]);
          if (!allowed.has(4)) {
            return [];
          }
          return [{ user_id: 'user-ana', ecclesiastical_year_id: 2026 }];
        }),
      },
      enrollments: {
        findMany: jest.fn(async ({ where }) => {
          return rows.filter(
            (row) => row.classes.club_type_id === where.classes.club_type_id,
          );
        }),
        create: jest.fn(),
      },
      investiture_authorization_people: {
        findMany: jest.fn(),
      },
    };
    const service = serviceWith(prisma);

    const guides = await service.yearbook(board(4), 4);
    const conquistadores = await service.yearbook(board(5), 5);
    const otherClub = await service.yearbook(board(9), 9);

    expect(guides.entries).toEqual([
      {
        enrollment_id: 2,
        user_id: 'user-ana',
        class_id: 8,
        class_name: 'Guía Mayor',
        ecclesiastical_year_id: 2026,
      },
    ]);
    expect(conquistadores.entries).toEqual([
      {
        enrollment_id: 1,
        user_id: 'user-ana',
        class_id: 3,
        class_name: 'Amigo',
        ecclesiastical_year_id: 2026,
      },
    ]);
    expect(otherClub.entries).toEqual([]);
    await expect(service.yearbook(board(4), 9)).rejects.toThrow();
    expect(prisma.enrollments.create).not.toHaveBeenCalled();
    expect(
      prisma.investiture_authorization_people.findMany,
    ).not.toHaveBeenCalled();
    await expect(
      service.yearbook(board(4, 'deputy-director'), 4),
    ).rejects.toThrow();
    await expect(service.sectionHistory(board(9), 4)).rejects.toThrow();
  });

  it('BC-3 shows each own state without revealing who rejected', async () => {
    const rows = [
      {
        ...closed,
        person_id: 'person-pending',
        status: 'PENDING',
        rejection_reason: 'motivo-humano',
        system_reason: 'texto-largo-del-sistema',
        classes: { name: 'Amigo' },
      },
      {
        ...closed,
        person_id: 'person-invested',
        status: 'INVESTED',
        authorization_comment: 'Bien hecho',
        classes: { name: 'Compañero' },
      },
      {
        ...closed,
        person_id: 'person-human',
        status: 'REJECTED_BY_PERSON',
        rejection_reason: 'motivo-humano',
        system_reason: null,
        classes: { name: 'Explorador' },
      },
      {
        ...closed,
        person_id: 'person-system',
        status: 'REJECTED_BY_SYSTEM',
        rejection_reason: null,
        system_reason: 'texto-largo-del-sistema',
        classes: { name: 'Pionero' },
      },
      {
        ...closed,
        person_id: 'person-historical',
        status: 'REMOVED',
        system_reason: HISTORICAL_CERTIFICATE_APPLIED_REASON,
        classes: { name: 'Guía' },
      },
    ];
    const service = serviceWith({
      investiture_authorization_people: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    });

    const own = await service.ownHistory('user-ana');
    const byId = new Map(own.map((entry) => [entry.person_id, entry]));

    expect(byId.get('person-pending')).toMatchObject({
      status: 'PENDING',
      person_text: INVESTITURE_PERSON_PENDING_TEXT,
      class_id: 8,
      class_name: 'Amigo',
    });
    expect(byId.get('person-invested')).toMatchObject({
      status: 'INVESTED',
      authorization_comment: 'Bien hecho',
      person_text: null,
      class_name: 'Compañero',
    });
    expect(byId.get('person-human')).toMatchObject({
      status: 'REJECTED',
      person_text: PHRASE,
      class_name: 'Explorador',
    });
    expect(byId.get('person-system')).toMatchObject({
      status: 'REJECTED',
      person_text: PHRASE,
      class_name: 'Pionero',
    });
    expect(byId.get('person-historical')?.person_text).toBe(
      HISTORICAL_CERTIFICATE_APPLIED_REASON,
    );
    const serialized = JSON.stringify(own);
    expect(serialized).not.toContain('rejection_reason');
    expect(serialized).not.toContain('system_reason');
    expect(serialized).not.toContain('REJECTED_BY_PERSON');
    expect(serialized).not.toContain('REJECTED_BY_SYSTEM');
    expect(serialized).not.toContain('motivo-humano');
    expect(serialized).not.toContain('texto-largo-del-sistema');
  });
});
