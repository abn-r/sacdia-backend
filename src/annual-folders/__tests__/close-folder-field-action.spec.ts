import 'reflect-metadata';
import { EvaluationController } from '../evaluation.controller';
import { AnnualFoldersController } from '../annual-folders.controller';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Closing an annual folder is a field action (decision 2026-11-02): it needs
 * `annual_folders:evaluate` and the folder's local field in the actor's
 * territory. Club roles (evidence_folders:update) cannot close their folder.
 */
describe('close annual folder (field action)', () => {
  const FOLDER_ID = '672e41df-8053-4efb-bfc2-8136352e2f0e';
  const user = { sub: 'actor-1' } as never;

  function build(assertImpl: () => Promise<void>) {
    const evaluationService = {
      assertFolderCloseAccess: jest.fn(assertImpl),
    };
    const annualFoldersService = {
      closeFolder: jest.fn().mockResolvedValue({ status: 'closed' }),
    };
    const controller = new EvaluationController(
      evaluationService as never,
      annualFoldersService as never,
    );
    return { controller, evaluationService, annualFoldersService };
  }

  it('checks the field territory before closing', async () => {
    const { controller, evaluationService, annualFoldersService } = build(() =>
      Promise.resolve(),
    );

    await expect(controller.closeFolder(FOLDER_ID, user)).resolves.toEqual({
      status: 'success',
      data: { status: 'closed' },
    });
    expect(evaluationService.assertFolderCloseAccess).toHaveBeenCalledWith(
      FOLDER_ID,
      'actor-1',
    );
    expect(annualFoldersService.closeFolder).toHaveBeenCalledWith(
      FOLDER_ID,
      'actor-1',
    );
  });

  it('does not close when the folder is outside the actor territory', async () => {
    const { controller, annualFoldersService } = build(() =>
      Promise.reject(
        new AppForbiddenException(
          ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
        ),
      ),
    );

    await expect(controller.closeFolder(FOLDER_ID, user)).rejects.toThrow(
      AppForbiddenException,
    );
    expect(annualFoldersService.closeFolder).not.toHaveBeenCalled();
  });

  it('requires annual_folders:evaluate on a global resource', () => {
    const handler = EvaluationController.prototype.closeFolder;
    const permissions = Reflect.getMetadataKeys(handler)
      .map((key) => Reflect.getMetadata(key, handler))
      .flat();
    expect(JSON.stringify(permissions)).toContain('annual_folders:evaluate');
    expect(JSON.stringify(permissions)).not.toContain(
      'evidence_folders:update',
    );
  });

  it('is no longer served by the club-facing folders controller', () => {
    expect(
      (AnnualFoldersController.prototype as unknown as Record<string, unknown>)
        .closeFolder,
    ).toBeUndefined();
  });
});
