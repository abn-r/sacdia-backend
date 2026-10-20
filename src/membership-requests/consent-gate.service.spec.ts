import { ConsentGateService } from './consent-gate.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('ConsentGateService', () => {
  const gate = new ConsentGateService();
  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';

  const ADULT_BIRTHDAY = new Date('1990-01-01T00:00:00.000Z');
  const yearsAgo = (years: number): Date => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - 3);
    return d;
  };
  /** A users row as the gate reads it. */
  const userRow = (
    id: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    user_id: id,
    birthday: ADULT_BIRTHDAY,
    country_id: null,
    dependent_profile: null,
    ...overrides,
  });
  const dependentRow = (id: string) =>
    userRow(id, {
      birthday: yearsAgo(9),
      dependent_profile: { user_id: id },
    });
  const teenRow = (id: string, years = 16) =>
    userRow(id, { birthday: yearsAgo(years) });

  const makeDb = () => ({
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    countries: {
      findUnique: jest.fn().mockResolvedValue({
        age_of_majority: 18,
        age_reference_timezone: 'America/Mexico_City',
      }),
    },
    guardianships: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  });
  type Db = ReturnType<typeof makeDb>;
  const asDb = (db: Db) => db as never;

  describe('assertApprovable', () => {
    it('lets an adult through without reading guardianships', async () => {
      const db = makeDb();
      db.users.findUnique.mockResolvedValue(userRow(userId));

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).resolves.toBeUndefined();
      expect(db.guardianships.findFirst).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('takes the per-dependent advisory lock BEFORE reading the consent (S2: serialized with verify/revoke)', async () => {
      const db = makeDb();
      const order: string[] = [];
      db.users.findUnique.mockResolvedValue(dependentRow(userId));
      db.$executeRaw.mockImplementation((sql: TemplateStringsArray, key) => {
        order.push(`lock:${sql.join('?')}:${String(key)}`);
        return Promise.resolve(1);
      });
      db.guardianships.findFirst.mockImplementation(() => {
        order.push('read');
        return Promise.resolve({ guardianship_id: 'g1' });
      });

      await gate.assertApprovable(asDb(db), userId);

      expect(order).toEqual([
        `lock:SELECT pg_advisory_xact_lock(hashtext(?)):guardianships:dependent:${userId}`,
        'read',
      ]);
    });

    it('lets a dependent with a verified, non-test row through (custodian rows count too)', async () => {
      const db = makeDb();
      db.users.findUnique.mockResolvedValue(dependentRow(userId));
      db.guardianships.findFirst.mockResolvedValue({ guardianship_id: 'g1' });

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).resolves.toBeUndefined();
      // No is_custodian filter: custody verified by another club member counts.
      expect(db.guardianships.findFirst).toHaveBeenCalledWith({
        where: {
          dependent_user_id: userId,
          consent_status: 'verified',
          is_test_data: false,
        },
        select: { guardianship_id: true },
      });
    });

    it('blocks a dependent without a verified row (pending, revoked or test-only) with 409', async () => {
      const db = makeDb();
      db.users.findUnique.mockResolvedValue(dependentRow(userId));
      db.guardianships.findFirst.mockResolvedValue(null);

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).rejects.toMatchObject({
        code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
        status: 409,
      });
    });

    it('blocks a self-registered 16-year-old (no dependent profile) without verified consent', async () => {
      const db = makeDb();
      db.users.findUnique.mockResolvedValue(teenRow(userId));
      db.guardianships.findFirst.mockResolvedValue(null);

      await expect(
        gate.assertApprovable(asDb(db), userId),
      ).rejects.toMatchObject({
        code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
        status: 409,
      });
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadDependentConsent', () => {
    it('returns an empty map without querying for no ids', async () => {
      const db = makeDb();

      await expect(gate.loadDependentConsent(asDb(db), [])).resolves.toEqual(
        new Map(),
      );
      expect(db.users.findMany).not.toHaveBeenCalled();
    });

    it('omits adults and skips the guardianship query when there are none', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([userRow(userId)]);

      const states = await gate.loadDependentConsent(asDb(db), [userId]);

      expect(states.size).toBe(0);
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('reports null while pending and the latest verified_at once verified', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([
        dependentRow('dep-pending'),
        dependentRow('dep-verified'),
        userRow(userId),
      ]);
      db.guardianships.findMany.mockResolvedValue([
        {
          dependent_user_id: 'dep-verified',
          verified_at: new Date('2026-10-01T00:00:00Z'),
        },
        {
          dependent_user_id: 'dep-verified',
          verified_at: new Date('2026-10-10T00:00:00Z'),
        },
      ]);

      const states = await gate.loadDependentConsent(asDb(db), [
        'dep-pending',
        'dep-verified',
        userId,
      ]);

      expect(states.get('dep-pending')).toEqual({ verifiedAt: null });
      expect(states.get('dep-verified')).toEqual({
        verifiedAt: new Date('2026-10-10T00:00:00Z'),
      });
      expect(states.has(userId)).toBe(false);
    });

    it('includes a self-registered teen (no profile) as pending, and a teen with a verified custody row as verified', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([
        teenRow('teen-open'),
        teenRow('teen-ok', 15),
        userRow('adult'),
      ]);
      db.guardianships.findMany.mockResolvedValue([
        {
          dependent_user_id: 'teen-ok',
          verified_at: new Date('2026-10-12T00:00:00Z'),
        },
      ]);

      const states = await gate.loadDependentConsent(asDb(db), [
        'teen-open',
        'teen-ok',
        'adult',
      ]);

      expect(states.get('teen-open')).toEqual({ verifiedAt: null });
      expect(states.get('teen-ok')).toEqual({
        verifiedAt: new Date('2026-10-12T00:00:00Z'),
      });
      expect(states.has('adult')).toBe(false);
    });
  });
  describe('loadConsentBlocks', () => {
    const dependentA = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const dependentB = 'bbbbbbbb-0000-4000-8000-00000000000b';
    const adult = 'cccccccc-0000-4000-8000-00000000000c';
    const VIEWER = 'dddddddd-0000-4000-8000-00000000000d';

    const row = (overrides: Record<string, unknown> = {}) => ({
      guardianship_id: 'g-1',
      dependent_user_id: dependentA,
      is_primary: true,
      is_custodian: false,
      consent_status: 'pending',
      external_name: null,
      relationship_type: { name: 'Madre' },
      guardian: { name: 'María', paternal_last_name: 'Pérez' },
      custodian_club: null,
      consent_evidences: [] as Array<{
        evidence_id: string;
        uploaded_by_user_id?: string;
      }>,
      dependent: {
        dependent_profile: { created_by_user_id: null as string | null },
      },
      ...overrides,
    });

    it('answers with null for adults and reads nothing more when nobody is a minor', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([userRow(adult)]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [adult], VIEWER);

      expect(blocks.size).toBe(0);
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('does not query at all for an empty page', async () => {
      const db = makeDb();

      expect((await gate.loadConsentBlocks(asDb(db), [], VIEWER)).size).toBe(0);
      expect(db.users.findMany).not.toHaveBeenCalled();
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    /**
     * The three guardianship reads of the block, told apart by their filter:
     * the page rows, the viewer's own live rows (test data counts) and the
     * hand-over rows (revoked with a custody trigger reason).
     */
    const routeGuardianships = (
      db: Db,
      routes: {
        page: unknown[];
        viewerOwn?: unknown[];
        handovers?: unknown[];
      },
    ) => {
      db.guardianships.findMany.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where.is_test_data === false) return Promise.resolve(routes.page);
          if (typeof where.guardian_user_id === 'string') {
            return Promise.resolve(routes.viewerOwn ?? []);
          }
          if (where.consent_status === 'revoked') {
            return Promise.resolve(routes.handovers ?? []);
          }
          throw new Error(`unexpected guardianships read ${String(where)}`);
        },
      );
    };

    it('builds the block of every dependent from a FIXED number of queries, however many requests', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([
        userRow(adult),
        dependentRow(dependentA),
        dependentRow(dependentB),
      ]);
      routeGuardianships(db, {
        page: [
          row({ consent_evidences: [{ evidence_id: 'e-1' }] }),
          row({
            guardianship_id: 'g-2',
            dependent_user_id: dependentB,
            consent_status: 'verified',
            guardian: { name: 'Luis', paternal_last_name: 'Gómez' },
            relationship_type: { name: 'Padre' },
          }),
        ],
      });

      const blocks = await gate.loadConsentBlocks(
        asDb(db),
        [adult, dependentA, dependentB],
        VIEWER,
      );

      expect(db.users.findMany).toHaveBeenCalledTimes(1);
      // page rows + the viewer's own rows (only dependentA has a form to verify)
      // and no hand-over read: nothing there is custody.
      expect(db.guardianships.findMany).toHaveBeenCalledTimes(2);
      expect(blocks.has(adult)).toBe(false);
      expect(blocks.get(dependentA)).toEqual({
        required: true,
        dependent: true,
        guardian_linked: true,
        guardianship_id: 'g-1',
        status: 'pending',
        evidence_uploaded: true,
        guardians: [
          {
            display_name: 'María Pérez',
            relationship_type_name: 'Madre',
            is_primary: true,
          },
        ],
        viewer_can_verify: true,
        viewer_verify_block: null,
      });
      expect(blocks.get(dependentB)).toMatchObject({
        guardianship_id: 'g-2',
        status: 'verified',
        evidence_uploaded: false,
      });
    });

    it('ignores seeded test data and revoked rows in the query', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([dependentRow(dependentA)]);
      db.guardianships.findMany.mockResolvedValue([]);

      await gate.loadConsentBlocks(asDb(db), [dependentA], VIEWER);

      expect(db.guardianships.findMany.mock.calls[0][0].where).toEqual({
        dependent_user_id: { in: [dependentA] },
        is_test_data: false,
        consent_status: { not: 'revoked' },
      });
    });

    it('a dependent with no real guardianship row is pending with no row to verify', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([dependentRow(dependentA)]);
      db.guardianships.findMany.mockResolvedValue([]);

      const blocks = await gate.loadConsentBlocks(
        asDb(db),
        [dependentA],
        VIEWER,
      );

      expect(blocks.get(dependentA)).toEqual({
        required: true,
        dependent: true,
        guardian_linked: false,
        guardianship_id: null,
        status: 'pending',
        evidence_uploaded: false,
        guardians: [],
        viewer_can_verify: false,
        viewer_verify_block: null,
      });
    });

    it('lists the primary first and names club custody and external holders', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([dependentRow(dependentA)]);
      db.guardianships.findMany.mockResolvedValue([
        row({
          guardianship_id: 'g-secondary',
          is_primary: false,
          guardian: { name: 'Ana', paternal_last_name: 'Ruiz' },
          relationship_type: { name: 'Tía' },
        }),
        row({
          guardianship_id: 'g-custody',
          is_primary: true,
          is_custodian: true,
          guardian: null,
          relationship_type: null,
          custodian_club: { name: 'Club Central' },
        }),
        row({
          guardianship_id: 'g-external',
          is_primary: false,
          guardian: null,
          external_name: 'Abuela Rosa',
          relationship_type: null,
        }),
      ]);

      const block = (
        await gate.loadConsentBlocks(asDb(db), [dependentA], VIEWER)
      ).get(dependentA);

      expect(block?.guardianship_id).toBe('g-custody');
      expect(block?.guardians).toEqual([
        {
          display_name: 'Club Central',
          relationship_type_name: null,
          is_primary: true,
        },
        {
          display_name: 'Ana Ruiz',
          relationship_type_name: 'Tía',
          is_primary: false,
        },
        {
          display_name: 'Abuela Rosa',
          relationship_type_name: null,
          is_primary: false,
        },
      ]);
    });

    it('a self-registered teen with no profile gets the "nobody linked" block and no guardianship query', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([teenRow(adult, 15)]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [adult], VIEWER);

      expect(blocks.get(adult)).toEqual({
        required: true,
        dependent: false,
        guardian_linked: false,
        guardianship_id: null,
        status: 'pending',
        evidence_uploaded: false,
        guardians: [],
        viewer_can_verify: false,
        viewer_verify_block: null,
      });
      expect(db.guardianships.findMany).not.toHaveBeenCalled();
    });

    it('a user without a birthday is a minor for the list too (fail closed)', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([userRow(adult, { birthday: null })]);

      const blocks = await gate.loadConsentBlocks(asDb(db), [adult], VIEWER);

      expect(blocks.get(adult)).toMatchObject({
        required: true,
        dependent: false,
        guardian_linked: false,
      });
    });

    it('guardian_linked is false when the only row is club custody, true with a user guardian', async () => {
      const db = makeDb();
      db.users.findMany.mockResolvedValue([
        dependentRow(dependentA),
        dependentRow(dependentB),
      ]);
      db.guardianships.findMany.mockResolvedValue([
        row({
          guardianship_id: 'g-custody',
          is_custodian: true,
          guardian: null,
          custodian_club: { name: 'Club Central' },
        }),
        row({ guardianship_id: 'g-parent', dependent_user_id: dependentB }),
      ]);

      const blocks = await gate.loadConsentBlocks(
        asDb(db),
        [dependentA, dependentB],
        VIEWER,
      );

      expect(blocks.get(dependentA)?.guardian_linked).toBe(false);
      expect(blocks.get(dependentB)?.guardian_linked).toBe(true);
    });

    describe('viewer verdict (viewer_can_verify / viewer_verify_block)', () => {
      const CREATOR = 'eeeeeeee-0000-4000-8000-00000000000e';
      const UPLOADER = 'ffffffff-0000-4000-8000-00000000000f';
      const HANDER = '11111111-0000-4000-8000-000000000011';
      const withForm = (uploader: string) => [
        { evidence_id: 'e-1', uploaded_by_user_id: uploader },
      ];
      const custodyRow = (overrides: Record<string, unknown> = {}) =>
        row({
          is_custodian: true,
          guardian: null,
          custodian_club: { name: 'Club Central' },
          consent_evidences: withForm(UPLOADER),
          dependent: { dependent_profile: { created_by_user_id: CREATOR } },
          ...overrides,
        });
      const verdictOf = async (
        viewer: string,
        routes: Parameters<typeof routeGuardianships>[1],
      ) => {
        const db = makeDb();
        db.users.findMany.mockResolvedValue([dependentRow(dependentA)]);
        routeGuardianships(db, routes);
        const block = (
          await gate.loadConsentBlocks(asDb(db), [dependentA], viewer)
        ).get(dependentA);
        return {
          db,
          can: block?.viewer_can_verify,
          why: block?.viewer_verify_block,
          block,
        };
      };

      it('the CREATOR of a director-created minor cannot verify: false / self_custodian', async () => {
        const v = await verdictOf(CREATOR, { page: [custodyRow()] });
        expect([v.can, v.why]).toEqual([false, 'self_custodian']);
      });

      it('the UPLOADER of the current form cannot verify: false / self_custodian', async () => {
        const v = await verdictOf(UPLOADER, { page: [custodyRow()] });
        expect([v.can, v.why]).toEqual([false, 'self_custodian']);
      });

      it('the guardian who handed the child over (latest hand-over only) cannot verify: false / self_custodian', async () => {
        const handovers = [
          { dependent_user_id: dependentA, guardian_user_id: HANDER },
          { dependent_user_id: dependentA, guardian_user_id: 'older-handover' },
        ];
        const v = await verdictOf(HANDER, { page: [custodyRow()], handovers });
        expect([v.can, v.why]).toEqual([false, 'self_custodian']);
        // verify-consent bars only the most recent hand-over (orderBy desc, first)
        const older = await verdictOf('older-handover', {
          page: [custodyRow()],
          handovers,
        });
        expect([older.can, older.why]).toEqual([true, null]);
      });

      it('a LIVE guardian of the child cannot verify: false / self_guardian (custody or not, test-data rows count)', async () => {
        const viewerOwn = [{ dependent_user_id: dependentA }];
        const onGuardianRow = await verdictOf(VIEWER, {
          page: [row({ consent_evidences: withForm(UPLOADER) })],
          viewerOwn,
        });
        expect([onGuardianRow.can, onGuardianRow.why]).toEqual([
          false,
          'self_guardian',
        ]);
        const onCustodyRow = await verdictOf(VIEWER, {
          page: [custodyRow()],
          viewerOwn,
        });
        expect([onCustodyRow.can, onCustodyRow.why]).toEqual([
          false,
          'self_guardian',
        ]);
      });

      it('an independent secretary can verify: true / null', async () => {
        const v = await verdictOf(VIEWER, { page: [custodyRow()] });
        expect([v.can, v.why]).toEqual([true, null]);
      });

      it('the custody list does not apply to a guardian-managed row (creator may verify a parent consent)', async () => {
        const v = await verdictOf(CREATOR, {
          page: [
            row({
              consent_evidences: withForm(CREATOR),
              dependent: {
                dependent_profile: { created_by_user_id: CREATOR },
              },
            }),
          ],
        });
        expect([v.can, v.why]).toEqual([true, null]);
      });

      it('no form uploaded or already verified: false / null for everyone, and no extra read', async () => {
        const noForm = await verdictOf(CREATOR, {
          page: [custodyRow({ consent_evidences: [] })],
        });
        expect([noForm.can, noForm.why]).toEqual([false, null]);
        expect(noForm.db.guardianships.findMany).toHaveBeenCalledTimes(1);

        const verified = await verdictOf(CREATOR, {
          page: [custodyRow({ consent_status: 'verified' })],
        });
        expect([verified.can, verified.why]).toEqual([false, null]);
        expect(verified.db.guardianships.findMany).toHaveBeenCalledTimes(1);
      });

      it('reads the viewer rows and the hand-overs for ALL candidates in one query each', async () => {
        const db = makeDb();
        db.users.findMany.mockResolvedValue([
          dependentRow(dependentA),
          dependentRow(dependentB),
        ]);
        routeGuardianships(db, {
          page: [
            custodyRow(),
            custodyRow({
              guardianship_id: 'g-b',
              dependent_user_id: dependentB,
            }),
          ],
        });

        await gate.loadConsentBlocks(
          asDb(db),
          [dependentA, dependentB],
          VIEWER,
        );

        const wheres = db.guardianships.findMany.mock.calls.map(
          (c) => c[0].where,
        );
        expect(wheres).toHaveLength(3);
        expect(wheres[1]).toEqual({
          dependent_user_id: { in: [dependentA, dependentB] },
          guardian_user_id: VIEWER,
          consent_status: { not: 'revoked' },
        });
        expect(wheres[2]).toEqual({
          dependent_user_id: { in: [dependentA, dependentB] },
          is_custodian: false,
          guardian_user_id: { not: null },
          consent_status: 'revoked',
          revoked_reason: { in: ['guardian_left', 'guardian_account_closed'] },
        });
      });

      it('never exposes a creator, uploader or hand-over user id', async () => {
        const v = await verdictOf(CREATOR, {
          page: [custodyRow()],
          handovers: [
            { dependent_user_id: dependentA, guardian_user_id: HANDER },
          ],
        });
        const json = JSON.stringify(v.block);
        for (const id of [CREATOR, UPLOADER, HANDER]) {
          expect(json).not.toContain(id);
        }
        expect(Object.keys(v.block ?? {})).not.toContain('uploaded_by_user_id');
      });
    });
  });
});
