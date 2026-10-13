import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CamporeeVenuesService } from '../src/camporee-venues/camporee-venues.service';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

function scrub(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'database error';
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'));
}

/**
 * Prisma `contains` does not escape LIKE wildcards. These tests run the real
 * `listVenues` search against PostgreSQL to prove that `%`, `_` and `\` typed
 * by the user are matched literally.
 */
describe('LIKE wildcard escaping on isolated PostgreSQL', () => {
  let pool: pg.Pool;
  let prisma: PrismaClient;
  let service: CamporeeVenuesService;

  const VENUES = [
    'Sala 100%',
    'Sala 1000',
    'Sala_A',
    'SalaXA',
    'Ruta C:\\camp',
    'Plain',
  ];

  beforeAll(async () => {
    let url: string;
    try {
      url = await prepareAnnualCycleDatabase();
      await withClient(url, async (client) => {
        const country = await client.query<{ country_id: number }>(
          `INSERT INTO countries (name, abbreviation, active)
           VALUES ('LK Pais', 'LK', true) RETURNING country_id`,
        );
        const division = await client.query<{ division_id: number }>(
          `INSERT INTO divisions (code, name, abbreviation, active)
           VALUES ('LK', 'LK Division', 'LK', true) RETURNING division_id`,
        );
        const union = await client.query<{ union_id: number }>(
          `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
           VALUES ('LK Union', 'LKU', true, $1, $2) RETURNING union_id`,
          [country.rows[0].country_id, division.rows[0].division_id],
        );
        for (const name of VENUES) {
          await client.query(
            `INSERT INTO camporee_venues (scope, union_id, name, active)
             VALUES ('union', $1, $2, true)`,
            [union.rows[0].union_id, name],
          );
        }
      });
      pool = new pg.Pool({ connectionString: url, max: 4 });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
      service = new CamporeeVenuesService(prisma as never);
    } catch (error) {
      throw scrub(error);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  async function names(q: string): Promise<string[]> {
    const result = await service.listVenues({ q });
    return result.data.map((venue) => venue.name).sort();
  }

  it('does not treat "%" as match-everything', async () => {
    expect(await names('%')).toEqual(['Sala 100%']);
  });

  it('does not treat "_" as match-any-character', async () => {
    expect(await names('_')).toEqual(['Sala_A']);
    expect(await names('Sala_A')).toEqual(['Sala_A']);
  });

  it('matches a trailing "%" literally instead of as a wildcard', async () => {
    expect(await names('100%')).toEqual(['Sala 100%']);
  });

  it('matches a backslash literally', async () => {
    expect(await names('\\')).toEqual(['Ruta C:\\camp']);
  });

  it('keeps case-insensitive substring search working', async () => {
    expect(await names('sala')).toEqual([
      'Sala 100%',
      'Sala 1000',
      'SalaXA',
      'Sala_A',
    ]);
  });
});
