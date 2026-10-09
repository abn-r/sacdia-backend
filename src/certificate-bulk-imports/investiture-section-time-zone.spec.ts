import { ErrorCode } from '../common/errors/error-codes';
import { sectionField } from './class-certificate-live-authorization';
import { INVESTITURE_REQUEST_TIME_ZONE_FALLBACK } from '../investiture-requests/ecclesiastical-year-local-day';

function database(timezone: string) {
  return {
    club_sections: {
      findUnique: async () => ({
        clubs: {
          local_field_id: 10,
          local_fields: { timezone },
        },
      }),
    },
  };
}

describe('certificate section timezone', () => {
  it('BC-2 uses the same fallback and the same invalid-zone error', async () => {
    await expect(sectionField(database('   ') as never, 4)).resolves.toEqual({
      fieldId: 10,
      timeZone: INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
    });
    await expect(
      sectionField(database('  America/Mexico_City  ') as never, 4),
    ).resolves.toEqual({
      fieldId: 10,
      timeZone: 'America/Mexico_City',
    });
    await expect(sectionField(database('') as never, 4)).resolves.toMatchObject(
      {
        timeZone: INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
      },
    );
    await expect(
      sectionField(database('Not/AZone') as never, 4),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
    });
  });
});
