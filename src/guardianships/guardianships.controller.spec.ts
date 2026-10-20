import { Test } from '@nestjs/testing';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { DependentClaimCodesController } from './dependent-claim-codes.controller';
import { GuardianEvidenceService } from './guardian-evidence.service';
import { GuardianshipLifecycleService } from './guardianship-lifecycle.service';
import { GuardianshipsController } from './guardianships.controller';
import { GuardianshipsService } from './guardianships.service';
import { LinkCodesService } from './link-codes.service';
import { SupervisedLoginsService } from './supervised-logins.service';

const USER = { sub: 'guardian-1' };

describe('GuardianshipsController', () => {
  const guardianships = {
    listForGuardian: jest.fn().mockResolvedValue({ dependents: [] }),
    createDependent: jest.fn().mockResolvedValue({ user_id: 'd-1' }),
    getDetailForGuardian: jest.fn().mockResolvedValue({ user_id: 'd-1' }),
    listGuardianRelationshipTypes: jest
      .fn()
      .mockResolvedValue([
        { relationship_type_id: 'r-1', name: 'Padre', description: null },
      ]),
  };
  const linkCodes = {
    issueSecondGuardianCode: jest.fn().mockResolvedValue({ code: 'AAAA-BBBB' }),
    redeem: jest.fn().mockResolvedValue({ user_id: 'd-1' }),
    issueDirectorClaimCode: jest.fn().mockResolvedValue({ code: 'CCCC-DDDD' }),
  };
  const lifecycle = {
    deletionImpact: jest.fn().mockResolvedValue({ dependents: [] }),
    revoke: jest.fn().mockResolvedValue({ guardianship_id: 'g-1' }),
  };

  const evidence = {
    uploadForGuardian: jest.fn().mockResolvedValue({ evidence_id: 'ev-1' }),
    getForGuardian: jest.fn().mockResolvedValue({ url: 'https://signed/x' }),
  };

  const supervisedLogins = {
    get: jest.fn().mockResolvedValue({ eligible: true }),
    enable: jest.fn().mockResolvedValue({ supervised_login: {} }),
    disable: jest.fn().mockResolvedValue({ supervised_login: {} }),
    reactivate: jest.fn().mockResolvedValue({ supervised_login: {} }),
    resetPassword: jest.fn().mockResolvedValue({ sessions_revoked: 1 }),
  };

  let controller: GuardianshipsController;
  let claimController: DependentClaimCodesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [GuardianshipsController, DependentClaimCodesController],
      providers: [
        { provide: GuardianshipsService, useValue: guardianships },
        { provide: LinkCodesService, useValue: linkCodes },
        { provide: GuardianshipLifecycleService, useValue: lifecycle },
        { provide: GuardianEvidenceService, useValue: evidence },
        { provide: SupervisedLoginsService, useValue: supervisedLogins },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(GuardianshipsController);
    claimController = module.get(DependentClaimCodesController);
  });

  it('wraps every response in the success envelope', async () => {
    expect(await controller.list(USER)).toEqual({
      status: 'success',
      data: { dependents: [] },
    });
    expect(await controller.deletionImpact(USER)).toEqual({
      status: 'success',
      data: { dependents: [] },
    });
  });

  it('lists the guardian relationship types inside the success envelope', async () => {
    expect(await controller.listRelationshipTypes()).toEqual({
      status: 'success',
      data: [{ relationship_type_id: 'r-1', name: 'Padre', description: null }],
    });
  });

  it('creates a dependent for the token subject with the request context', async () => {
    const dto = { name: 'Ana' } as never;
    const req = {
      headers: { 'user-agent': 'SACDIA/1.0' },
      ip: '203.0.113.9',
    } as never;
    await controller.create(USER, dto, req);
    expect(guardianships.createDependent).toHaveBeenCalledWith(
      'guardian-1',
      dto,
      expect.any(Object),
    );
  });

  it('issues, redeems and revokes as the token subject', async () => {
    await controller.issueLinkCode(USER, 'd-1', { purpose: 'second_guardian' });
    expect(linkCodes.issueSecondGuardianCode).toHaveBeenCalledWith(
      'guardian-1',
      'd-1',
    );

    const redeem = { code: 'X' } as never;
    await controller.redeem(USER, redeem);
    expect(linkCodes.redeem).toHaveBeenCalledWith('guardian-1', redeem);

    await controller.revoke(USER, 'g-1', { reason: 'guardian_left' });
    expect(lifecycle.revoke).toHaveBeenCalledWith(
      'guardian-1',
      'g-1',
      'guardian_left',
    );
  });

  it('uploads and reads the consent form as the token subject', async () => {
    const file = { mimetype: 'application/pdf' } as never;

    expect(await controller.uploadConsentEvidence(USER, 'd-1', file)).toEqual({
      status: 'success',
      data: { evidence_id: 'ev-1' },
    });
    expect(evidence.uploadForGuardian).toHaveBeenCalledWith(
      'guardian-1',
      'd-1',
      file,
    );

    expect(await controller.getConsentEvidence(USER, 'd-1')).toEqual({
      status: 'success',
      data: { url: 'https://signed/x' },
    });
    expect(evidence.getForGuardian).toHaveBeenCalledWith('guardian-1', 'd-1');
  });

  it('limits consent form uploads to 20 per hour on every throttler tier', () => {
    const handler = GuardianshipsController.prototype.uploadConsentEvidence;
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(20);
      expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
        3_600_000,
      );
    }
  });

  describe('supervised login routes (phase 3a)', () => {
    it('delegate to the service as the token subject and wrap the envelope', async () => {
      const enable = { method: 'handle', password: 'x' } as never;
      expect(
        await controller.enableSupervisedLogin(USER, 'd-1', enable),
      ).toEqual({ status: 'success', data: { supervised_login: {} } });
      expect(supervisedLogins.enable).toHaveBeenCalledWith(
        'guardian-1',
        'd-1',
        enable,
      );

      await controller.getSupervisedLogin(USER, 'd-1');
      expect(supervisedLogins.get).toHaveBeenCalledWith('guardian-1', 'd-1');

      const disable = { reason: 'x' } as never;
      await controller.disableSupervisedLogin(USER, 'd-1', disable);
      expect(supervisedLogins.disable).toHaveBeenCalledWith(
        'guardian-1',
        'd-1',
        disable,
      );

      const reactivate = { password: 'x' } as never;
      await controller.reactivateSupervisedLogin(USER, 'd-1', reactivate);
      expect(supervisedLogins.reactivate).toHaveBeenCalledWith(
        'guardian-1',
        'd-1',
        reactivate,
      );

      const reset = { password: 'x' } as never;
      expect(
        await controller.resetSupervisedPassword(USER, 'd-1', reset),
      ).toEqual({ status: 'success', data: { sessions_revoked: 1 } });
      expect(supervisedLogins.resetPassword).toHaveBeenCalledWith(
        'guardian-1',
        'd-1',
        reset,
      );
    });

    it('throttles enable to 5 per hour on every tier', () => {
      const handler = GuardianshipsController.prototype.enableSupervisedLogin;
      for (const tier of ['short', 'medium', 'long']) {
        expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(5);
        expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
          3_600_000,
        );
      }
    });
  });

  it('delegates the director claim code to the service with the section', async () => {
    await claimController.issue(5, 'd-1', USER);
    expect(linkCodes.issueDirectorClaimCode).toHaveBeenCalledWith(
      'guardian-1',
      5,
      'd-1',
    );
  });

  it('declares NO acting scope anywhere: every route is denied while acting', () => {
    for (const target of [
      GuardianshipsController,
      DependentClaimCodesController,
    ]) {
      expect(Reflect.getMetadata(ACTING_SCOPE_KEY, target)).toBeUndefined();
      for (const name of Object.getOwnPropertyNames(target.prototype)) {
        if (name === 'constructor') continue;
        expect(
          Reflect.getMetadata(ACTING_SCOPE_KEY, target.prototype[name]),
        ).toBeUndefined();
      }
    }
  });
});
