import { buildCronRunLockHarness } from '../common/services/cron-run-lock.testing';
import { InvestitureAchievementIntentReconciler } from './investiture-achievement-intent.reconciler';

describe('investiture achievement intent reconciler', () => {
  it('delivers confirmed intents on startup without resolving a request', async () => {
    const requests = {
      reconcileConfirmedAchievementIntents: jest.fn(async () => 1),
      resolve: jest.fn(),
    };
    const reconciler = new InvestitureAchievementIntentReconciler(
      requests as never,
      buildCronRunLockHarness().runLock,
    );

    await reconciler.onModuleInit();

    expect(requests.reconcileConfirmedAchievementIntents).toHaveBeenCalledTimes(
      1,
    );
    expect(requests.resolve).not.toHaveBeenCalled();
  });
});
