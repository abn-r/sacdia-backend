import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AdminCertificationsController } from './admin-certifications.controller';
import { CertificationDefinitionsService } from '../definitions/certification-definitions.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';

const ACTOR_ID = 'actor-uuid';

const makeServiceMock = () => ({
  createCertification: jest.fn(),
  createDraftVersion: jest.fn(),
  cloneVersion: jest.fn(),
  updateVersionMetadata: jest.fn(),
  replaceEligibilityRules: jest.fn(),
  replaceModulesTree: jest.fn(),
  publishVersion: jest.fn(),
  retireVersion: jest.fn(),
});

describe('AdminCertificationsController', () => {
  let controller: AdminCertificationsController;
  let service: ReturnType<typeof makeServiceMock>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCertificationsController],
      providers: [
        { provide: CertificationDefinitionsService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminCertificationsController);
    reflector = new Reflector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is scoped to the global authorization resource', () => {
    const metadata = reflector.get(
      AUTHORIZATION_RESOURCE_KEY,
      AdminCertificationsController,
    );
    expect(metadata).toEqual({ type: 'global' });
  });

  describe('permission metadata', () => {
    it('requires certifications:configure to create a certification', () => {
      const metadata = reflector.get(
        PERMISSIONS_KEY,
        controller.createCertification,
      );
      expect(metadata).toEqual({
        permissions: ['certifications:configure'],
        mode: 'all',
      });
    });

    it('requires certifications:configure to create a draft version', () => {
      const metadata = reflector.get(
        PERMISSIONS_KEY,
        controller.createDraftVersion,
      );
      expect(metadata.permissions).toContain('certifications:configure');
    });

    it('requires certifications:configure to clone a version', () => {
      const metadata = reflector.get(PERMISSIONS_KEY, controller.cloneVersion);
      expect(metadata.permissions).toContain('certifications:configure');
    });

    it('requires certifications:configure to update version metadata', () => {
      const metadata = reflector.get(
        PERMISSIONS_KEY,
        controller.updateVersionMetadata,
      );
      expect(metadata.permissions).toContain('certifications:configure');
    });

    it('requires certifications:configure to replace eligibility rules', () => {
      const metadata = reflector.get(
        PERMISSIONS_KEY,
        controller.replaceEligibilityRules,
      );
      expect(metadata.permissions).toContain('certifications:configure');
    });

    it('requires certifications:configure to replace the tree', () => {
      const metadata = reflector.get(PERMISSIONS_KEY, controller.replaceTree);
      expect(metadata.permissions).toContain('certifications:configure');
    });

    it('requires certifications:publish to publish a version', () => {
      const metadata = reflector.get(
        PERMISSIONS_KEY,
        controller.publishVersion,
      );
      expect(metadata.permissions).toContain('certifications:publish');
    });

    it('requires certifications:publish to retire a version', () => {
      const metadata = reflector.get(PERMISSIONS_KEY, controller.retireVersion);
      expect(metadata.permissions).toContain('certifications:publish');
    });
  });

  describe('handler delegation', () => {
    it('createCertification delegates to the service', async () => {
      service.createCertification.mockResolvedValue({ certification_id: 1 });

      const result = await controller.createCertification({
        name: 'Guía Mayor',
        description: 'desc',
      });

      expect(service.createCertification).toHaveBeenCalledWith(
        'Guía Mayor',
        'desc',
      );
      expect(result).toEqual({ certification_id: 1 });
    });

    it('createDraftVersion delegates to the service', async () => {
      service.createDraftVersion.mockResolvedValue({
        certification_version_id: 2,
      });

      const result = await controller.createDraftVersion(1);

      expect(service.createDraftVersion).toHaveBeenCalledWith(1);
      expect(result).toEqual({ certification_version_id: 2 });
    });

    it('cloneVersion delegates to the service', async () => {
      service.cloneVersion.mockResolvedValue({ certification_version_id: 3 });

      await controller.cloneVersion(1, 2);

      expect(service.cloneVersion).toHaveBeenCalledWith(1, 2);
    });

    it('updateVersionMetadata delegates to the service', async () => {
      const dto = { title: 'New title' };
      await controller.updateVersionMetadata(1, 2, dto);

      expect(service.updateVersionMetadata).toHaveBeenCalledWith(1, 2, dto);
    });

    it('replaceEligibilityRules delegates to the service', async () => {
      const dto = { rules: [{ rule_type: 'BAPTIZED' as const }] };
      await controller.replaceEligibilityRules(1, 2, dto);

      expect(service.replaceEligibilityRules).toHaveBeenCalledWith(
        1,
        2,
        dto.rules,
      );
    });

    it('replaceTree delegates to the service', async () => {
      const dto = { modules: [] };
      await controller.replaceTree(1, 2, dto);

      expect(service.replaceModulesTree).toHaveBeenCalledWith(
        1,
        2,
        dto.modules,
      );
    });

    it('publishVersion delegates to the service with the current user id', async () => {
      await controller.publishVersion(1, 2, { sub: ACTOR_ID });

      expect(service.publishVersion).toHaveBeenCalledWith(1, 2, ACTOR_ID);
    });

    it('retireVersion delegates to the service', async () => {
      await controller.retireVersion(1, 2);

      expect(service.retireVersion).toHaveBeenCalledWith(1, 2);
    });
  });
});
