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
    '20260730190000_material_categories_per_local_field',
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
  CREATE TABLE users (user_id UUID PRIMARY KEY);
  CREATE TABLE material_categories (
    id UUID PRIMARY KEY, slug VARCHAR(100) NOT NULL, label VARCHAR(200) NOT NULL,
    icon VARCHAR(100), sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT material_categories_slug_key UNIQUE (slug)
  );
  CREATE TABLE material_products (
    id UUID PRIMARY KEY, local_field_id INT NOT NULL REFERENCES local_fields (local_field_id),
    material_category_id UUID NOT NULL,
    CONSTRAINT material_products_category_fk FOREIGN KEY (material_category_id)
      REFERENCES material_categories (id)
  );
  INSERT INTO local_fields VALUES (1), (2);
  INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000001');
  INSERT INTO material_categories (id, slug, label) VALUES
    ('00000000-0000-0000-0000-000000000101', 'uniformes', 'Uniformes'),
    ('00000000-0000-0000-0000-000000000102', 'libros', 'Libros');
  INSERT INTO material_products VALUES
    ('00000000-0000-0000-0000-000000000201', 1, '00000000-0000-0000-0000-000000000101'),
    ('00000000-0000-0000-0000-000000000202', 2, '00000000-0000-0000-0000-000000000102');`;

describe('material categories additive preparation migration', () => {
  dbIt(
    'preserves legacy categories and product references while allowing null scope',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `materials_w1a_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);
        await expect(
          client.query(`SELECT id, local_field_id FROM material_categories
            ORDER BY id`),
        ).resolves.toMatchObject({
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000101',
              local_field_id: null,
            },
            {
              id: '00000000-0000-0000-0000-000000000102',
              local_field_id: null,
            },
          ],
        });
        await expect(
          client.query(`SELECT material_category_id FROM material_products
            ORDER BY id`),
        ).resolves.toMatchObject({
          rows: [
            {
              material_category_id: '00000000-0000-0000-0000-000000000101',
            },
            {
              material_category_id: '00000000-0000-0000-0000-000000000102',
            },
          ],
        });
        await expect(
          client.query(`INSERT INTO material_categories (id, slug, label)
            VALUES ('00000000-0000-0000-0000-000000000301', 'nueva', 'Nueva')`),
        ).resolves.toBeDefined();
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );

  dbIt('enforces the optional local-field foreign key', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `materials_w1a_fk_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await client.query(`SET search_path=${schema},public; ${migration}`);
      await expect(
        client.query(`INSERT INTO material_categories
          (id, local_field_id, slug, label) VALUES
          ('00000000-0000-0000-0000-000000000302', 99, 'invalida', 'Inválida')`),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'material_categories_local_field_id_fkey',
      });
      await expect(
        client.query(`INSERT INTO material_audit_logs
          (local_field_id, actor_user_id, entity_type, entity_id, action)
          VALUES (1, '00000000-0000-0000-0000-000000000001',
            'category', 'category-1', 'prepared')`),
      ).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  dbIt('can be applied twice without modifying legacy data', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `materials_w1a_rerun_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await client.query(`SET search_path=${schema},public; ${migration}`);
      await expect(
        client.query(`SET search_path=${schema},public; ${migration}`),
      ).resolves.toBeDefined();
      await expect(
        client.query(`SELECT COUNT(*)::int AS count FROM material_categories
          WHERE local_field_id IS NULL`),
      ).resolves.toMatchObject({ rows: [{ count: 2 }] });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  dbIt('rolls back all additive schema changes on failure', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `materials_w1a_rollback_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await expect(
        client.query(
          `SET search_path=${schema},public; ${migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')}`,
        ),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      await expect(
        client.query(`SELECT COUNT(*)::int AS count FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'material_categories'
            AND column_name = 'local_field_id'`),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(
        client.query(`SELECT to_regclass('material_audit_logs') AS relation`),
      ).resolves.toMatchObject({ rows: [{ relation: null }] });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
