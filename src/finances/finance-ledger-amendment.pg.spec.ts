import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { financeSectionLockQuery } from './finance-ledger.service';

const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

describe('finance ledger amendment section locks', () => {
  dbIt('orders locks and blocks membership drift until rollback', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `finance_amend_${randomBytes(6).toString('hex')}`;
    const locker = new Client({ connectionString: databaseUrl });
    const writer = new Client({ connectionString: databaseUrl });
    await Promise.all([locker.connect(), writer.connect()]);
    try {
      await locker.query(`CREATE SCHEMA ${schema}; SET search_path=${schema};
        CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT);
        INSERT INTO club_sections VALUES (7,1),(8,1)`);
      await writer.query(`SET search_path=${schema}`);
      const lock = financeSectionLockQuery([8, 7]);
      const membershipSql =
        'UPDATE club_sections SET main_club_id=2 WHERE club_section_id=8';
      await locker.query('BEGIN');
      const rows = await locker.query(lock.text, lock.values);
      expect(lock.values).toStrictEqual([7, 8]);
      expect(
        rows.rows.map(({ club_section_id }) => club_section_id),
      ).toStrictEqual([7, 8]);
      await writer.query(`BEGIN; SET LOCAL lock_timeout='100ms'`);
      await expect(writer.query(membershipSql)).rejects.toMatchObject({
        code: '55P03',
      });
      await writer.query('ROLLBACK');
      await locker.query('ROLLBACK');
      await writer.query(membershipSql);
      await expect(
        locker.query(
          'SELECT main_club_id FROM club_sections WHERE club_section_id=8',
        ),
      ).resolves.toMatchObject({ rows: [{ main_club_id: 2 }] });
    } finally {
      await Promise.allSettled([
        locker.query('ROLLBACK'),
        writer.query('ROLLBACK'),
      ]);
      await locker.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.all([locker.end(), writer.end()]);
    }
  });
});
