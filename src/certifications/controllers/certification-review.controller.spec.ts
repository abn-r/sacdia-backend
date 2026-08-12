import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CertificationReviewController } from './certification-review.controller';
import { CertificationReviewService } from '../review/certification-review.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { ErrorCode } from '../../common/errors/error-codes';

const REVIEWER_ID = 'reviewer-uuid-001';
const LOCAL_FIELD_ID = 10;
const PROGRESS_ID = 1000;

const makeServiceMock = () => ({
  getTray: jest.fn(),
  getDetail: jest.fn(),
  approve: jest.fn(),
  requestChanges: jest.fn(),
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

describe('CertificationReviewController', () => {
  let controller: CertificationReviewController;
  let service: ReturnType<typeof makeServiceMock>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificationReviewController],
      providers: [
        { provide: CertificationReviewService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CertificationReviewController);
    reflector = new Reflector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authorization metadata', () => {
    it('the controller requires the certifications:review permission with global scope', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        CertificationReviewController,
      );
      expect(metadata).toEqual({ type: 'global' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        CertificationReviewController,
      );
      expect(permissions.permissions).toContain('certifications:review');
    });
  });

  describe('actor resolution', () => {
    it('missing authorizationProfile → GUARD_USER_NOT_AUTHENTICATED', async () => {
      await expect(
        controller.getTray({ user: { sub: REVIEWER_ID } } as any),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_USER_NOT_AUTHENTICATED });
    });

    it('resolves localFieldId from the effective global scope for a local-field reviewer', async () => {
      service.getTray.mockResolvedValue([]);

      await controller.getTray(buildRequest() as any);

      expect(service.getTray).toHaveBeenCalledWith(
        {
          userId: REVIEWER_ID,
          localFieldId: LOCAL_FIELD_ID,
          globalAccess: false,
        },
        { status: undefined },
      );
    });

    it('grants globalAccess to admin/super-admin without a local_field scope', async () => {
      service.getTray.mockResolvedValue([]);

      const adminRequest = buildRequest({
        authorizationProfile: {
          authorization: {
            grants: {
              global_roles: [{ role_name: 'admin', permissions: [], scope: {} }],
            },
            effective: {
              permissions: ['certifications:review'],
              scope: { global: {}, club: null },
            },
          },
        },
      });

      await controller.getTray(adminRequest as any);

      expect(service.getTray).toHaveBeenCalledWith(
        { userId: REVIEWER_ID, localFieldId: undefined, globalAccess: true },
        { status: undefined },
      );
    });
  });

  describe('handler delegation', () => {
    it('getTray delegates to the service with the status query param', async () => {
      service.getTray.mockResolvedValue([{ progress_id: PROGRESS_ID }]);

      const result = await controller.getTray(
        buildRequest() as any,
        'SUBMITTED',
      );

      expect(service.getTray).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        { status: 'SUBMITTED' },
      );
      expect(result).toEqual({
        status: 'success',
        data: [{ progress_id: PROGRESS_ID }],
      });
    });

    it('getDetail delegates to the service', async () => {
      service.getDetail.mockResolvedValue({ progress_id: PROGRESS_ID });

      const result = await controller.getDetail(
        buildRequest() as any,
        PROGRESS_ID,
      );

      expect(service.getDetail).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        PROGRESS_ID,
      );
      expect(result).toEqual({
        status: 'success',
        data: { progress_id: PROGRESS_ID },
      });
    });

    it('approve delegates to the service', async () => {
      const dto = { lock_version: 0 };
      service.approve.mockResolvedValue({
        progress_id: PROGRESS_ID,
        status: 'APPROVED',
      });

      const result = await controller.approve(
        buildRequest() as any,
        PROGRESS_ID,
        dto,
      );

      expect(service.approve).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        PROGRESS_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { progress_id: PROGRESS_ID, status: 'APPROVED' },
      });
    });

    it('requestChanges delegates to the service', async () => {
      const dto = { lock_version: 0, comment: 'Falta evidencia' };
      service.requestChanges.mockResolvedValue({
        progress_id: PROGRESS_ID,
        status: 'CHANGES_REQUESTED',
      });

      const result = await controller.requestChanges(
        buildRequest() as any,
        PROGRESS_ID,
        dto,
      );

      expect(service.requestChanges).toHaveBeenCalledWith(
        expect.objectContaining({ userId: REVIEWER_ID }),
        PROGRESS_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { progress_id: PROGRESS_ID, status: 'CHANGES_REQUESTED' },
      });
    });
  });
});
