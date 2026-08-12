import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { CertificationCloseoutController } from './certification-closeout.controller';
import { CertificationCloseoutService } from '../closeout/certification-closeout.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { ErrorCode } from '../../common/errors/error-codes';

const USER_ID = 'user-uuid-001';
const REVIEWER_ID = 'reviewer-uuid-001';
const LOCAL_FIELD_ID = 10;
const ENROLLMENT_ID = 42;

const ENROLLMENT_BASE =
  'users/:userId/certification-enrollments/:enrollmentId';

const makeServiceMock = () => ({
  presignCloseoutEvidence: jest.fn(),
  confirmCloseoutEvidence: jest.fn(),
  submitFinal: jest.fn(),
  getFinalTray: jest.fn(),
  approveCloseoutEvidence: jest.fn(),
  requestChanges: jest.fn(),
  certify: jest.fn(),
});

const buildRequest = (overrides: Record<string, unknown> = {}) => ({
  user: { sub: REVIEWER_ID },
  authorizationProfile: {
    authorization: {
      grants: {
        global_roles: [{ role_name: 'director-lf', permissions: [], scope: {} }],
      },
      effective: {
        permissions: ['certifications:review'],
        scope: {
          global: { local_field: { id: LOCAL_FIELD_ID } },
          club: null,
        },
      },
    },
  },
  ...overrides,
});

describe('CertificationCloseoutController', () => {
  let controller: CertificationCloseoutController;
  let service: ReturnType<typeof makeServiceMock>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificationCloseoutController],
      providers: [
        { provide: CertificationCloseoutService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CertificationCloseoutController);
    reflector = new Reflector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('route contract (plan base — enrollmentId paths)', () => {
    const routeOf = (handler: unknown) =>
      Reflect.getMetadata(PATH_METADATA, handler as object);
    const methodOf = (handler: unknown) =>
      Reflect.getMetadata(METHOD_METADATA, handler as object);

    it('presignCloseoutEvidence is POST .../certification-enrollments/:enrollmentId/closeout-evidence/presign', () => {
      expect(routeOf(controller.presignCloseoutEvidence)).toBe(
        `${ENROLLMENT_BASE}/closeout-evidence/presign`,
      );
      expect(methodOf(controller.presignCloseoutEvidence)).toBe(
        RequestMethod.POST,
      );
    });

    it('confirmCloseoutEvidence is POST .../certification-enrollments/:enrollmentId/closeout-evidence/confirm', () => {
      expect(routeOf(controller.confirmCloseoutEvidence)).toBe(
        `${ENROLLMENT_BASE}/closeout-evidence/confirm`,
      );
      expect(methodOf(controller.confirmCloseoutEvidence)).toBe(
        RequestMethod.POST,
      );
    });

    it('submitFinal is POST .../certification-enrollments/:enrollmentId/submit-final', () => {
      expect(routeOf(controller.submitFinal)).toBe(
        `${ENROLLMENT_BASE}/submit-final`,
      );
      expect(methodOf(controller.submitFinal)).toBe(RequestMethod.POST);
    });
  });

  describe('authorization metadata', () => {
    it('presignCloseoutEvidence requires user_certifications:manage on the owning user', () => {
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.presignCloseoutEvidence,
      );
      expect(permissions.permissions).toContain('user_certifications:manage');
      const resource = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.presignCloseoutEvidence,
      );
      expect(resource).toEqual({ type: 'user', ownerParam: 'userId' });
    });

    it('certify requires certifications:certify with global scope', () => {
      const permissions = reflector.get(PERMISSIONS_KEY, controller.certify);
      expect(permissions.permissions).toContain('certifications:certify');
      const resource = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.certify,
      );
      expect(resource).toEqual({ type: 'global' });
    });

    it('approveCloseoutEvidence and requestChanges require certifications:review with global scope', () => {
      for (const handler of [
        controller.approveCloseoutEvidence,
        controller.requestChanges,
        controller.getFinalTray,
      ]) {
        const permissions = reflector.get(PERMISSIONS_KEY, handler);
        expect(permissions.permissions).toContain('certifications:review');
        const resource = reflector.get(AUTHORIZATION_RESOURCE_KEY, handler);
        expect(resource).toEqual({ type: 'global' });
      }
    });
  });

  describe('participant endpoints', () => {
    it('presignCloseoutEvidence delegates to the service', async () => {
      const dto = {
        file_name: 'acta.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
      };
      service.presignCloseoutEvidence.mockResolvedValue({
        closeout_evidence_id: 900,
        upload_url: 'https://r2.example.com/put',
      });

      const result = await controller.presignCloseoutEvidence(
        USER_ID,
        ENROLLMENT_ID,
        dto as any,
      );

      expect(service.presignCloseoutEvidence).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          closeout_evidence_id: 900,
          upload_url: 'https://r2.example.com/put',
        },
      });
    });

    it('confirmCloseoutEvidence delegates to the service', async () => {
      const dto = { closeout_evidence_id: 900 };
      service.confirmCloseoutEvidence.mockResolvedValue({
        closeout_evidence_id: 900,
        upload_status: 'CONFIRMED',
      });

      const result = await controller.confirmCloseoutEvidence(
        USER_ID,
        ENROLLMENT_ID,
        dto as any,
      );

      expect(service.confirmCloseoutEvidence).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
        dto,
      );
      expect(result.data.upload_status).toBe('CONFIRMED');
    });

    it('submitFinal delegates to the service', async () => {
      service.submitFinal.mockResolvedValue({
        enrollment_id: ENROLLMENT_ID,
        status: 'SUBMITTED_FOR_FINAL_REVIEW',
      });

      const result = await controller.submitFinal(USER_ID, ENROLLMENT_ID);

      expect(service.submitFinal).toHaveBeenCalledWith(USER_ID, ENROLLMENT_ID);
      expect(result).toEqual({
        status: 'success',
        data: {
          enrollment_id: ENROLLMENT_ID,
          status: 'SUBMITTED_FOR_FINAL_REVIEW',
        },
      });
    });
  });

  describe('actor resolution', () => {
    it('missing authorizationProfile → GUARD_USER_NOT_AUTHENTICATED', async () => {
      await expect(
        controller.getFinalTray({ user: { sub: REVIEWER_ID } } as any),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
    });

    it('resolves localFieldId from the effective global scope for a local-field reviewer', async () => {
      service.getFinalTray.mockResolvedValue([]);

      await controller.getFinalTray(buildRequest() as any);

      expect(service.getFinalTray).toHaveBeenCalledWith({
        userId: REVIEWER_ID,
        localFieldId: LOCAL_FIELD_ID,
        globalAccess: false,
      });
    });

    it('grants globalAccess to admin/super-admin without a local_field scope', async () => {
      service.certify.mockResolvedValue({ status: 'CERTIFIED' });

      const adminRequest = buildRequest({
        authorizationProfile: {
          authorization: {
            grants: {
              global_roles: [{ role_name: 'super-admin', permissions: [], scope: {} }],
            },
            effective: {
              permissions: ['certifications:certify'],
              scope: { global: {}, club: null },
            },
          },
        },
      });

      await controller.certify(adminRequest as any, ENROLLMENT_ID);

      expect(service.certify).toHaveBeenCalledWith(
        { userId: REVIEWER_ID, localFieldId: undefined, globalAccess: true },
        ENROLLMENT_ID,
      );
    });
  });

  describe('reviewer endpoints', () => {
    it('getFinalTray delegates to the service', async () => {
      service.getFinalTray.mockResolvedValue([{ enrollment_id: ENROLLMENT_ID }]);

      const result = await controller.getFinalTray(buildRequest() as any);

      expect(result).toEqual({
        status: 'success',
        data: [{ enrollment_id: ENROLLMENT_ID }],
      });
    });

    it('approveCloseoutEvidence delegates to the service', async () => {
      service.approveCloseoutEvidence.mockResolvedValue({
        enrollment_id: ENROLLMENT_ID,
        status: 'APPROVED',
      });

      const result = await controller.approveCloseoutEvidence(
        buildRequest() as any,
        ENROLLMENT_ID,
      );

      expect(service.approveCloseoutEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        ENROLLMENT_ID,
      );
      expect(result).toEqual({
        status: 'success',
        data: { enrollment_id: ENROLLMENT_ID, status: 'APPROVED' },
      });
    });

    it('requestChanges delegates to the service with the mandatory comment', async () => {
      const dto = { comment: 'Falta la firma del director' };
      service.requestChanges.mockResolvedValue({
        enrollment_id: ENROLLMENT_ID,
        status: 'CHANGES_REQUESTED',
      });

      const result = await controller.requestChanges(
        buildRequest() as any,
        ENROLLMENT_ID,
        dto,
      );

      expect(service.requestChanges).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        ENROLLMENT_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { enrollment_id: ENROLLMENT_ID, status: 'CHANGES_REQUESTED' },
      });
    });

    it('certify delegates to the service', async () => {
      service.certify.mockResolvedValue({
        enrollment_id: ENROLLMENT_ID,
        status: 'CERTIFIED',
        already_certified: false,
      });

      const result = await controller.certify(
        buildRequest() as any,
        ENROLLMENT_ID,
      );

      expect(service.certify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        ENROLLMENT_ID,
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          enrollment_id: ENROLLMENT_ID,
          status: 'CERTIFIED',
          already_certified: false,
        },
      });
    });
  });
});
