import { PostRegistrationController } from './post-registration.controller';
import { PostRegistrationService } from './post-registration.service';
import type { Request } from 'express';

describe('PostRegistrationController', () => {
  let controller: PostRegistrationController;

  const mockPostRegistrationService = {
    getStatus: jest.fn(),
    completeStep1: jest.fn(),
    completeStep2: jest.fn(),
    completeStep3: jest.fn(),
  };

  beforeEach(() => {
    controller = new PostRegistrationController(
      mockPostRegistrationService as unknown as PostRegistrationService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should pass owner-aware context to status reads', async () => {
    const request = {
      user: { sub: 'owner-user-1' },
    } as unknown as Request;

    mockPostRegistrationService.getStatus.mockResolvedValue({
      status: 'success',
    });

    await controller.getStatus('owner-user-1', request);

    expect(mockPostRegistrationService.getStatus).toHaveBeenCalledWith(
      'owner-user-1',
      {
        actorUserId: 'owner-user-1',
        isOwner: true,
      },
    );
  });

  it('should pass third-party context to completion writes', async () => {
    const request = {
      user: { sub: 'admin-user-1' },
    } as unknown as Request;
    const dto = {
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      club_section_id: 10,
      class_id: 5,
    };

    mockPostRegistrationService.completeStep3.mockResolvedValue({
      status: 'success',
    });

    await controller.completeStep3('target-user-1', dto, request);

    expect(mockPostRegistrationService.completeStep3).toHaveBeenCalledWith(
      'target-user-1',
      dto,
      {
        actorUserId: 'admin-user-1',
        isOwner: false,
      },
    );
  });

  it('should pass third-party context to step 1 completion writes', async () => {
    const request = {
      user: { sub: 'admin-user-1' },
    } as unknown as Request;

    mockPostRegistrationService.completeStep1.mockResolvedValue({
      status: 'success',
    });

    await controller.completeStep1('target-user-1', request);

    expect(mockPostRegistrationService.completeStep1).toHaveBeenCalledWith(
      'target-user-1',
      {
        actorUserId: 'admin-user-1',
        isOwner: false,
      },
    );
  });

  it('should pass third-party context to step 2 completion writes', async () => {
    const request = {
      user: { sub: 'admin-user-1' },
    } as unknown as Request;

    mockPostRegistrationService.completeStep2.mockResolvedValue({
      status: 'success',
    });

    await controller.completeStep2('target-user-1', request);

    expect(mockPostRegistrationService.completeStep2).toHaveBeenCalledWith(
      'target-user-1',
      {
        actorUserId: 'admin-user-1',
        isOwner: false,
      },
    );
  });
});
