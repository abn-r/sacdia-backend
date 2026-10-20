import { PostRegistrationController } from './post-registration.controller';
import { PostRegistrationService } from './post-registration.service';
import type { Request } from 'express';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { GuardianEvidenceService } from '../guardianships/guardian-evidence.service';

describe('PostRegistrationController', () => {
  let controller: PostRegistrationController;

  const mockPostRegistrationService = {
    getPhotoStatus: jest.fn(),
    getStatus: jest.fn(),
    completeStep1: jest.fn(),
    completeStep2: jest.fn(),
    completeStep3: jest.fn(),
    completeGuardianOnly: jest.fn(),
    cancelPendingMembershipRequest: jest.fn(),
  };

  const mockGuardianEvidence = {
    uploadWhileActing: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PostRegistrationController(
      mockPostRegistrationService as unknown as PostRegistrationService,
      mockGuardianEvidence as unknown as GuardianEvidenceService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate photo-status check to the service', async () => {
    mockPostRegistrationService.getPhotoStatus.mockResolvedValue({
      has_photo: true,
    });

    const result = await controller.getPhotoStatus('owner-user-1');

    expect(mockPostRegistrationService.getPhotoStatus).toHaveBeenCalledWith(
      'owner-user-1',
    );
    expect(result).toEqual({ has_photo: true });
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

  it('should delegate pending membership cancellation with owner actor context', async () => {
    const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
    const request = {
      user: { sub: userId },
    } as unknown as Request;
    const expectedResponse = {
      status: 'success',
      message:
        'Solicitud de membresía cancelada. Puedes elegir club y sección nuevamente.',
    };
    mockPostRegistrationService.cancelPendingMembershipRequest.mockResolvedValue(
      expectedResponse,
    );

    const result = await controller.cancelPendingMembershipRequest(
      userId,
      request,
    );

    expect(
      mockPostRegistrationService.cancelPendingMembershipRequest,
    ).toHaveBeenCalledWith(userId, {
      actorUserId: userId,
      isOwner: true,
    });
    expect(result).toBe(expectedResponse);
  });

  it('delegates guardian-only with an owner context and declares NO acting scope', async () => {
    const request = {
      user: { sub: 'guardian-1' },
    } as unknown as Request;
    mockPostRegistrationService.completeGuardianOnly.mockResolvedValue({
      status: 'success',
    });

    await controller.completeGuardianOnly('guardian-1', {}, request);

    expect(
      mockPostRegistrationService.completeGuardianOnly,
    ).toHaveBeenCalledWith(
      'guardian-1',
      {},
      { actorUserId: 'guardian-1', isOwner: true },
    );
    expect(
      Reflect.getMetadata(
        ACTING_SCOPE_KEY,
        PostRegistrationController.prototype.completeGuardianOnly,
      ),
    ).toBeUndefined();
  });

  describe('POST step-3/consent-evidence (guardian acting)', () => {
    const principal = {
      kind: 'guardian_acting',
      sub: 'dep-1',
      actor_sub: 'guardian-1',
    } as never;
    const file = { mimetype: 'application/pdf' } as Express.Multer.File;

    it('delegates to the evidence service with the PRINCIPAL (never the body) and wraps the envelope', async () => {
      mockGuardianEvidence.uploadWhileActing.mockResolvedValue({
        evidence_id: 'ev-1',
      });

      const result = await controller.uploadConsentEvidence(
        'dep-1',
        principal,
        file,
      );

      expect(mockGuardianEvidence.uploadWhileActing).toHaveBeenCalledWith(
        principal,
        'dep-1',
        file,
      );
      expect(result).toEqual({
        status: 'success',
        data: { evidence_id: 'ev-1' },
      });
    });

    it('declares the consent:evidence scope, skips RBAC and limits to 20 per hour', () => {
      const handler =
        PostRegistrationController.prototype.uploadConsentEvidence;
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBe(
        'consent:evidence',
      );
      expect(Reflect.getMetadata('skipPermissions', handler)).toBe(true);
      for (const tier of ['short', 'medium', 'long']) {
        expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(20);
        expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
          3_600_000,
        );
      }
    });

    it('propagates the refusals of the service (not acting, verified, bucket missing)', async () => {
      const refusal = Object.assign(new Error('x'), { status: 403 });
      mockGuardianEvidence.uploadWhileActing.mockRejectedValue(refusal);
      await expect(
        controller.uploadConsentEvidence('dep-1', principal, file),
      ).rejects.toBe(refusal);
    });
  });
});
