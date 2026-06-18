import { ClassCounselorAssignmentsController } from './class-counselor-assignments.controller';
import { ClassCounselorAssignmentsService } from './class-counselor-assignments.service';

describe('ClassCounselorAssignmentsController', () => {
  const service = {
    listAssignments: jest.fn(),
    createAssignment: jest.fn(),
    updateAssignment: jest.fn(),
    removeAssignment: jest.fn(),
  };

  let controller: ClassCounselorAssignmentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ClassCounselorAssignmentsController(
      service as unknown as ClassCounselorAssignmentsService,
    );
  });

  it('delegates creation with club, section and actor scope', async () => {
    service.createAssignment.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });

    const dto = {
      user_id: '22222222-2222-2222-2222-222222222222',
      class_id: 7,
    };

    await expect(
      controller.createAssignment(1, 20, dto, {
        sub: '11111111-1111-1111-1111-111111111111',
      }),
    ).resolves.toEqual({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });

    expect(service.createAssignment).toHaveBeenCalledWith({
      clubId: 1,
      sectionId: 20,
      actorUserId: '11111111-1111-1111-1111-111111111111',
      dto,
    });
  });

  it('delegates scoped listing with optional filters', async () => {
    service.listAssignments.mockResolvedValue([]);

    await expect(
      controller.listAssignments(1, 20, 2026, 7, 'false'),
    ).resolves.toEqual([]);

    expect(service.listAssignments).toHaveBeenCalledWith({
      clubId: 1,
      sectionId: 20,
      ecclesiasticalYearId: 2026,
      classId: 7,
      active: false,
    });
  });

  it('delegates patch and delete by assignment id', async () => {
    service.updateAssignment.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });
    service.removeAssignment.mockResolvedValue({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });

    await expect(
      controller.updateAssignment('44444444-4444-4444-4444-444444444444', {
        responsibility_type: 'assistant',
      }),
    ).resolves.toEqual({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });
    await expect(
      controller.removeAssignment('44444444-4444-4444-4444-444444444444'),
    ).resolves.toEqual({
      assignment_id: '44444444-4444-4444-4444-444444444444',
    });
  });
});
