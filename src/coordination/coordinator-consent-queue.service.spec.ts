import { ErrorCode } from '../common/errors/error-codes';
import { CoordinatorConsentQueueService } from './coordinator-consent-queue.service';

describe('CoordinatorConsentQueueService', () => {
  const COORDINATOR = '00000000-0000-4000-8000-000000000c01';
  const PAGE = { limit: 50, offset: 0 };

  const coordination = { resolveCoordinatorScope: jest.fn() };
  const membershipRequests = { listVerifyWorkAcrossSections: jest.fn() };
  let service: CoordinatorConsentQueueService;

  const coordinatorRoles = [
    { role_name: 'coordinator', permissions: ['consent:verify'] },
  ];
  const sectionRow = (
    club_section_id: number,
    club_name: string,
    club_type_name: string,
    district_name: string | null,
  ) => ({
    club_section_id,
    name: club_type_name,
    club_type_id: 1,
    club_type_name,
    club_id: club_section_id * 10,
    club_name,
    district_id: 4,
    district_name,
    local_field_id: 2,
    local_field_name: 'Campo',
  });
  const scope = (sections: ReturnType<typeof sectionRow>[]) => ({
    is_coordinator: sections.length > 0,
    club_section_ids: sections.map((section) => section.club_section_id),
    assignments: [{ assignment_id: 'a-1', assignment_type: 'GENERAL' }],
    sections,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoordinatorConsentQueueService(
      coordination as never,
      membershipRequests as never,
    );
  });

  it.each([
    ['no resolved authorization (fail closed)', undefined],
    [
      'consent:verify from a non-coordinator role (admin)',
      [{ role_name: 'super-admin', permissions: ['consent:verify'] }],
    ],
    [
      'a coordinator role WITHOUT consent:verify',
      [{ role_name: 'zone-coordinator', permissions: ['clubs:read'] }],
    ],
  ])(
    '403 GUARD_PERMISSION_DENIED with %s; the scope is never resolved',
    async (_label, roles) => {
      await expect(
        service.listForCoordinator(COORDINATOR, roles, PAGE),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(coordination.resolveCoordinatorScope).not.toHaveBeenCalled();
      expect(
        membershipRequests.listVerifyWorkAcrossSections,
      ).not.toHaveBeenCalled();
    },
  );

  it('403 GUARD_CLUB_SCOPE_REQUIRED for a coordinator whose active assignments cover no section', async () => {
    coordination.resolveCoordinatorScope.mockResolvedValue(scope([]));

    await expect(
      service.listForCoordinator(COORDINATOR, coordinatorRoles, PAGE),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    expect(coordination.resolveCoordinatorScope).toHaveBeenCalledWith(
      COORDINATOR,
    );
    expect(
      membershipRequests.listVerifyWorkAcrossSections,
    ).not.toHaveBeenCalled();
  });

  it('lists the queue of EVERY covered section (same expansion as /me/scope) with the section labels for grouping', async () => {
    coordination.resolveCoordinatorScope.mockResolvedValue(
      scope([
        sectionRow(10, 'Club Orion', 'Conquistadores', 'Distrito Norte'),
        sectionRow(20, 'Club Vega', 'Aventureros', null),
      ]),
    );
    const item = (assignment_id: string, club_section_id: number) => ({
      assignment_id,
      club_section_id,
      consent: { viewer_can_verify: true, viewer_verify_block: null },
    });
    membershipRequests.listVerifyWorkAcrossSections.mockResolvedValue({
      items: [item('as-2', 20), item('as-1', 10)],
      total: 7,
      by_section: [
        { club_section_id: 10, pending_consent_count: 3 },
        { club_section_id: 20, pending_consent_count: 4 },
      ],
    });

    const result = await service.listForCoordinator(
      COORDINATOR,
      coordinatorRoles,
      { limit: 2, offset: 0 },
    );

    expect(
      membershipRequests.listVerifyWorkAcrossSections,
    ).toHaveBeenCalledWith([10, 20], COORDINATOR, { limit: 2, offset: 0 });
    expect(result).toEqual({
      items: [
        {
          ...item('as-2', 20),
          club_name: 'Club Vega',
          club_type_name: 'Aventureros',
          district_name: null,
        },
        {
          ...item('as-1', 10),
          club_name: 'Club Orion',
          club_type_name: 'Conquistadores',
          district_name: 'Distrito Norte',
        },
      ],
      total: 7,
      limit: 2,
      offset: 0,
      by_section: [
        {
          club_section_id: 10,
          club_name: 'Club Orion',
          club_type_name: 'Conquistadores',
          district_name: 'Distrito Norte',
          pending_consent_count: 3,
        },
        {
          club_section_id: 20,
          club_name: 'Club Vega',
          club_type_name: 'Aventureros',
          district_name: null,
          pending_consent_count: 4,
        },
      ],
    });
  });

  it('an empty queue is 200 with zero items (the coordinator is in scope, nothing waits)', async () => {
    coordination.resolveCoordinatorScope.mockResolvedValue(
      scope([sectionRow(10, 'Club Orion', 'Conquistadores', null)]),
    );
    membershipRequests.listVerifyWorkAcrossSections.mockResolvedValue({
      items: [],
      total: 0,
      by_section: [],
    });

    await expect(
      service.listForCoordinator(COORDINATOR, coordinatorRoles, PAGE),
    ).resolves.toEqual({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      by_section: [],
    });
  });
});
