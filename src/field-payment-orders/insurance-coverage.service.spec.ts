import { InsuranceCoverageService } from './insurance-coverage.service';

// Fixed "today": 2026-11-17 (America/Mexico_City). Year 5: 2026-01-01 .. 2026-12-31.
const NOW = new Date('2026-11-17T18:00:00.000Z');
const YEAR = {
  year_id: 5,
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-12-31T00:00:00.000Z'),
};
const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const PAST = new Date('2026-11-01T00:00:00.000Z');

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});
afterAll(() => {
  jest.useRealTimers();
});

const person = (
  userId: string,
  name: string,
  role: string,
  image: string | null = null,
) => ({
  user_id: userId,
  roles: { role_name: role },
  users: {
    name,
    paternal_last_name: 'Test',
    maternal_last_name: null,
    user_image: image,
  },
});

const coverage = (
  id: number,
  userId: string,
  opts: { slotId: number; purchasingSection: number; folio: string },
) => ({
  insurance_assignment_id: id,
  user_id: userId,
  valid_from: NOW,
  valid_until: YEAR.end_date,
  confirmed_at: NOW,
  coverage_slot: {
    insurance_coverage_slot_id: opts.slotId,
    current_section_id: opts.purchasingSection,
    purchasing_section_id: opts.purchasingSection,
    purchasing_section: {
      club_types: { name: `Tipo ${opts.purchasingSection}` },
      clubs: { name: `Club ${opts.purchasingSection}` },
    },
    purchase: {
      external_reference: opts.folio,
      reviewed_at: new Date('2026-03-01T12:00:00.000Z'),
      owner_club: { name: `Club ${opts.purchasingSection}` },
    },
  },
});

const liveLine = (userId: string, status: string, expires = FUTURE) => ({
  beneficiary_user_id: userId,
  order: {
    field_payment_order_id: `ord-${userId}`,
    folio_reference: `ORD-${userId}`,
    status,
    expires_at: expires,
    club_section_id: 11,
  },
});

describe('InsuranceCoverageService.getOverview', () => {
  let prisma: any;
  let service: InsuranceCoverageService;

  beforeEach(() => {
    prisma = {
      ecclesiastical_years: { findFirst: jest.fn().mockResolvedValue(YEAR) },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({
          club_type_id: 1,
          main_club_id: 5,
          clubs: { local_field_id: 7 },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      club_role_assignments: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            person('u-cov', 'Cova', 'member', 'pic.jpg'),
            person('u-else', 'Elsa', 'member'),
            person('u-reas', 'Dora', 'director'),
            person('u-order', 'Oscar', 'member'),
            person('u-rev', 'Rita', 'member'),
            person('u-rej', 'Raul', 'member'),
            person('u-none', 'Nora', 'member'),
            person('u-stale', 'Sara', 'member'),
          ]),
      },
      enrollments: {
        findMany: jest.fn().mockResolvedValue([
          { user_id: 'u-cov', classes: { name: 'Amigo' } },
          { user_id: 'u-none', classes: { name: 'Compañero' } },
        ]),
      },
      insurance_cycle_configs: {
        findFirst: jest.fn().mockResolvedValue({
          insurance_cycle_config_id: 33,
          unit_cost: 150,
          purchase_deadline: new Date('2026-12-15T00:00:00.000Z'),
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ insurance_cycle_config_id: 33 }]),
      },
      insurance_assignments: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where.coverage_slot?.current_section_id) {
            return Promise.resolve([]); // free coverages
          }
          if (where.status === 'RELEASED') {
            return Promise.resolve([
              {
                insurance_coverage_slot_id: 3,
                insurance_assignment_id: 20,
                user_subject: {
                  name: 'Antiguo',
                  paternal_last_name: 'Titular',
                  maternal_last_name: null,
                },
              },
            ]);
          }
          return Promise.resolve([
            coverage(10, 'u-cov', {
              slotId: 1,
              purchasingSection: 11,
              folio: 'F1',
            }),
            coverage(11, 'u-else', {
              slotId: 2,
              purchasingSection: 40,
              folio: 'F2',
            }),
            coverage(21, 'u-reas', {
              slotId: 3,
              purchasingSection: 11,
              folio: 'F3',
            }),
          ]);
        }),
      },
      insurance_slot_movements: {
        findMany: jest.fn().mockResolvedValue([
          {
            insurance_assignment_id: 21,
            insurance_coverage_slot_id: 3,
            created_at: new Date('2026-09-01T10:00:00.000Z'),
            performer: {
              name: 'Dir',
              paternal_last_name: 'Ector',
              maternal_last_name: null,
            },
          },
        ]),
      },
      field_payment_orders: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      field_payment_order_lines: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            liveLine('u-order', 'ISSUED'),
            liveLine('u-rev', 'PROOF_SUBMITTED'),
            liveLine('u-rej', 'PROOF_REJECTED'),
            liveLine('u-stale', 'ISSUED', PAST),
          ]),
        updateMany: jest.fn(),
      },
    };
    service = new InsuranceCoverageService(prisma);
  });

  it('returns year, cycle, counts and every member AND staff with their status, uninsured first', async () => {
    const overview = await service.getOverview(11);

    expect(overview.year).toEqual({
      ecclesiastical_year_id: 5,
      label: '2026',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    expect(overview.cycle).toEqual({
      insurance_cycle_config_id: 33,
      unit_cost: '150.00',
      purchase_deadline: '2026-12-15',
      currency: 'MXN',
    });
    expect(overview.counts).toEqual({
      total: 8,
      covered: 3,
      in_process: 3,
      uninsured: 2,
    });
    expect(overview.free_coverages_count).toBe(0);

    expect(overview.people.map((p) => [p.user_id, p.status])).toEqual([
      ['u-none', 'uninsured'],
      ['u-stale', 'uninsured'], // ISSUED past expires_at no longer holds a place
      ['u-order', 'in_order'],
      ['u-rej', 'proof_rejected'],
      ['u-rev', 'in_review'],
      ['u-cov', 'covered'],
      ['u-reas', 'covered'],
      ['u-else', 'covered'],
    ]);
  });

  it('describes who/where for each covered person and the active order for in-process ones', async () => {
    const { people } = await service.getOverview(11);
    const byId = Object.fromEntries(people.map((p) => [p.user_id, p]));

    expect(byId['u-cov']).toMatchObject({
      name: 'Cova Test',
      picture: 'pic.jpg',
      role_label: 'Amigo',
      is_staff: false,
      active_order: null,
      coverage: {
        source: 'paid_here',
        paid_in_section_name: 'Tipo 11',
        paid_in_club_name: 'Club 11',
        order_folio: 'F1',
        approved_at: '2026-03-01T12:00:00.000Z',
        valid_until: '2026-12-31',
        reassigned_from_name: null,
        reassigned_by_name: null,
        reassigned_at: null,
      },
    });
    expect(byId['u-else'].coverage).toMatchObject({
      source: 'paid_elsewhere',
      paid_in_section_name: 'Tipo 40',
      paid_in_club_name: 'Club 40',
      order_folio: 'F2',
    });
    expect(byId['u-reas']).toMatchObject({
      is_staff: true,
      role_label: 'director',
      coverage: {
        source: 'reassigned',
        reassigned_from_name: 'Antiguo Titular',
        reassigned_by_name: 'Dir Ector',
        reassigned_at: '2026-09-01T10:00:00.000Z',
      },
    });
    expect(byId['u-order']).toMatchObject({
      coverage: null,
      active_order: {
        order_id: 'ord-u-order',
        folio: 'ORD-u-order',
        status: 'ISSUED',
        expires_at: FUTURE.toISOString(),
      },
    });
    expect(byId['u-none']).toMatchObject({
      role_label: 'Compañero',
      coverage: null,
      active_order: null,
    });
  });

  it('computes "covered" from insurance_assignments (ACTIVE, valid today, same ecclesiastical year, any club type)', async () => {
    await service.getOverview(11);
    const call = prisma.insurance_assignments.findMany.mock.calls.find(
      ([arg]: any) =>
        !arg.where.coverage_slot?.current_section_id &&
        arg.where.status === 'ACTIVE',
    );
    expect(call[0].where).toMatchObject({
      status: 'ACTIVE',
      valid_until: { gte: new Date('2026-11-17T00:00:00.000Z') },
      coverage_slot: {
        purchase: { cycle_config: { ecclesiastical_year_id: 5 } },
      },
    });
    expect(prisma.insurance_cycle_configs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          local_field_id: 7,
          club_type_id: 1,
          ecclesiastical_year_id: 5,
          active: true,
        }),
      }),
    );
  });

  it('cycle is null when the LF has no active cycle for this year and club type', async () => {
    prisma.insurance_cycle_configs.findFirst.mockResolvedValue(null);
    const overview = await service.getOverview(11);
    expect(overview.cycle).toBeNull();
    expect(overview.counts.total).toBe(8);
  });

  it('returns an empty overview when no ecclesiastical year contains today', async () => {
    prisma.ecclesiastical_years.findFirst.mockResolvedValue(null);
    const overview = await service.getOverview(11);
    expect(overview).toEqual({
      year: null,
      cycle: null,
      counts: { total: 0, covered: 0, in_process: 0, uninsured: 0 },
      free_coverages_count: 0,
      people: [],
    });
  });

  it('shows a person with both a staff and a member row once, as staff', async () => {
    prisma.club_role_assignments.findMany.mockResolvedValue([
      person('u-1', 'Uno', 'member'),
      person('u-1', 'Uno', 'treasurer'),
    ]);
    prisma.insurance_assignments.findMany.mockResolvedValue([]);
    prisma.field_payment_order_lines.findMany.mockResolvedValue([]);
    const { people } = await service.getOverview(11);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      is_staff: true,
      role_label: 'treasurer',
    });
  });
});

describe('InsuranceCoverageService.getFreeCoverages', () => {
  let prisma: any;
  let service: InsuranceCoverageService;

  const slotAssignments = (ids: number[]) =>
    ids.map((id) => ({ insurance_assignment_id: id }));

  beforeEach(() => {
    prisma = {
      ecclesiastical_years: { findFirst: jest.fn().mockResolvedValue(YEAR) },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({ main_club_id: 5 }),
      },
      insurance_assignments: {
        findMany: jest.fn().mockResolvedValue([
          {
            insurance_assignment_id: 31,
            user_id: 'left',
            valid_until: YEAR.end_date,
            user_subject: {
              name: 'Lola',
              paternal_last_name: 'Salió',
              maternal_last_name: null,
            },
            coverage_slot: {
              assignments: slotAssignments([30, 31]),
              purchase: { external_reference: 'ORD-P' },
            },
          },
          {
            insurance_assignment_id: 32,
            user_id: 'stays',
            valid_until: YEAR.end_date,
            user_subject: {
              name: 'Sam',
              paternal_last_name: 'Queda',
              maternal_last_name: null,
            },
            coverage_slot: {
              assignments: slotAssignments([32]),
              purchase: { external_reference: 'ORD-Q' },
            },
          },
        ]),
      },
      club_role_assignments: {
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          where.active === true
            ? Promise.resolve([{ user_id: 'stays' }]) // still active in the club
            : Promise.resolve([
                {
                  user_id: 'left',
                  end_date: new Date('2026-10-01T00:00:00.000Z'),
                  modified_at: new Date('2026-10-02T00:00:00.000Z'),
                },
              ]),
        ),
      },
      field_payment_order_lines: {
        findMany: jest.fn().mockResolvedValue([
          {
            insurance_assignment_id: 30,
            order: {
              field_payment_order_id: 'ord-1',
              folio_reference: 'ORD20260030',
            },
          },
        ]),
      },
    };
    service = new InsuranceCoverageService(prisma);
  });

  it('lists only coverages whose holder is no longer active in the club', async () => {
    const free = await service.getFreeCoverages(11);

    expect(free).toEqual([
      {
        insurance_assignment_id: 31,
        holder: { user_id: 'left', name: 'Lola Salió' },
        valid_until: '2026-12-31',
        order_id: 'ord-1',
        order_folio: 'ORD20260030',
        left_at: '2026-10-01T00:00:00.000Z',
      },
    ]);
    const where = prisma.insurance_assignments.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      subject_type: 'MEMBER',
      status: 'ACTIVE',
      valid_until: { gte: new Date('2026-11-17T00:00:00.000Z') },
      coverage_slot: {
        current_section_id: 11,
        purchase: { cycle_config: { ecclesiastical_year_id: 5 } },
      },
    });
  });

  it('falls back to the purchase reference when no order line is linked', async () => {
    prisma.field_payment_order_lines.findMany.mockResolvedValue([]);
    const [item] = await service.getFreeCoverages(11);
    expect(item.order_id).toBeNull();
    expect(item.order_folio).toBe('ORD-P');
  });

  it('is empty without current year, club, or candidates', async () => {
    prisma.ecclesiastical_years.findFirst.mockResolvedValue(null);
    expect(await service.getFreeCoverages(11)).toEqual([]);
    prisma.ecclesiastical_years.findFirst.mockResolvedValue(YEAR);
    prisma.club_sections.findUnique.mockResolvedValue({ main_club_id: null });
    expect(await service.getFreeCoverages(11)).toEqual([]);
    prisma.club_sections.findUnique.mockResolvedValue({ main_club_id: 5 });
    prisma.insurance_assignments.findMany.mockResolvedValue([]);
    expect(await service.getFreeCoverages(11)).toEqual([]);
  });
});

describe('InsuranceCoverageService bridge helpers', () => {
  it('deactivateBridge targets the holder and the order folio', async () => {
    const tx: any = { member_insurances: { updateMany: jest.fn() } };
    const service = new InsuranceCoverageService({} as any);
    await service.deactivateBridge(tx, {
      userId: 'u1',
      folioReference: 'ORD1',
      actorId: 'a1',
    });
    expect(tx.member_insurances.updateMany).toHaveBeenCalledWith({
      where: {
        user_id: 'u1',
        insurance_type: 'GENERAL_ACTIVITIES',
        active: true,
        policy_number: 'ORD1',
      },
      data: { active: false, modified_by_id: 'a1' },
    });
  });
});
