import { ActivitiesController } from './activities.controller';

describe('ActivitiesController: the agenda for a linked device (3b)', () => {
  const service = {
    findByClub: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    findOne: jest.fn().mockResolvedValue({ activity_id: 1 }),
  };
  const controller = new ActivitiesController(service as never);

  const request = (kind: string) => ({
    user: { sub: 'child-1', kind },
    authorization: {
      effective: { scope: { club: { section: { club_section_id: 5 } } } },
    },
  });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['linked_device', true],
    ['user', false],
    ['supervised_user', false],
    ['guardian_acting', false],
  ])('%s: findOne withoutMemberLists = %s', async (kind, expected) => {
    await controller.findOne(1, request(kind));

    expect(service.findOne).toHaveBeenCalledWith(
      1,
      { userId: 'child-1', sectionId: 5 },
      { withoutMemberLists: expected },
    );
  });

  it.each([
    ['linked_device', true],
    ['user', false],
    ['supervised_user', false],
  ])('%s: findByClub withoutMemberLists = %s', async (kind, expected) => {
    await controller.findByClub(
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      request(kind),
    );

    const args = service.findByClub.mock.calls[0];
    expect(args[3]).toBe(5);
    expect(args[4]).toBe('child-1');
    expect(args[5]).toEqual({ withoutMemberLists: expected });
  });
});
