import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClubEnrollmentQueueQueryDto } from './club-enrollment-queue-query.dto';
import { RejectClubEnrollmentDto } from './review-club-enrollment.dto';

const reject = (body: unknown) =>
  validate(plainToInstance(RejectClubEnrollmentDto, body));

describe('RejectClubEnrollmentDto', () => {
  it('accepts a reason of 5 to 500 characters once trimmed', async () => {
    expect(await reject({ reason: 'Falta' })).toHaveLength(0);
    expect(await reject({ reason: '  Falta la dirección  ' })).toHaveLength(0);
    expect(await reject({ reason: 'x'.repeat(500) })).toHaveLength(0);
  });

  it('refuses a missing, blank, too short or too long reason', async () => {
    expect(await reject({})).not.toHaveLength(0);
    expect(await reject({ reason: '' })).not.toHaveLength(0);
    expect(await reject({ reason: '     ' })).not.toHaveLength(0);
    expect(await reject({ reason: ' abcd ' })).not.toHaveLength(0);
    expect(await reject({ reason: 'x'.repeat(501) })).not.toHaveLength(0);
    expect(await reject({ reason: 12345 })).not.toHaveLength(0);
  });

  it('trims before the length check', () => {
    expect(
      plainToInstance(RejectClubEnrollmentDto, { reason: '  hola mundo ' })
        .reason,
    ).toBe('hola mundo');
  });
});

describe('ClubEnrollmentQueueQueryDto', () => {
  const check = (query: unknown) =>
    validate(plainToInstance(ClubEnrollmentQueueQueryDto, query));

  it('defaults to pending, page 1, 20 per page', () => {
    const dto = plainToInstance(ClubEnrollmentQueueQueryDto, {});
    expect([dto.status, dto.page, dto.limit]).toEqual([
      'pending_validation',
      1,
      20,
    ]);
  });

  it.each(['pending_validation', 'active', 'rejected'])(
    'accepts status %s',
    async (status) => {
      expect(await check({ status })).toHaveLength(0);
    },
  );

  it('refuses unknown statuses, limits out of 1-100 and non numeric ids', async () => {
    expect(await check({ status: 'inactive' })).not.toHaveLength(0);
    expect(await check({ status: 'all' })).not.toHaveLength(0);
    expect(await check({ limit: '0' })).not.toHaveLength(0);
    expect(await check({ limit: '101' })).not.toHaveLength(0);
    expect(await check({ limit: '100' })).toHaveLength(0);
    expect(await check({ ecclesiastical_year_id: 'abc' })).not.toHaveLength(0);
  });

  it('parses numeric query strings', () => {
    const dto = plainToInstance(ClubEnrollmentQueueQueryDto, {
      page: '2',
      limit: '50',
      local_field_id: '4',
      club_type_id: '3',
      ecclesiastical_year_id: '7',
    });
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      local_field_id: 4,
      club_type_id: 3,
      ecclesiastical_year_id: 7,
    });
  });
});
