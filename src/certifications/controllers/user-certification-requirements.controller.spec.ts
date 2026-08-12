import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { UserCertificationRequirementsController } from './user-certification-requirements.controller';
import { CertificationRequirementsService } from '../requirements/certification-requirements.service';
import { CertificationEvidenceService } from '../evidence/certification-evidence.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';

const USER_ID = 'user-uuid-001';
const ENROLLMENT_ID = 42;
const SECTION_ID = 100;
const EVIDENCE_ID = 5000;

const ENROLLMENT_BASE =
  'users/:userId/certification-enrollments/:enrollmentId';

const makeServiceMock = () => ({
  getRequirement: jest.fn(),
  saveDraft: jest.fn(),
  submitRequirement: jest.fn(),
});

const makeEvidenceServiceMock = () => ({
  presign: jest.fn(),
  confirm: jest.fn(),
  delete: jest.fn(),
});

describe('UserCertificationRequirementsController', () => {
  let controller: UserCertificationRequirementsController;
  let service: ReturnType<typeof makeServiceMock>;
  let evidenceService: ReturnType<typeof makeEvidenceServiceMock>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = makeServiceMock();
    evidenceService = makeEvidenceServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserCertificationRequirementsController],
      providers: [
        { provide: CertificationRequirementsService, useValue: service },
        { provide: CertificationEvidenceService, useValue: evidenceService },
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

  describe('route contract (plan base — enrollmentId paths)', () => {
    const routeOf = (handler: unknown) =>
      Reflect.getMetadata(PATH_METADATA, handler as object);
    const methodOf = (handler: unknown) =>
      Reflect.getMetadata(METHOD_METADATA, handler as object);

    it('getRequirement is GET .../certification-enrollments/:enrollmentId/requirements/:requirementId', () => {
      expect(routeOf(controller.getRequirement)).toBe(
        `${ENROLLMENT_BASE}/requirements/:requirementId`,
      );
      expect(methodOf(controller.getRequirement)).toBe(RequestMethod.GET);
    });

    it('saveDraft is PATCH .../requirements/:requirementId/draft', () => {
      expect(routeOf(controller.saveDraft)).toBe(
        `${ENROLLMENT_BASE}/requirements/:requirementId/draft`,
      );
      expect(methodOf(controller.saveDraft)).toBe(RequestMethod.PATCH);
    });

    it('submitRequirement is POST .../requirements/:requirementId/submit', () => {
      expect(routeOf(controller.submitRequirement)).toBe(
        `${ENROLLMENT_BASE}/requirements/:requirementId/submit`,
      );
      expect(methodOf(controller.submitRequirement)).toBe(RequestMethod.POST);
    });

    it('presignEvidence is POST .../requirements/:requirementId/evidences/presign', () => {
      expect(routeOf(controller.presignEvidence)).toBe(
        `${ENROLLMENT_BASE}/requirements/:requirementId/evidences/presign`,
      );
      expect(methodOf(controller.presignEvidence)).toBe(RequestMethod.POST);
    });

    it('confirmEvidence is POST .../requirements/:requirementId/evidences/confirm', () => {
      expect(routeOf(controller.confirmEvidence)).toBe(
        `${ENROLLMENT_BASE}/requirements/:requirementId/evidences/confirm`,
      );
      expect(methodOf(controller.confirmEvidence)).toBe(RequestMethod.POST);
    });

    it('deleteEvidence is DELETE .../certification-enrollments/:enrollmentId/evidences/:evidenceId', () => {
      expect(routeOf(controller.deleteEvidence)).toBe(
        `${ENROLLMENT_BASE}/evidences/:evidenceId`,
      );
      expect(methodOf(controller.deleteEvidence)).toBe(RequestMethod.DELETE);
    });
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

    it('presignEvidence is owner-scoped to the userId param and requires manage permission', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.presignEvidence,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.presignEvidence,
      );
      expect(permissions.permissions).toContain('user_certifications:manage');
    });

    it('confirmEvidence is owner-scoped to the userId param and requires manage permission', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.confirmEvidence,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.confirmEvidence,
      );
      expect(permissions.permissions).toContain('user_certifications:manage');
    });

    it('deleteEvidence is owner-scoped to the userId param and requires manage permission', () => {
      const metadata = reflector.get(
        AUTHORIZATION_RESOURCE_KEY,
        controller.deleteEvidence,
      );
      expect(metadata).toEqual({ type: 'user', ownerParam: 'userId' });
      const permissions = reflector.get(
        PERMISSIONS_KEY,
        controller.deleteEvidence,
      );
      expect(permissions.permissions).toContain('user_certifications:manage');
    });
  });

  describe('handler delegation', () => {
    it('getRequirement delegates to the service', async () => {
      service.getRequirement.mockResolvedValue({ section_id: SECTION_ID });

      const result = await controller.getRequirement(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
      );

      expect(service.getRequirement).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
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
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );

      expect(service.saveDraft).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
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
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );

      expect(service.submitRequirement).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
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

    it('presignEvidence delegates to the evidence service', async () => {
      const dto = {
        component_id: 1,
        file_name: 'a.pdf',
        mime_type: 'application/pdf',
        file_size: 100,
      };
      evidenceService.presign.mockResolvedValue({ evidence_id: EVIDENCE_ID });

      const result = await controller.presignEvidence(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );

      expect(evidenceService.presign).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { evidence_id: EVIDENCE_ID },
      });
    });

    it('confirmEvidence delegates to the evidence service', async () => {
      const dto = { evidence_id: EVIDENCE_ID };
      evidenceService.confirm.mockResolvedValue({
        evidence_id: EVIDENCE_ID,
        upload_status: 'CONFIRMED',
      });

      const result = await controller.confirmEvidence(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );

      expect(evidenceService.confirm).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
        SECTION_ID,
        dto,
      );
      expect(result).toEqual({
        status: 'success',
        data: { evidence_id: EVIDENCE_ID, upload_status: 'CONFIRMED' },
      });
    });

    it('deleteEvidence delegates to the evidence service', async () => {
      evidenceService.delete.mockResolvedValue({
        message: 'Evidencia eliminada correctamente',
      });

      const result = await controller.deleteEvidence(
        USER_ID,
        ENROLLMENT_ID,
        EVIDENCE_ID,
      );

      expect(evidenceService.delete).toHaveBeenCalledWith(
        USER_ID,
        ENROLLMENT_ID,
        EVIDENCE_ID,
      );
      expect(result).toEqual({
        status: 'success',
        data: { message: 'Evidencia eliminada correctamente' },
      });
    });
  });
});
