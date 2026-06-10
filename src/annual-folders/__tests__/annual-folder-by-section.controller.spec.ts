import { AnnualFolderBySectionController } from '../annual-folder-by-section.controller';
import { AppNotFoundException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

describe('AnnualFolderBySectionController', () => {
  const enrollmentId = '621ea0d0-4779-4a06-98eb-25e13b1af398';

  const annualFoldersService = {
    getFolderByEnrollment: jest.fn(),
  };

  const clubEnrollmentsService = {
    findCurrentBySectionId: jest.fn(),
  };

  const catalogsService = {
    getCurrentEcclesiasticalYear: jest.fn(),
  };

  let controller: AnnualFolderBySectionController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new AnnualFolderBySectionController(
      annualFoldersService as any,
      clubEnrollmentsService as any,
      catalogsService as any,
    );

    catalogsService.getCurrentEcclesiasticalYear.mockResolvedValue({
      ecclesiastical_year_id: 1,
      start_date: new Date('2026-01-01T00:00:00Z'),
      end_date: new Date('2026-12-31T00:00:00Z'),
      active: true,
    });
    clubEnrollmentsService.findCurrentBySectionId.mockResolvedValue({
      club_enrollment_id: enrollmentId,
      club_section_id: 2,
      ecclesiastical_year_id: 1,
      status: 'active',
    });
  });

  it('returns data null when the current enrollment exists but the annual evidence folder has not been created yet', async () => {
    annualFoldersService.getFolderByEnrollment.mockRejectedValue(
      new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: enrollmentId,
      }),
    );

    await expect(
      controller.getFolderBySection(2, { sub: 'user-1' }),
    ).resolves.toEqual({
      status: 'success',
      data: null,
    });
    expect(annualFoldersService.getFolderByEnrollment).toHaveBeenCalledWith(
      enrollmentId,
      'user-1',
    );
  });
});
