import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';

type ClubTypeTemplate = {
  club_type_id: number;
  club_type_name: string;
  folder_template_id: string;
  sections: Array<{ section_id: string; max_points: number }>;
};

type DemoClub = {
  slug: string;
  displayName: string;
  scoresByClubTypeId: Record<number, number>;
};

const BATCH_TAG = 'SACDIA_DEMO_RANKING_20260528_A';
const MANIFEST_KEY = `dev_demo.ranking.${BATCH_TAG}`;
const LOCAL_FIELD_ID = 4; // Asociación Centro de Veracruz
const CHURCH_ID = 2; // ACV
const DISTRICT_ID = 22; // Asociación Centro de Veracruz
const ACTOR_EMAIL = 'abner.reyes03@gmail.com';
const GENERAL_CATEGORY_ID = '00000000-0000-0000-0000-000000000000';

const DEMO_CLUBS: DemoClub[] = [
  {
    slug: 'aguilas-del-faro',
    displayName: 'Águilas del Faro',
    scoresByClubTypeId: { 1: 87, 2: 95, 3: 73 },
  },
  {
    slug: 'brujula',
    displayName: 'Brújula',
    scoresByClubTypeId: { 1: 94, 2: 76, 3: 61 },
  },
  {
    slug: 'monte-sion',
    displayName: 'Monte Sion',
    scoresByClubTypeId: { 1: 77, 2: 64, 3: 92 },
  },
  {
    slug: 'shalom',
    displayName: 'Shalom',
    scoresByClubTypeId: { 1: 68, 2: 89, 3: 84 },
  },
];

const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const shouldCleanup = args.has('--cleanup');
const confirmedDevelopment = args.has('--confirm-development');

if (shouldApply === shouldCleanup) {
  console.error('Use exactly one mode: --apply or --cleanup.');
  process.exit(1);
}

if (!confirmedDevelopment) {
  console.error(
    'Refusing to write without --confirm-development. This script is for development demo data only.',
  );
  process.exit(1);
}

function loadDatabaseUrl(): string {
  const envPath = resolve(process.cwd(), '.env');
  const env = dotenv.parse(readFileSync(envPath));
  const rawUrl = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL is required in .env');
  }

  const url = new URL(rawUrl);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }

  return url.toString();
}

function makeClient(): Client {
  return new Client({
    connectionString: loadDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
}

async function getScalar<T>(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await client.query(sql, params);
  return result.rows[0] as T;
}

async function assertNoExistingBatch(client: Client): Promise<void> {
  const result = await getScalar<{ total: string }>(
    client,
    `
      SELECT (
        (SELECT COUNT(*) FROM system_config WHERE config_key = $1) +
        (SELECT COUNT(*) FROM clubs WHERE name LIKE $2)
      )::text AS total
    `,
    [MANIFEST_KEY, `${BATCH_TAG}%`],
  );

  if (Number(result.total) > 0) {
    throw new Error(
      `Demo batch ${BATCH_TAG} already exists. Run --cleanup first.`,
    );
  }
}

async function loadPrerequisites(client: Client): Promise<{
  yearId: number;
  yearEndDate: Date;
  actorUserId: string;
  unionId: number;
  divisionId: number;
  templates: ClubTypeTemplate[];
}> {
  const year = await getScalar<{ year_id: number; end_date: Date }>(
    client,
    `
      SELECT year_id, end_date
      FROM ecclesiastical_years
      WHERE active = true
      ORDER BY year_id DESC
      LIMIT 1
    `,
  );

  if (!year) {
    throw new Error('No active ecclesiastical year found.');
  }

  const actor = await getScalar<{ user_id: string }>(
    client,
    `SELECT user_id FROM users WHERE email = $1 LIMIT 1`,
    [ACTOR_EMAIL],
  );

  if (!actor) {
    throw new Error(`Actor user not found: ${ACTOR_EMAIL}`);
  }

  const scope = await getScalar<{ union_id: number; division_id: number }>(
    client,
    `
      SELECT lf.union_id, u.division_id
      FROM local_fields lf
      JOIN unions u ON u.union_id = lf.union_id
      WHERE lf.local_field_id = $1
    `,
    [LOCAL_FIELD_ID],
  );

  if (!scope) {
    throw new Error(`Local field not found: ${LOCAL_FIELD_ID}`);
  }

  const templateRows = await client.query<{
    club_type_id: number;
    club_type_name: string;
    folder_template_id: string;
    section_id: string;
    max_points: number;
  }>(
    `
      SELECT
        ct.club_type_id,
        ct.name AS club_type_name,
        ft.folder_template_id,
        fts.section_id,
        fts.max_points
      FROM folder_templates ft
      JOIN club_types ct ON ct.club_type_id = ft.club_type_id
      JOIN folder_template_sections fts ON fts.folder_template_id = ft.folder_template_id
      WHERE ft.ecclesiastical_year_id = $1
        AND ft.club_type_id IN (1, 2, 3)
      ORDER BY ct.club_type_id, fts."order", fts.section_id
    `,
    [year.year_id],
  );

  const templateMap = new Map<number, ClubTypeTemplate>();
  for (const row of templateRows.rows) {
    const current =
      templateMap.get(row.club_type_id) ??
      ({
        club_type_id: row.club_type_id,
        club_type_name: row.club_type_name,
        folder_template_id: row.folder_template_id,
        sections: [],
      } satisfies ClubTypeTemplate);

    current.sections.push({
      section_id: row.section_id,
      max_points: Number(row.max_points),
    });
    templateMap.set(row.club_type_id, current);
  }

  const templates = [...templateMap.values()];
  if (
    templates.length !== 3 ||
    templates.some((t) => t.sections.length === 0)
  ) {
    throw new Error(
      'Expected active-year folder templates with sections for club types 1, 2 and 3.',
    );
  }

  return {
    yearId: Number(year.year_id),
    yearEndDate: new Date(year.end_date),
    actorUserId: actor.user_id,
    unionId: Number(scope.union_id),
    divisionId: Number(scope.division_id),
    templates,
  };
}

async function ensureGeneralCategory(client: Client): Promise<void> {
  await client.query(
    `
      INSERT INTO award_categories (
        award_category_id,
        name,
        description,
        active,
        scope,
        min_points,
        max_points,
        "order",
        is_legacy
      )
      VALUES (
        $1,
        'General',
        'Sentinel category used internally for uncategorized/general rankings.',
        false,
        'club',
        0,
        NULL,
        0,
        true
      )
      ON CONFLICT (award_category_id) DO NOTHING
    `,
    [GENERAL_CATEGORY_ID],
  );
}

function clubName(club: DemoClub): string {
  return `${BATCH_TAG} - ${club.displayName}`;
}

function sectionName(club: DemoClub, clubTypeName: string): string {
  return `${BATCH_TAG} - ${club.displayName} - ${clubTypeName}`;
}

async function applyDemoData(client: Client): Promise<void> {
  await client.query('BEGIN');

  try {
    await assertNoExistingBatch(client);
    await ensureGeneralCategory(client);

    const prereqs = await loadPrerequisites(client);
    const manifest: {
      batchTag: string;
      localFieldId: number;
      yearId: number;
      clubs: Array<{
        clubId: number;
        name: string;
        enrollments: Array<{
          clubTypeId: number;
          clubTypeName: string;
          clubSectionId: number;
          clubEnrollmentId: string;
          annualFolderId: string;
          rankingId: string;
          hierarchyContextId: string;
          score: number;
          rankPosition: number;
        }>;
      }>;
    } = {
      batchTag: BATCH_TAG,
      localFieldId: LOCAL_FIELD_ID,
      yearId: prereqs.yearId,
      clubs: [],
    };

    const ranksByClubType = new Map<number, Map<string, number>>();
    for (const template of prereqs.templates) {
      const sorted = [...DEMO_CLUBS].sort(
        (a, b) =>
          b.scoresByClubTypeId[template.club_type_id] -
          a.scoresByClubTypeId[template.club_type_id],
      );
      ranksByClubType.set(
        template.club_type_id,
        new Map(sorted.map((club, index) => [club.slug, index + 1])),
      );
    }

    for (const club of DEMO_CLUBS) {
      const insertedClub = await getScalar<{ club_id: number }>(
        client,
        `
          INSERT INTO clubs (
            name,
            description,
            active,
            local_field_id,
            address,
            church_id,
            coordinates,
            districlub_type_id
          )
          VALUES ($1, $2, true, $3, $4, $5, $6::jsonb, $7)
          RETURNING club_id
        `,
        [
          clubName(club),
          `Datos demo reversibles para ranking institucional (${BATCH_TAG}).`,
          LOCAL_FIELD_ID,
          'Dirección demo — borrar con script dev-ranking-demo-data.ts --cleanup',
          CHURCH_ID,
          JSON.stringify({ lat: 19.1738, lng: -96.1342, demo: true }),
          DISTRICT_ID,
        ],
      );

      const clubManifest = {
        clubId: Number(insertedClub.club_id),
        name: clubName(club),
        enrollments: [] as (typeof manifest.clubs)[number]['enrollments'],
      };

      for (const template of prereqs.templates) {
        const score = club.scoresByClubTypeId[template.club_type_id];
        const totalMax = template.sections.reduce(
          (sum, section) => sum + section.max_points,
          0,
        );
        const evaluatedSections = template.sections.map((section) => ({
          ...section,
          earned_points: Math.round((section.max_points * score) / 100),
        }));
        const totalEarned = evaluatedSections.reduce(
          (sum, section) => sum + section.earned_points,
          0,
        );
        const progressPct =
          totalMax > 0
            ? Number(((totalEarned / totalMax) * 100).toFixed(2))
            : 0;
        const rankPosition =
          ranksByClubType.get(template.club_type_id)?.get(club.slug) ?? 99;

        const section = await getScalar<{ club_section_id: number }>(
          client,
          `
            INSERT INTO club_sections (
              active,
              souls_target,
              fee,
              club_type_id,
              main_club_id,
              name,
              email,
              address
            )
            VALUES (true, 25, 0, $1, $2, $3, $4, $5)
            RETURNING club_section_id
          `,
          [
            template.club_type_id,
            insertedClub.club_id,
            sectionName(club, template.club_type_name),
            `${club.slug}.${template.club_type_id}@demo.sacdia.local`,
            'Dirección demo — ranking',
          ],
        );

        const enrollment = await getScalar<{ club_enrollment_id: string }>(
          client,
          `
            INSERT INTO club_enrollments (
              club_section_id,
              ecclesiastical_year_id,
              status,
              address,
              meeting_days,
              created_by,
              director_id
            )
            VALUES ($1, $2, 'active', $3, 'Sábado', $4, $4)
            RETURNING club_enrollment_id
          `,
          [
            section.club_section_id,
            prereqs.yearId,
            'Dirección demo — ranking',
            prereqs.actorUserId,
          ],
        );

        const hierarchy = await getScalar<{ hierarchy_context_id: string }>(
          client,
          `
            INSERT INTO hierarchy_contexts (
              division_id,
              union_id,
              local_field_id,
              districlub_type_id,
              church_id,
              club_id,
              as_of,
              source,
              precision,
              context,
              created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'snapshot', 'exact', $8::jsonb, $9)
            RETURNING hierarchy_context_id
          `,
          [
            prereqs.divisionId,
            prereqs.unionId,
            LOCAL_FIELD_ID,
            DISTRICT_ID,
            CHURCH_ID,
            insertedClub.club_id,
            prereqs.yearEndDate,
            JSON.stringify({
              demo_batch: BATCH_TAG,
              club_slug: club.slug,
              club_type_id: template.club_type_id,
            }),
            prereqs.actorUserId,
          ],
        );

        const folder = await getScalar<{ annual_folder_id: string }>(
          client,
          `
            INSERT INTO annual_folders (
              club_enrollment_id,
              folder_template_id,
              hierarchy_context_id,
              status,
              submitted_at,
              evaluated_at,
              closed_at,
              total_earned_points,
              total_max_points,
              progress_percentage
            )
            VALUES (
              $1,
              $2,
              $3,
              'closed',
              NOW() - INTERVAL '10 days',
              NOW() - INTERVAL '5 days',
              NOW() - INTERVAL '1 day',
              $4,
              $5,
              $6
            )
            RETURNING annual_folder_id
          `,
          [
            enrollment.club_enrollment_id,
            template.folder_template_id,
            hierarchy.hierarchy_context_id,
            totalEarned,
            totalMax,
            progressPct,
          ],
        );

        for (const sectionEvaluation of evaluatedSections) {
          await client.query(
            `
              INSERT INTO annual_folder_section_evaluations (
                annual_folder_id,
                section_id,
                earned_points,
                max_points,
                status,
                notes,
                lf_approved_by,
                lf_approved_at,
                union_approved_by,
                union_approved_at,
                union_decision
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                'VALIDATED'::annual_folder_section_status_enum,
                $5,
                $6,
                NOW() - INTERVAL '5 days',
                $6,
                NOW() - INTERVAL '5 days',
                'APPROVED'::union_evaluation_decision_enum
              )
            `,
            [
              folder.annual_folder_id,
              sectionEvaluation.section_id,
              sectionEvaluation.earned_points,
              sectionEvaluation.max_points,
              `Evaluación demo ${BATCH_TAG}`,
              prereqs.actorUserId,
            ],
          );
        }

        const ranking = await getScalar<{ ranking_id: string }>(
          client,
          `
            INSERT INTO club_annual_rankings (
              club_enrollment_id,
              club_type_id,
              ecclesiastical_year_id,
              award_category_id,
              total_earned_points,
              total_max_points,
              progress_percentage,
              rank_position,
              folder_score_pct,
              finance_score_pct,
              camporee_score_pct,
              evidence_score_pct,
              composite_score_pct,
              composite_calculated_at,
              hierarchy_context_id
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $9,
              $9,
              $9,
              $9,
              NOW(),
              $10
            )
            RETURNING ranking_id
          `,
          [
            enrollment.club_enrollment_id,
            template.club_type_id,
            prereqs.yearId,
            GENERAL_CATEGORY_ID,
            totalEarned,
            totalMax,
            progressPct,
            rankPosition,
            score,
            hierarchy.hierarchy_context_id,
          ],
        );

        clubManifest.enrollments.push({
          clubTypeId: template.club_type_id,
          clubTypeName: template.club_type_name,
          clubSectionId: Number(section.club_section_id),
          clubEnrollmentId: enrollment.club_enrollment_id,
          annualFolderId: folder.annual_folder_id,
          rankingId: ranking.ranking_id,
          hierarchyContextId: hierarchy.hierarchy_context_id,
          score,
          rankPosition,
        });
      }

      manifest.clubs.push(clubManifest);
    }

    await client.query(
      `
        INSERT INTO system_config (config_key, config_value, description, config_type)
        VALUES ($1, $2, $3, 'json')
      `,
      [
        MANIFEST_KEY,
        JSON.stringify(manifest, null, 2),
        `Manifest for reversible development ranking demo batch ${BATCH_TAG}`,
      ],
    );

    await client.query('COMMIT');
    printApplySummary(manifest);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanupDemoData(client: Client): Promise<void> {
  await client.query('BEGIN');

  try {
    const before = await collectBatchCounts(client);

    await client.query(
      `
        DELETE FROM club_annual_rankings
        WHERE hierarchy_context_id IN (
          SELECT hierarchy_context_id
          FROM hierarchy_contexts
          WHERE context->>'demo_batch' = $1
        )
      `,
      [BATCH_TAG],
    );

    await client.query(
      `
        DELETE FROM annual_folder_section_evaluations
        WHERE annual_folder_id IN (
          SELECT af.annual_folder_id
          FROM annual_folders af
          JOIN hierarchy_contexts hc ON hc.hierarchy_context_id = af.hierarchy_context_id
          WHERE hc.context->>'demo_batch' = $1
        )
      `,
      [BATCH_TAG],
    );

    await client.query(
      `
        DELETE FROM annual_folders
        WHERE hierarchy_context_id IN (
          SELECT hierarchy_context_id
          FROM hierarchy_contexts
          WHERE context->>'demo_batch' = $1
        )
      `,
      [BATCH_TAG],
    );

    await client.query(
      `
        DELETE FROM club_enrollments
        WHERE club_section_id IN (
          SELECT club_section_id
          FROM club_sections
          WHERE name LIKE $1
        )
      `,
      [`${BATCH_TAG}%`],
    );

    await client.query(`DELETE FROM club_sections WHERE name LIKE $1`, [
      `${BATCH_TAG}%`,
    ]);
    await client.query(`DELETE FROM clubs WHERE name LIKE $1`, [
      `${BATCH_TAG}%`,
    ]);
    await client.query(
      `DELETE FROM hierarchy_contexts WHERE context->>'demo_batch' = $1`,
      [BATCH_TAG],
    );
    await client.query(`DELETE FROM system_config WHERE config_key = $1`, [
      MANIFEST_KEY,
    ]);

    const after = await collectBatchCounts(client);
    await client.query('COMMIT');

    console.log(`Cleaned demo batch ${BATCH_TAG}`);
    console.table({ before, after });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function collectBatchCounts(
  client: Client,
): Promise<Record<string, number>> {
  const rows = await client.query<{ label: string; total: string }>(
    `
      SELECT 'clubs' AS label, COUNT(*)::text AS total
      FROM clubs
      WHERE name LIKE $1
      UNION ALL
      SELECT 'club_sections', COUNT(*)::text
      FROM club_sections
      WHERE name LIKE $1
      UNION ALL
      SELECT 'club_enrollments', COUNT(*)::text
      FROM club_enrollments
      WHERE club_section_id IN (
        SELECT club_section_id FROM club_sections WHERE name LIKE $1
      )
      UNION ALL
      SELECT 'annual_folders', COUNT(*)::text
      FROM annual_folders af
      JOIN hierarchy_contexts hc ON hc.hierarchy_context_id = af.hierarchy_context_id
      WHERE hc.context->>'demo_batch' = $2
      UNION ALL
      SELECT 'club_annual_rankings', COUNT(*)::text
      FROM club_annual_rankings r
      JOIN hierarchy_contexts hc ON hc.hierarchy_context_id = r.hierarchy_context_id
      WHERE hc.context->>'demo_batch' = $2
      UNION ALL
      SELECT 'hierarchy_contexts', COUNT(*)::text
      FROM hierarchy_contexts
      WHERE context->>'demo_batch' = $2
      UNION ALL
      SELECT 'manifest', COUNT(*)::text
      FROM system_config
      WHERE config_key = $3
    `,
    [`${BATCH_TAG}%`, BATCH_TAG, MANIFEST_KEY],
  );

  return Object.fromEntries(
    rows.rows.map((row) => [row.label, Number(row.total)]),
  );
}

function printApplySummary(manifest: {
  batchTag: string;
  localFieldId: number;
  yearId: number;
  clubs: Array<{
    clubId: number;
    name: string;
    enrollments: Array<{
      clubTypeId: number;
      clubTypeName: string;
      rankPosition: number;
      score: number;
    }>;
  }>;
}): void {
  console.log(`Created demo ranking batch ${manifest.batchTag}`);
  console.log(`Manifest stored in system_config.config_key=${MANIFEST_KEY}`);
  console.log(
    `Local field: ${manifest.localFieldId}, year: ${manifest.yearId}`,
  );
  console.table(
    manifest.clubs.flatMap((club) =>
      club.enrollments.map((enrollment) => ({
        club_id: club.clubId,
        club: club.name,
        type: enrollment.clubTypeName,
        rank: enrollment.rankPosition,
        score: enrollment.score,
      })),
    ),
  );
}

async function main(): Promise<void> {
  const client = makeClient();
  await client.connect();

  try {
    if (shouldApply) {
      await applyDemoData(client);
    } else {
      await cleanupDemoData(client);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
