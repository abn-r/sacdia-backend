import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20260730233000_finalize_material_category_scope',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.MATERIALS_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_MATERIALS_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TABLE local_fields (local_field_id INT PRIMARY KEY);
  CREATE TABLE material_categories (
    id UUID PRIMARY KEY, local_field_id INT REFERENCES local_fields (local_field_id),
    slug VARCHAR(100) NOT NULL, label VARCHAR(200) NOT NULL, icon VARCHAR(100),
    sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT material_categories_slug_key UNIQUE (slug)
  );
  CREATE INDEX idx_material_categories_lf_active
    ON material_categories (local_field_id, active);
  CREATE TABLE material_products (
    id UUID PRIMARY KEY, local_field_id INT NOT NULL REFERENCES local_fields (local_field_id),
    material_category_id UUID NOT NULL,
    CONSTRAINT material_products_category_fk FOREIGN KEY (material_category_id)
      REFERENCES material_categories (id)
  );
  INSERT INTO local_fields VALUES (1), (2);
  INSERT INTO material_categories (id, slug, label, icon, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000101', 'uniformes', 'Uniformes', 'shirt', 1),
    ('00000000-0000-0000-0000-000000000102', 'libros', 'Libros', 'book', 2);
  INSERT INTO material_products VALUES
    ('00000000-0000-0000-0000-000000000201', 1, '00000000-0000-0000-0000-000000000101'),
    ('00000000-0000-0000-0000-000000000202', 2, '00000000-0000-0000-0000-000000000101'),
    ('00000000-0000-0000-0000-000000000203', 2, '00000000-0000-0000-0000-000000000102');`;

async function withSchema(
  prefix: string,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  if (!databaseUrl) throw new Error('integration URL required');
  const schema = `${prefix}_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(fixtures(schema));
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

describe('material category scope finalization migration', () => {
  dbIt('clones losslessly and preserves deterministic ids and references', () =>
    withSchema('materials_w1b2_clone', async (client) => {
      await client.query(migration);
      const result = await client.query(`
        SELECT c.local_field_id, c.slug, c.label, c.icon, c.sort_order,
          c.id = CASE WHEN c.local_field_id = 1 THEN
            CASE c.slug
              WHEN 'uniformes' THEN '00000000-0000-0000-0000-000000000101'::uuid
              ELSE '00000000-0000-0000-0000-000000000102'::uuid
            END
          ELSE md5(
            CASE c.slug
              WHEN 'uniformes' THEN '00000000-0000-0000-0000-000000000101:2'
              ELSE '00000000-0000-0000-0000-000000000102:2'
            END
          )::uuid END AS deterministic_id
        FROM material_categories c ORDER BY c.local_field_id, c.slug`);
      expect(result.rows).toHaveLength(4);
      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            local_field_id: 1,
            slug: 'uniformes',
            label: 'Uniformes',
            icon: 'shirt',
            sort_order: 1,
            deterministic_id: true,
          }),
          expect.objectContaining({
            local_field_id: 2,
            slug: 'libros',
            label: 'Libros',
            icon: 'book',
            sort_order: 2,
            deterministic_id: true,
          }),
        ]),
      );
      await expect(
        client.query(`SELECT COUNT(*)::int AS count FROM material_products p
          JOIN material_categories c ON c.id = p.material_category_id
            AND c.local_field_id = p.local_field_id`),
      ).resolves.toMatchObject({ rows: [{ count: 3 }] });
    }),
  );

  dbIt('aborts when legacy categories exist without local fields', () =>
    withSchema('materials_w1b2_zero_lf', async (client) => {
      await client.query('TRUNCATE local_fields CASCADE');
      await client.query(`INSERT INTO material_categories (id, slug, label)
        VALUES ('00000000-0000-0000-0000-000000000301', 'legacy', 'Legacy')`);
      await expect(client.query(migration)).rejects.toMatchObject({
        code: 'P0001',
        message: 'materials_category_scope_zero_local_fields',
      });
    }),
  );

  dbIt('aborts on a scoped versus legacy slug collision', () =>
    withSchema('materials_w1b2_slug', async (client) => {
      await client.query(
        'ALTER TABLE material_categories DROP CONSTRAINT material_categories_slug_key',
      );
      await client.query(`INSERT INTO material_categories
        (id, local_field_id, slug, label) VALUES
        ('00000000-0000-0000-0000-000000000301', 1, 'uniformes', 'Local')`);
      await expect(client.query(migration)).rejects.toMatchObject({
        code: 'P0001',
        message: 'materials_category_scope_slug_collision',
      });
    }),
  );

  dbIt('aborts when a product already points to another field category', () =>
    withSchema('materials_w1b2_mismatch', async (client) => {
      await client.query(`UPDATE material_categories SET local_field_id = 2
        WHERE id = '00000000-0000-0000-0000-000000000101'`);
      await expect(client.query(migration)).rejects.toMatchObject({
        code: 'P0001',
        message: 'materials_product_category_scope_mismatch',
      });
    }),
  );

  dbIt(
    'enforces final scope constraints and rejects cross-field references',
    () =>
      withSchema('materials_w1b2_fk', async (client) => {
        await client.query(migration);
        await expect(
          client.query(`INSERT INTO material_categories (id, slug, label) VALUES
          ('00000000-0000-0000-0000-000000000401', 'sin-campo', 'Sin campo')`),
        ).rejects.toMatchObject({ code: '23502', column: 'local_field_id' });
        await expect(
          client.query(`INSERT INTO material_categories
          (id, local_field_id, slug, label) VALUES
          ('00000000-0000-0000-0000-000000000402', 1, 'libros', 'Duplicada')`),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'uq_material_categories_lf_slug',
        });
        await expect(
          client.query(`UPDATE material_products SET material_category_id =
          (SELECT id FROM material_categories
            WHERE local_field_id = 1 AND slug = 'libros')
          WHERE id = '00000000-0000-0000-0000-000000000203'`),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'material_products_category_scope_fk',
        });
      }),
  );

  dbIt('is idempotent on rerun', () =>
    withSchema('materials_w1b2_rerun', async (client) => {
      await client.query(migration);
      const before =
        await client.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS snapshot
        FROM (SELECT id, local_field_id, slug FROM material_categories) t`);
      await client.query(migration);
      const after =
        await client.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS snapshot
        FROM (SELECT id, local_field_id, slug FROM material_categories) t`);
      expect(after.rows[0].snapshot).toEqual(before.rows[0].snapshot);
    }),
  );

  dbIt('rolls back data and constraints when finalization fails', () =>
    withSchema('materials_w1b2_rollback', async (client) => {
      await expect(
        client.query(migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      await expect(
        client.query(`SELECT COUNT(*)::int AS count FROM material_categories
          WHERE local_field_id IS NULL`),
      ).resolves.toMatchObject({ rows: [{ count: 2 }] });
      await expect(
        client.query(`SELECT COUNT(*)::int AS count FROM pg_constraint
          WHERE conrelid = 'material_products'::regclass
            AND conname = 'material_products_category_fk'`),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    }),
  );
});
