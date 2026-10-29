import { PostRegistrationRowService } from './post-registration-row.service';

describe('PostRegistrationRowService', () => {
  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';

  const freshRow = {
    user_pr_id: 1,
    user_id: userId,
    complete: false,
    profile_picture_complete: false,
    personal_info_complete: false,
    club_selection_complete: false,
    date_completed: null,
    active_club_assignment_id: null,
  };

  /** In-memory users_pr that honours ON CONFLICT DO NOTHING semantics. */
  const createFakeDb = (opts: { userActive?: boolean | null } = {}) => {
    const rows = new Map<string, typeof freshRow>();
    const userActive = opts.userActive === undefined ? true : opts.userActive;
    return {
      rows,
      users: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            userActive === null ? null : { active: userActive },
          ),
      },
      users_pr: {
        findUnique: jest.fn(({ where }: { where: { user_id: string } }) =>
          Promise.resolve(rows.get(where.user_id) ?? null),
        ),
        createMany: jest.fn(
          ({ data }: { data: Array<{ user_id: string }> }) => {
            let count = 0;
            for (const d of data) {
              if (!rows.has(d.user_id)) {
                rows.set(d.user_id, { ...freshRow, user_id: d.user_id });
                count += 1;
              }
            }
            return Promise.resolve({ count });
          },
        ),
      },
    };
  };

  const build = (db: ReturnType<typeof createFakeDb>) =>
    new PostRegistrationRowService(db as never);

  it('creates the row with every flag false when it is missing', async () => {
    const db = createFakeDb();

    const row = await build(db).ensure(userId);

    expect(row).toMatchObject({
      user_id: userId,
      complete: false,
      profile_picture_complete: false,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    });
    expect(db.users_pr.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ user_id: userId, complete: false })],
      skipDuplicates: true,
    });
  });

  it('is idempotent: two calls leave exactly one row and one insert', async () => {
    const db = createFakeDb();
    const service = build(db);

    const first = await service.ensure(userId);
    const second = await service.ensure(userId);

    expect(second).toEqual(first);
    expect(db.rows.size).toBe(1);
    expect(db.users_pr.createMany).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing row untouched (no user lookup, no insert)', async () => {
    const db = createFakeDb();
    const existing = {
      ...freshRow,
      complete: true,
      club_selection_complete: true,
    };
    db.rows.set(userId, existing);

    const row = await build(db).ensure(userId);

    expect(row).toBe(existing);
    expect(db.users.findUnique).not.toHaveBeenCalled();
    expect(db.users_pr.createMany).not.toHaveBeenCalled();
  });

  it('survives a concurrent initialiser: the losing insert is a no-op, not an error', async () => {
    const db = createFakeDb();
    // Both callers miss the row on their first read; the other one inserts
    // between our read and our insert (ON CONFLICT DO NOTHING -> count 0).
    db.users_pr.findUnique
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockImplementation(({ where }) =>
        Promise.resolve(db.rows.get(where.user_id) ?? null),
      );
    db.users_pr.createMany.mockImplementationOnce(() => {
      db.rows.set(userId, { ...freshRow, profile_picture_complete: true });
      return Promise.resolve({ count: 0 });
    });

    const row = await build(db).ensure(userId);

    expect(row).toMatchObject({
      user_id: userId,
      profile_picture_complete: true,
    });
    expect(db.rows.size).toBe(1);
  });

  it('returns null (and inserts nothing) for a missing user', async () => {
    const db = createFakeDb({ userActive: null });

    await expect(build(db).ensure(userId)).resolves.toBeNull();
    expect(db.users_pr.createMany).not.toHaveBeenCalled();
  });

  it('returns null (and inserts nothing) for a deactivated / soft-deleted user', async () => {
    const db = createFakeDb({ userActive: false });

    await expect(build(db).ensure(userId)).resolves.toBeNull();
    expect(db.users_pr.createMany).not.toHaveBeenCalled();
  });

  it('uses the transaction client it is given instead of the default one', async () => {
    const defaultDb = createFakeDb();
    const txDb = createFakeDb();

    await build(defaultDb).ensure(userId, txDb as never);

    expect(txDb.users_pr.createMany).toHaveBeenCalledTimes(1);
    expect(defaultDb.users_pr.findUnique).not.toHaveBeenCalled();
    expect(defaultDb.users_pr.createMany).not.toHaveBeenCalled();
  });
});
