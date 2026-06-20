import { ClassProgressScopeController } from './class-progress-scope.controller';
import { ClassProgressScopeService } from './class-progress-scope.service';

describe('ClassProgressScopeController', () => {
  const service = {
    getProgressScope: jest.fn(),
    getClassMembersProgress: jest.fn(),
  };

  let controller: ClassProgressScopeController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ClassProgressScopeController(
      service as unknown as ClassProgressScopeService,
    );
  });

  it('delegates progress scope with club, section, year and actor', async () => {
    service.getProgressScope.mockResolvedValue({ classes: [] });

    await expect(
      controller.getProgressScope(99, 10, 2026, {
        sub: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({ classes: [] });

    expect(service.getProgressScope).toHaveBeenCalledWith({
      actorUserId: '11111111-1111-1111-1111-111111111111',
      clubId: 99,
      sectionId: 10,
      ecclesiasticalYearId: 2026,
    });
  });

  it('delegates members progress with class scope and actor', async () => {
    service.getClassMembersProgress.mockResolvedValue({ members: [] });

    await expect(
      controller.getClassMembersProgress(99, 10, 7, 2026, {
        sub: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({ members: [] });

    expect(service.getClassMembersProgress).toHaveBeenCalledWith({
      actorUserId: '11111111-1111-1111-1111-111111111111',
      clubId: 99,
      sectionId: 10,
      classId: 7,
      ecclesiasticalYearId: 2026,
    });
  });
});
