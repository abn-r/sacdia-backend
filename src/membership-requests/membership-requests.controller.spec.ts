import { Test } from '@nestjs/testing';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { GuardianEvidenceService } from '../guardianships/guardian-evidence.service';
import { ConsentVerificationService } from './consent-verification.service';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';

const USER = { sub: 'director-1' };
const ASSIGNMENT = '11111111-1111-4111-8111-111111111111';

describe('MembershipRequestsController (consent)', () => {
  const evidence = {
    uploadForDirector: jest.fn().mockResolvedValue({ evidence_id: 'ev-1' }),
    getForDirector: jest.fn().mockResolvedValue({ url: 'https://signed/x' }),
  };
  const verification = {
    verify: jest.fn().mockResolvedValue({ approve_error: null }),
  };
  const requests = {
    listPending: jest.fn().mockResolvedValue([{ assignment_id: 'a-1' }]),
  };
  let controller: MembershipRequestsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [MembershipRequestsController],
      providers: [
        { provide: MembershipRequestsService, useValue: requests },
        { provide: GuardianEvidenceService, useValue: evidence },
        { provide: ConsentVerificationService, useValue: verification },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(MembershipRequestsController);
  });

  it('lists the pending requests for the caller, who the consent verdict is computed for', async () => {
    expect(await controller.listPending(5, USER)).toEqual({
      status: 'success',
      data: [{ assignment_id: 'a-1' }],
    });
    expect(requests.listPending).toHaveBeenCalledWith(5, 'director-1');
  });

  it('uploads the form as the director of the section in the path', async () => {
    const file = { mimetype: 'application/pdf' } as never;

    expect(
      await controller.uploadConsentEvidence(5, ASSIGNMENT, file, USER),
    ).toEqual({ status: 'success', data: { evidence_id: 'ev-1' } });
    expect(evidence.uploadForDirector).toHaveBeenCalledWith(
      'director-1',
      5,
      ASSIGNMENT,
      file,
    );
  });

  it('reads the form as the director of the section in the path', async () => {
    expect(await controller.getConsentEvidence(5, ASSIGNMENT, USER)).toEqual({
      status: 'success',
      data: { url: 'https://signed/x' },
    });
    expect(evidence.getForDirector).toHaveBeenCalledWith(
      'director-1',
      5,
      ASSIGNMENT,
    );
  });

  it.each(['uploadConsentEvidence', 'getConsentEvidence'] as const)(
    '%s needs club_members:approve on the club_assignment resource and no acting scope',
    (name) => {
      const handler = MembershipRequestsController.prototype[name];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['club_members:approve'],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_assignment',
        idParam: 'assignmentId',
      });
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    },
  );

  it.each([
    ['approve', 200],
    ['reject', 200],
    ['verifyConsent', 200],
  ] as const)(
    '%s answers %i, the status its Swagger contract documents',
    (name, status) => {
      const handler = MembershipRequestsController.prototype[name];
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(status);
    },
  );

  it('limits uploads to 20 per hour on every throttler tier', () => {
    const handler =
      MembershipRequestsController.prototype.uploadConsentEvidence;
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(20);
      expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
        3_600_000,
      );
    }
  });
  describe('verify-consent', () => {
    const request = (permissions?: string[]) =>
      ({
        authorization: permissions ? { effective: { permissions } } : undefined,
      }) as never;
    const rejection = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error as AppException;
      }
      throw new Error('expected a rejection');
    };

    it('delegates with the section, the request, the verifier and the body when the verifier can also approve', async () => {
      const dto = { confirm_paper_form_reviewed: true, approve: true };

      expect(
        await controller.verifyConsent(
          5,
          ASSIGNMENT,
          dto,
          USER,
          request(['club_members:approve', 'consent:verify']),
        ),
      ).toEqual({
        status: 'success',
        data: { approve_error: null },
      });
      expect(verification.verify).toHaveBeenCalledWith(
        5,
        ASSIGNMENT,
        'director-1',
        dto,
      );
    });

    it('a verify-only reviewer (consent:verify) may verify without approving', async () => {
      const dto = { confirm_paper_form_reviewed: true, approve: false };

      await controller.verifyConsent(
        5,
        ASSIGNMENT,
        dto,
        USER,
        request(['consent:verify']),
      );
      await controller.verifyConsent(
        5,
        ASSIGNMENT,
        { confirm_paper_form_reviewed: true },
        USER,
        request(['consent:verify']),
      );

      expect(verification.verify).toHaveBeenCalledTimes(2);
    });

    it('approve:true without club_members:approve is 403 MR_APPROVE_PERMISSION_REQUIRED and the service is never called', async () => {
      const error = await rejection(
        controller.verifyConsent(
          5,
          ASSIGNMENT,
          { confirm_paper_form_reviewed: true, approve: true },
          USER,
          request(['consent:verify']),
        ),
      );

      expect(error.code).toBe(ErrorCode.MR_APPROVE_PERMISSION_REQUIRED);
      expect(error.getStatus()).toBe(403);
      expect(verification.verify).not.toHaveBeenCalled();
    });

    it('fails closed when the request carries no resolved authorization', async () => {
      const error = await rejection(
        controller.verifyConsent(
          5,
          ASSIGNMENT,
          { confirm_paper_form_reviewed: true, approve: true },
          USER,
          request(undefined),
        ),
      );

      expect(error.code).toBe(ErrorCode.MR_APPROVE_PERMISSION_REQUIRED);
      expect(verification.verify).not.toHaveBeenCalled();
    });

    it('accepts club_members:approve or consent:verify on the club_assignment resource, answers 200 and has no acting scope', () => {
      const handler = MembershipRequestsController.prototype.verifyConsent;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['club_members:approve', 'consent:verify'],
        mode: 'any',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_assignment',
        idParam: 'assignmentId',
      });
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    });
  });
});
