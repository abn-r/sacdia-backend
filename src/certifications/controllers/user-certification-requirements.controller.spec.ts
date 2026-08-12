import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserCertificationRequirementsController } from './user-certification-requirements.controller';
import { CertificationRequirementsService } from '../requirements/certification-requirements.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';

const USER_ID = 'user-uuid-001';
const CERT_ID = 1;
const SECTION_ID = 100;

const makeServiceMock = () => ({
  getRequirement: jest.fn(),
  saveDraft: jest.fn(),
  submitRequirement: jest.fn(),
});

describe('UserCertificationRequirementsController', () => {
  let controller: UserCertificationRequirementsController;
  let service: ReturnType<typeof makeServiceMock>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserCertificationRequirementsController],
      providers: [
        { provide: CertificationRequirementsService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UserCertificationRequirementsController);
    reflector = new Reflector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authorization metadata', () => {
    it('getRequirement is owner-scoped to the userId param', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.getRequirement,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.getRequirement,
      );
      expect(permissions.permissions).toContain('user_certifications:read');
    });

    it('saveDraft is owner-scoped to the userId param and requires manage permission', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.saveDraft,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(PERMISSIONS_KEY, controller.saveDraft);
      expect(permissions.permissions).toContain('user_certifications:manage');
    });

    it('submitRequirement is owner-scoped to the userId param and requires manage permission', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.submitRequirement,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.submitRequirement,
      );
      expect(permissions.permissions).toContain('user_certifications:manage');
    });
  });

  describe('handler delegation', () => {
    it('getRequirement delegates to the service', async () => {
      service.getRequirement.mockResolvedValue({ section_id: SECTION_ID });

      const result = await controller.getRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
      );

      expect(service.getRequirement).toHaveBeenCalledWith(
        USER_ID,
        CERT_ID,
        SECTION_ID,
      );
      expect(result).toEqual({
        status: 'success',
        data: { section_id: SECTION_ID },
      });
    });

    it('saveDraft delegates to the service', async () => {
      const dto = { responses: [{ component_id: 1, text_value: 'x' }] };
      service.saveDraft.mockResolvedValue({ section_id: SECTION_ID });

      const result = await controller.saveDraft(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );

      expect(service.saveDraft).toHaveBeenCalledWith(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { section_id: SECTION_ID },
      });
    });

    it('submitRequirement delegates to the service', async () => {
      const dto = { lock_version: 0 };
      service.submitRequirement.mockResolvedValue({
        requirement: { section_id: SECTION_ID, status: 'SUBMITTED' },
        progress_summary: { percentComplete: 0 },
      });

      const result = await controller.submitRequirement(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );

      expect(service.submitRequirement).toHaveBeenCalledWith(
        USER_ID,
        CERT_ID,
        SECTION_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          requirement: { section_id: SECTION_ID, status: 'SUBMITTED' },
          progress_summary: { percentComplete: 0 },
        },
      });
    });
  });
});
