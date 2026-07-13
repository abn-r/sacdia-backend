import { UserClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators';

describe('UserClassesController', () => {
  const classesService = {
    getEnrollments: jest.fn(),
    enrollUser: jest.fn(),
    getUserProgress: jest.fn(),
    updateSectionProgress: jest.fn(),
    submitSection: jest.fn(),
    uploadSectionFile: jest.fn(),
    deleteSectionFile: jest.fn(),
  };

  let controller: UserClassesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UserClassesController(
      classesService as unknown as ClassesService,
    );
  });

  it('passes target user and actor separately when reading class progress', async () => {
    classesService.getUserProgress.mockResolvedValue({ modules: [] });

    await expect(
      (controller as any).getProgress(
        '22222222-2222-2222-2222-222222222222',
        7,
        901,
        { sub: '11111111-1111-1111-1111-111111111111' },
      ),
    ).resolves.toEqual({ modules: [] });

    expect(classesService.getUserProgress).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      7,
      901,
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('marks progress endpoints as active-assignment resources so club role permissions reach class progress access checks', () => {
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserClassesController.prototype.getProgress,
      ),
    ).toEqual({ type: 'active_assignment' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserClassesController.prototype.updateProgress,
      ),
    ).toEqual({ type: 'active_assignment', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserClassesController.prototype.submitSection,
      ),
    ).toEqual({ type: 'active_assignment', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserClassesController.prototype.uploadSectionFile,
      ),
    ).toEqual({ type: 'active_assignment', ownerParam: 'userId' });
    expect(
      Reflect.getMetadata(
        AUTHORIZATION_RESOURCE_KEY,
        UserClassesController.prototype.deleteSectionFile,
      ),
    ).toEqual({ type: 'active_assignment', ownerParam: 'userId' });
  });

  it('passes target user and actor separately when uploading class evidence', async () => {
    classesService.uploadSectionFile.mockResolvedValue({ file_id: 55 });
    const file = {
      buffer: Buffer.from('pdf'),
      mimetype: 'application/pdf',
      originalname: 'evidence.pdf',
    } as Express.Multer.File;

    await expect(
      controller.uploadSectionFile(
        '22222222-2222-2222-2222-222222222222',
        7,
        101,
        file,
        901,
        { sub: '11111111-1111-1111-1111-111111111111' },
      ),
    ).resolves.toEqual({ status: 'success', data: { file_id: 55 } });

    expect(classesService.uploadSectionFile).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111',
      7,
      101,
      file,
      901,
    );
  });

  it('passes target user and actor separately when submitting class section evidence', async () => {
    classesService.submitSection.mockResolvedValue({ section_id: 101 });

    await expect(
      controller.submitSection(
        '22222222-2222-2222-2222-222222222222',
        7,
        101,
        901,
        { sub: '11111111-1111-1111-1111-111111111111' },
      ),
    ).resolves.toEqual({ status: 'success', data: { section_id: 101 } });

    expect(classesService.submitSection).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111',
      7,
      101,
      901,
    );
  });

  it('passes target user and actor separately when deleting class evidence', async () => {
    classesService.deleteSectionFile.mockResolvedValue({ file_id: 55 });

    await expect(
      controller.deleteSectionFile(
        '22222222-2222-2222-2222-222222222222',
        7,
        101,
        55,
        901,
        { sub: '11111111-1111-1111-1111-111111111111' },
      ),
    ).resolves.toEqual({ status: 'success', data: { file_id: 55 } });

    expect(classesService.deleteSectionFile).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111',
      7,
      101,
      55,
      901,
    );
  });
});
