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

/** What PermissionsGuard leaves on the request (see AuthorizedRequest). */
const asRequest = (permissions?: string[], coordinatorSectionGrant?: boolean) =>
  ({
    authorization: permissions ? { effective: { permissions } } : undefined,
    coordinatorSectionGrant,
  }) as never;
const DIRECTOR_REQUEST = asRequest(['club_members:approve', 'consent:verify']);
const VERIFY_ONLY_REQUEST = asRequest(['consent:verify']);

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
    expect(await controller.listPending(5, USER, DIRECTOR_REQUEST)).toEqual({
      status: 'success',
      data: [{ assignment_id: 'a-1' }],
    });
    expect(requests.listPending).toHaveBeenCalledWith(5, 'director-1', {
      verifyOnly: false,
    });
  });

  describe('who gets the filtered (verify-only) view', () => {
    const verifyOnlyOf = async (request: never) => {
      await controller.listPending(5, USER, request);
      return requests.listPending.mock.calls[0][2].verifyOnly;
    };

    it('club_members:approve effective: everything, unchanged', async () => {
      expect(await verifyOnlyOf(asRequest(['club_members:approve']))).toBe(
        false,
      );
    });

    it('consent:verify alone (a secretary or club role with only that): filtered', async () => {
      expect(await verifyOnlyOf(VERIFY_ONLY_REQUEST)).toBe(true);
    });

    it('a coordinator: filtered', async () => {
      expect(await verifyOnlyOf(asRequest(['consent:verify'], true))).toBe(
        true,
      );
    });

    it('a coordinator who also holds club_members:approve elsewhere (active club role of ANOTHER club) is still filtered here', async () => {
      expect(
        await verifyOnlyOf(
          asRequest(['club_members:approve', 'consent:verify'], true),
        ),
      ).toBe(true);
    });

    it('fails closed (filtered) when the request carries no resolved authorization', async () => {
      expect(await verifyOnlyOf(asRequest(undefined))).toBe(true);
    });
  });

  it('uploads the form as the director of the section in the path', async () => {
    const file = { mimetype: 'application/pdf' } as never;

    expect(
      await controller.uploadConsentEvidence(
        5,
        ASSIGNMENT,
        file,
        USER,
        DIRECTOR_REQUEST,
      ),
    ).toEqual({ status: 'success', data: { evidence_id: 'ev-1' } });
    expect(evidence.uploadForDirector).toHaveBeenCalledWith(
      'director-1',
      5,
      ASSIGNMENT,
      file,
    );
  });

  it('uploading the form is for approvers only (ruling W5): club_members:approve on the club_assignment, no coordinator sections, no acting scope', () => {
    const handler =
      MembershipRequestsController.prototype.uploadConsentEvidence;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['club_members:approve'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'club_assignment',
      idParam: 'assignmentId',
    });
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
  });

  it('reads the form as the director of the section in the path', async () => {
    expect(
      await controller.getConsentEvidence(
        5,
        ASSIGNMENT,
        USER,
        DIRECTOR_REQUEST,
      ),
    ).toEqual({
      status: 'success',
      data: { url: 'https://signed/x' },
    });
    expect(evidence.getForDirector).toHaveBeenCalledWith(
      'director-1',
      5,
      ASSIGNMENT,
      { verifyOnly: false },
    );
  });

  it('reads the form as a verify-only reviewer (coordinator): the service narrows to the filtered list', async () => {
    await controller.getConsentEvidence(
      5,
      ASSIGNMENT,
      USER,
      asRequest(['consent:verify'], true),
    );

    expect(evidence.getForDirector).toHaveBeenCalledWith(
      'director-1',
      5,
      ASSIGNMENT,
      { verifyOnly: true },
    );
  });

  it.each(['getConsentEvidence'] as const)(
    '%s needs club_members:approve or consent:verify on the club_assignment resource (coordinator sections opted in) and no acting scope',
    (name) => {
      const handler = MembershipRequestsController.prototype[name];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['club_members:approve', 'consent:verify'],
        mode: 'any',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_assignment',
        idParam: 'assignmentId',
        coordinatorSections: true,
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
        { verifyOnly: false },
      );
    });

    it.each([
      ['consent:verify alone', request(['consent:verify'])],
      [
        'a coordinator (approve from another club role)',
        asRequest(['club_members:approve', 'consent:verify'], true),
      ],
    ])(
      '%s: the service is told it is a verify-only reviewer (404 outside their list)',
      async (_label, req) => {
        const dto = { confirm_paper_form_reviewed: true, approve: false };

        await controller.verifyConsent(5, ASSIGNMENT, dto, USER, req);

        expect(verification.verify).toHaveBeenCalledWith(
          5,
          ASSIGNMENT,
          'director-1',
          dto,
          { verifyOnly: true },
        );
      },
    );

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

    it('approve:true by a coordinator whose club_members:approve comes from ANOTHER club role is 403, the service is never called', async () => {
      const error = await rejection(
        controller.verifyConsent(
          5,
          ASSIGNMENT,
          { confirm_paper_form_reviewed: true, approve: true },
          USER,
          asRequest(['club_members:approve', 'consent:verify'], true),
        ),
      );

      expect(error.code).toBe(ErrorCode.MR_APPROVE_PERMISSION_REQUIRED);
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

    it('accepts club_members:approve or consent:verify on the club_assignment resource (coordinator sections opted in), answers 200 and has no acting scope', () => {
      const handler = MembershipRequestsController.prototype.verifyConsent;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['club_members:approve', 'consent:verify'],
        mode: 'any',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_assignment',
        idParam: 'assignmentId',
        coordinatorSections: true,
      });
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    });
  });

  describe('verify-only reviewers (consent:verify without club_members:approve)', () => {
    const REVIEW_ROUTES = [
      'listPending',
      'getConsentEvidence',
      'verifyConsent',
    ] as const;

    it.each(REVIEW_ROUTES)(
      '%s accepts club_members:approve OR consent:verify and opts in coordinator sections',
      (route) => {
        const handler = MembershipRequestsController.prototype[route];
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
          permissions: ['club_members:approve', 'consent:verify'],
          mode: 'any',
        });
        expect(
          Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler),
        ).toMatchObject({ coordinatorSections: true });
      },
    );

    it.each(['approve', 'reject'] as const)(
      '%s stays club_members:approve only, without coordinator sections',
      (route) => {
        const handler = MembershipRequestsController.prototype[route];
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
          permissions: ['club_members:approve'],
          mode: 'all',
        });
        expect(
          Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler),
        ).toEqual({ type: 'club_assignment', idParam: 'assignmentId' });
      },
    );

    it('the list keeps its club_section resource', () => {
      expect(
        Reflect.getMetadata(
          AUTHORIZATION_RESOURCE_KEY,
          MembershipRequestsController.prototype.listPending,
        ),
      ).toEqual({
        type: 'club_section',
        idParam: 'clubSectionId',
        coordinatorSections: true,
      });
    });
  });
});
