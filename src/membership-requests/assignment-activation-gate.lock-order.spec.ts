import { lockDependentsAscending } from '../guardianships/guardianship-queries';
import { lockActivationDependentsAscending } from './assignment-activation-gate';

const PREFIX = 'guardianships:dependent:';

function makeTx(dependents: string[] = []) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    dependent_profiles: {
      findMany: jest.fn((args: { where: { user_id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.user_id.in
            .filter((id) => dependents.includes(id))
            .map((id) => ({ user_id: id })),
        ),
      ),
    },
  };
}

function lockedIds(tx: ReturnType<typeof makeTx>): string[] {
  return tx.$executeRaw.mock.calls.map((call) =>
    String((call as unknown[])[1]).slice(PREFIX.length),
  );
}

describe('lockDependentsAscending', () => {
  it('locks each id once, in ascending order, whatever the input order', async () => {
    const tx = makeTx();

    const locked = await lockDependentsAscending(tx as never, [
      'dep-c',
      'dep-a',
      'dep-b',
      'dep-a',
    ]);

    expect(locked).toEqual(['dep-a', 'dep-b', 'dep-c']);
    expect(lockedIds(tx)).toEqual(['dep-a', 'dep-b', 'dep-c']);
  });

  it('takes no lock for an empty input', async () => {
    const tx = makeTx();
    await lockDependentsAscending(tx as never, []);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('lockActivationDependentsAscending', () => {
  it('locks only the users that are dependents, ascending', async () => {
    const tx = makeTx(['dep-z', 'dep-b']);

    const locked = await lockActivationDependentsAscending(tx as never, [
      'dep-z',
      'adult-1',
      'dep-b',
    ]);

    expect(locked).toEqual(['dep-b', 'dep-z']);
    expect(lockedIds(tx)).toEqual(['dep-b', 'dep-z']);
  });

  it('does not even query for an empty input', async () => {
    const tx = makeTx();
    await lockActivationDependentsAscending(tx as never, []);
    expect(tx.dependent_profiles.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
