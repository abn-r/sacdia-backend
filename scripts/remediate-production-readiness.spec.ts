import {
  approveAttestation,
  assertBackupRestorable,
  assertRuntimeEnvironment,
  computeDatabaseFingerprint,
  createAttestation,
  decryptBackup,
  encryptBackup,
  sha256,
  validateManifest,
  verifyApplyAuthorization,
  type BackupSnapshot,
  type ProductionReadinessManifest,
} from './remediate-production-readiness';

const UUIDS = {
  assignment: '317367b1-a2ea-4d9d-896c-8ef156c8cac5',
  enrollmentGm: '75c538e1-fa18-4dc7-bfa5-b08f62d4dbf7',
  enrollmentCq: '621ea0d0-4779-4a06-98eb-25e13b1af398',
  carlos: 'a0000001-0000-4000-8000-000000000001',
  ana: 'a0000001-0000-4000-8000-000000000003',
  pedro: 'a0000001-0000-4000-8000-000000000004',
  abner: '104a2549-2056-4b9b-aaeb-51d8fd43191d',
};

function createManifest(): ProductionReadinessManifest {
  const honorApplicability = Array.from({ length: 637 }, (_, index) => ({
    honor_id: index + 1,
    code: `HONOR-${index + 1}`,
    expected_hct: [1],
    expected_legacy: 2,
    target_hct: [2],
    target_legacy: 2,
  }));

  honorApplicability.push({
    honor_id: 649,
    code: 'LEGACY-649',
    expected_hct: [3],
    expected_legacy: 2,
    target_hct: [3],
    target_legacy: 3,
  });

  return {
    schema_version: 1,
    environment: 'development',
    ecclesiastical_year_id: 1,
    hierarchy: {
      division_id: 1,
      country_id: 25,
      union_id: 20,
      local_field_id: 4,
      old_district_id: 20,
      target_district_id: 17,
      church_id: 1,
      club_id: 1,
    },
    assignments_to_close: [
      UUIDS.assignment,
      '2764cf15-09a3-4c51-94f6-b8567c14f4b6',
      '046861d5-d2cc-4f2f-875b-672841a47d76',
      'b05ce76c-2005-464d-ade7-4757a0e6cbb1',
    ],
    cq_test_assignments_to_replace: [
      '5d9c8962-8891-4842-abf2-a062ee57cdf2',
      'd28d1499-0efb-4d30-8e74-ec49e0a169ee',
    ],
    officers: {
      carlos_user_id: UUIDS.carlos,
      ana_user_id: UUIDS.ana,
      pedro_user_id: UUIDS.pedro,
      abner_user_id: UUIDS.abner,
    },
    annual_enrollments: {
      master_guides_id: UUIDS.enrollmentGm,
      conquerors_id: UUIDS.enrollmentCq,
    },
    class_enrollment_ids: [
      100, 101, 102, 103, 104, 105, 108, 109, 110, 111, 112, 113, 116, 117, 118,
      119, 120, 121, 124, 125, 126, 127,
    ],
    estella_section_ids: [163, 164, 165],
    honor_applicability: honorApplicability,
  };
}

function createSnapshot(): BackupSnapshot {
  return {
    format_version: 1,
    captured_at: '2026-07-20T20:00:00.000Z',
    fingerprint: 'fingerprint-1',
    row_counts: { clubs: 1, club_role_assignments: 6 },
    tables: {
      clubs: [{ club_id: 1, districlub_type_id: 20 }],
      club_role_assignments: Array.from({ length: 6 }, (_, index) => ({
        assignment_id: `assignment-${index + 1}`,
      })),
    },
  };
}

describe('production readiness remediation safety core', () => {
  const backupKey = Buffer.alloc(32, 7).toString('base64');
  const approvalKey = 'approval-key-that-is-only-present-for-the-approver';
  const now = new Date('2026-07-20T20:00:00.000Z');

  describe('manifest validation', () => {
    it('accepts the exact technical manifest shape', () => {
      expect(validateManifest(createManifest())).toEqual(createManifest());
    });

    it('rejects a partial manifest before any database access', () => {
      const manifest = createManifest() as unknown as Record<string, unknown>;
      delete manifest.hierarchy;

      expect(() => validateManifest(manifest)).toThrow(
        'manifest.hierarchy is required',
      );
    });

    it('rejects duplicate or incomplete target ID sets', () => {
      const manifest = createManifest();
      manifest.class_enrollment_ids[21] = manifest.class_enrollment_ids[0];

      expect(() => validateManifest(manifest)).toThrow(
        'class_enrollment_ids must contain 22 unique IDs',
      );
    });
  });

  describe('environment guards', () => {
    const developmentUrl =
      'postgresql://user:pass@dev.example.test:5432/sacdia_dev?sslmode=require';
    const productionUrl =
      'postgresql://user:pass@prod.example.test:5432/sacdia?sslmode=require';

    it('rejects a non-development runtime', () => {
      expect(() =>
        assertRuntimeEnvironment({
          nodeEnv: 'production',
          sourceDatabaseUrl: developmentUrl,
          productionDatabaseUrl: productionUrl,
        }),
      ).toThrow('NODE_ENV must be development');
    });

    it('rejects the configured production database', () => {
      expect(() =>
        assertRuntimeEnvironment({
          nodeEnv: 'development',
          sourceDatabaseUrl: productionUrl,
          productionDatabaseUrl: productionUrl,
        }),
      ).toThrow('source database matches production');
    });

    it('rejects restoring into the source database endpoint', () => {
      expect(() =>
        assertRuntimeEnvironment({
          nodeEnv: 'development',
          sourceDatabaseUrl: developmentUrl,
          productionDatabaseUrl: productionUrl,
          targetDatabaseUrl:
            'postgresql://other:secret@dev.example.test:5432/sacdia_dev',
        }),
      ).toThrow('target database must differ from source host/database');
    });
  });

  describe('fingerprint', () => {
    it('is deterministic regardless of migration input order', () => {
      const migrations = [
        {
          migration_name: '20260702000000_second',
          checksum: 'b',
          finished_at: '2026-07-02T00:00:00.000Z',
        },
        {
          migration_name: '20260701000000_first',
          checksum: 'a',
          finished_at: '2026-07-01T00:00:00.000Z',
        },
      ];

      const first = computeDatabaseFingerprint({
        databaseUrl: 'postgresql://user:pass@dev.example.test:5432/sacdia_dev',
        schema: 'public',
        ecclesiasticalYearId: 1,
        migrations,
      });
      const second = computeDatabaseFingerprint({
        databaseUrl:
          'postgresql://different:secret@dev.example.test:5432/sacdia_dev',
        schema: 'public',
        ecclesiasticalYearId: 1,
        migrations: [...migrations].reverse(),
      });

      expect(first).toBe(second);
    });
  });

  describe('encrypted backup', () => {
    it('round-trips with AES-256-GCM without exposing plaintext', () => {
      const snapshot = createSnapshot();
      const envelope = encryptBackup(snapshot, backupKey);

      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(JSON.stringify(envelope)).not.toContain('districlub_type_id');
      expect(decryptBackup(envelope, backupKey)).toEqual(snapshot);
    });

    it('rejects a wrong encryption key', () => {
      const envelope = encryptBackup(createSnapshot(), backupKey);
      const wrongKey = Buffer.alloc(32, 8).toString('base64');

      expect(() => decryptBackup(envelope, wrongKey)).toThrow(
        'backup authentication failed',
      );
    });

    it('rejects a backup whose declared row counts are not restorable', () => {
      const snapshot = createSnapshot();
      snapshot.row_counts.clubs = 2;
      const envelope = encryptBackup(snapshot, backupKey);
      const serialized = JSON.stringify(envelope);

      expect(() =>
        assertBackupRestorable({
          serializedEnvelope: serialized,
          expectedSha256: sha256(serialized),
          backupKeyBase64: backupKey,
        }),
      ).toThrow('backup row count mismatch for clubs');
    });
  });

  describe('attestation approval', () => {
    it('rejects approval by the dry-run actor', () => {
      const attestation = createAttestation({
        runId: 'run-1',
        fingerprint: 'fingerprint-1',
        manifestSha256: 'manifest-sha',
        backupSha256: 'backup-sha',
        actor: 'operator-a',
        now,
        ttlSeconds: 900,
      });

      expect(() =>
        approveAttestation({
          attestation,
          approver: 'operator-a',
          approvalKey,
          now,
        }),
      ).toThrow('approver must differ from dry-run actor');
    });

    it('rejects an expired attestation before apply', () => {
      const attestation = createAttestation({
        runId: 'run-2',
        fingerprint: 'fingerprint-1',
        manifestSha256: 'manifest-sha',
        backupSha256: 'backup-sha',
        actor: 'operator-a',
        now,
        ttlSeconds: 60,
      });
      const approval = approveAttestation({
        attestation,
        approver: 'approver-b',
        approvalKey,
        now,
      });

      expect(() =>
        verifyApplyAuthorization({
          attestation,
          approval,
          approvalKey,
          actor: 'operator-a',
          currentFingerprint: 'fingerprint-1',
          currentManifestSha256: 'manifest-sha',
          currentBackupSha256: 'backup-sha',
          now: new Date('2026-07-20T20:01:01.000Z'),
        }),
      ).toThrow('attestation expired');
    });

    it('rejects a divergent database fingerprint or tampered approval', () => {
      const attestation = createAttestation({
        runId: 'run-3',
        fingerprint: 'fingerprint-1',
        manifestSha256: 'manifest-sha',
        backupSha256: 'backup-sha',
        actor: 'operator-a',
        now,
        ttlSeconds: 900,
      });
      const approval = approveAttestation({
        attestation,
        approver: 'approver-b',
        approvalKey,
        now,
      });

      expect(() =>
        verifyApplyAuthorization({
          attestation,
          approval,
          approvalKey,
          actor: 'operator-a',
          currentFingerprint: 'fingerprint-changed',
          currentManifestSha256: 'manifest-sha',
          currentBackupSha256: 'backup-sha',
          now,
        }),
      ).toThrow('database fingerprint changed');

      expect(() =>
        verifyApplyAuthorization({
          attestation,
          approval: { ...approval, signature: 'tampered' },
          approvalKey,
          actor: 'operator-a',
          currentFingerprint: 'fingerprint-1',
          currentManifestSha256: 'manifest-sha',
          currentBackupSha256: 'backup-sha',
          now,
        }),
      ).toThrow('approval signature is invalid');
    });
  });
});
