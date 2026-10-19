import { Test } from '@nestjs/testing';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import {
  AUTHORIZATION_RESOURCE_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators';
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
  let controller: MembershipRequestsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [MembershipRequestsController],
      providers: [
        { provide: MembershipRequestsService, useValue: {} },
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
  it('verify-consent delegates with the section, the request, the director and the body', async () => {
    const dto = { confirm_paper_form_reviewed: true, approve: true };

    expect(await controller.verifyConsent(5, ASSIGNMENT, dto, USER)).toEqual({
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

  it('verify-consent needs club_members:approve on the club_assignment resource, answers 200 and has no acting scope', () => {
    const handler = MembershipRequestsController.prototype.verifyConsent;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['club_members:approve'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'club_assignment',
      idParam: 'assignmentId',
    });
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
  });
});
