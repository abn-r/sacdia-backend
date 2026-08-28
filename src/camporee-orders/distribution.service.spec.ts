import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeOrderActor } from './camporee-order-actor';
import { CamporeeOrderDistributionService } from './distribution.service';
import { deriveDistributionStatus } from './dto/camporee-order.dto';

const SECTION_11 = 11;
const SECTION_12 = 12;
const DIRECTOR_ID = '33333333-3333-4333-8333-333333333333';
const TREASURER_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINE_A1 = '11111111-1111-4111-8111-111111111111';
const LINE_A2 = '22222222-2222-4222-8222-222222222222';
const LINE_B1 = '33333333-3333-4333-8333-333333333333';

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: DIRECTOR_ID,
    sectionIds: [SECTION_11],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function director(sectionId = SECTION_11): CamporeeOrderActor {
  return baseActor({
    localFieldId: 10,
    territory: { level: 'open' },
    activeSection: {
      club_section_id: sectionId,
      club_id: 5,
      club_name: 'Club Orion',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: 10,
    },
  });
}

function treasurer(): CamporeeOrderActor {
  return baseActor({
    userId: TREASURER_ID,
    localFieldId: 10,
    territory: { level: 'open' },
    activeSection: {
      club_section_id: SECTION_11,
      club_id: 5,
      club_name: 'Club Orion',
      club_type_id: 1,
      role_name: 'treasurer',
      local_field_id: 10,
    },
  });
}

function orderRow(
  overrides: Record<string, unknown> = {},
): {
  camporee_order_id: string;
  club_section_id: number;
  status: string;
} {
  return {
    camporee_order_id: ORDER_A,
    club_section_id: SECTION_11,
    status: 'DELIVERED',
    ...overrides,
  };
}

describe('CamporeeOrderDistributionService', () => {
  let prisma: any;
  let service: CamporeeOrderDistributionService;
  const deliveredAt = new Date('2026-08-24T21:00:00.000Z');

  beforeEach(() => {
    prisma = {
      camporee_order_lines: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new CamporeeOrderDistributionService(prisma);
  });

  it('rejects named delivery before the order is DELIVERED to the section', async () => {
    await expect(
      service.deliverToMember(
        orderRow({ status: 'PAID' }),
        LINE_A1,
        director(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_NOT_DELIVERED_TO_SECTION,
      status: 422,
    });
    expect(prisma.camporee_order_lines.findFirst).not.toHaveBeenCalled();
  });

  it('forbids a treasurer from marking a line even after DELIVERED', async () => {
    await expect(
      service.deliverToMember(orderRow(), LINE_A1, treasurer()),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_DISTRIBUTION_FORBIDDEN,
      status: 403,
    });
  });

  it('forbids a director of a different section', async () => {
    await expect(
      service.deliverToMember(orderRow(), LINE_A1, director(SECTION_12)),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_DISTRIBUTION_FORBIDDEN,
    });
  });

  it('lets the active section director mark a line after DELIVERED', async () => {
    prisma.camporee_order_lines.findFirst.mockResolvedValue({
      camporee_order_line_id: LINE_A1,
      order_id: ORDER_A,
      delivered_to_member_at: null,
      delivered_to_member_by_id: null,
    });
    prisma.camporee_order_lines.update.mockResolvedValue({
      camporee_order_line_id: LINE_A1,
      order_id: ORDER_A,
      delivered_to_member_at: deliveredAt,
      delivered_to_member_by_id: DIRECTOR_ID,
    });

    const result = await service.deliverToMember(
      orderRow(),
      LINE_A1,
      director(),
    );

    expect(prisma.camporee_order_lines.update).toHaveBeenCalledWith({
      where: { camporee_order_line_id: LINE_A1 },
      data: {
        delivered_to_member_by_id: DIRECTOR_ID,
        delivered_to_member_at: expect.any(Date),
      },
    });
    expect(result.delivered_to_member_by_id).toBe(DIRECTOR_ID);
  });

  it('is idempotent when the line is already delivered to the member', async () => {
    const existing = {
      camporee_order_line_id: LINE_A1,
      order_id: ORDER_A,
      delivered_to_member_at: deliveredAt,
      delivered_to_member_by_id: DIRECTOR_ID,
    };
    prisma.camporee_order_lines.findFirst.mockResolvedValue(existing);

    const result = await service.deliverToMember(
      orderRow(),
      LINE_A1,
      director(),
    );

    expect(result).toEqual(existing);
    expect(prisma.camporee_order_lines.update).not.toHaveBeenCalled();
  });

  it('rejects a line that does not belong to the order', async () => {
    prisma.camporee_order_lines.findFirst.mockResolvedValue(null);

    await expect(
      service.deliverToMember(orderRow(), LINE_B1, director()),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_LINE_NOT_FOUND,
    });
  });

  it('derives NOT_STARTED, PARTIAL and COMPLETE from named delivery timestamps', () => {
    expect(
      service.progressOf([
        { delivered_to_member_at: null },
        { delivered_to_member_at: null },
      ]),
    ).toBe('NOT_STARTED');
    expect(
      deriveDistributionStatus([
        { delivered_to_member_at: deliveredAt },
        { delivered_to_member_at: null },
      ]),
    ).toBe('PARTIAL');
    expect(
      service.progressOf([
        { delivered_to_member_at: deliveredAt },
        { delivered_to_member_at: deliveredAt },
      ]),
    ).toBe('COMPLETE');
  });

  it('keeps supplementary-order distributions independent', async () => {
    const lines = new Map([
      [
        LINE_A1,
        {
          camporee_order_line_id: LINE_A1,
          order_id: ORDER_A,
          delivered_to_member_at: null,
          delivered_to_member_by_id: null,
        },
      ],
      [
        LINE_A2,
        {
          camporee_order_line_id: LINE_A2,
          order_id: ORDER_A,
          delivered_to_member_at: null,
          delivered_to_member_by_id: null,
        },
      ],
      [
        LINE_B1,
        {
          camporee_order_line_id: LINE_B1,
          order_id: ORDER_B,
          delivered_to_member_at: null,
          delivered_to_member_by_id: null,
        },
      ],
    ]);
    prisma.camporee_order_lines.findFirst.mockImplementation(
      async ({
        where,
      }: {
        where: { camporee_order_line_id: string; order_id: string };
      }) => {
        const line = lines.get(where.camporee_order_line_id);
        if (!line || line.order_id !== where.order_id) {
          return null;
        }
        return line;
      },
    );
    prisma.camporee_order_lines.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { camporee_order_line_id: string };
        data: {
          delivered_to_member_at: Date;
          delivered_to_member_by_id: string;
        };
      }) => {
        const line = lines.get(where.camporee_order_line_id)!;
        Object.assign(line, data);
        return line;
      },
    );

    await service.deliverToMember(orderRow(), LINE_A1, director());

    expect(lines.get(LINE_A1)?.delivered_to_member_by_id).toBe(DIRECTOR_ID);
    expect(lines.get(LINE_A2)?.delivered_to_member_at).toBeNull();
    expect(lines.get(LINE_B1)?.delivered_to_member_at).toBeNull();
    expect(
      deriveDistributionStatus([lines.get(LINE_A1)!, lines.get(LINE_A2)!]),
    ).toBe('PARTIAL');
    expect(deriveDistributionStatus([lines.get(LINE_B1)!])).toBe('NOT_STARTED');
  });
});
