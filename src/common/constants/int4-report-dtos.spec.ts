import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';

import { INT4_MAX } from './int4.constants';
import { GenerateAnnualReportDto } from '../../annual-reports/dto/generate-annual-report.dto';
import { UpdateAnnualManualDataDto } from '../../annual-reports/dto/update-manual-data.dto';
import { UpdateManualDataDto as UpdateMonthlyManualDataDto } from '../../monthly-reports/dto/update-manual-data.dto';
import { GenerateQuarterlyReportDto } from '../../quarterly-reports/dto/generate-quarterly-report.dto';
import { UpdateQuarterlyManualDataDto } from '../../quarterly-reports/dto/update-manual-data.dto';

const OVERFLOW = 99999999999;

type Ctor<T extends object> = new () => T;

async function failingProps<T extends object>(
  cls: Ctor<T>,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.map((e) => e.property).sort();
}

function intFields(
  cls: Ctor<object>,
  booleans: string[],
  strings: string[],
): string[] {
  // Collect declared property names via the validation metadata registry.
  const metas = getMetadataStorage().getTargetValidationMetadatas(
    cls,
    '',
    false,
    false,
  ) as Array<{ propertyName: string }>;
  const names = new Set(metas.map((m) => m.propertyName));
  return [...names].filter(
    (n) => !booleans.includes(n) && !strings.includes(n),
  );
}

describe('int4 range validation on report DTOs', () => {
  describe('generate DTOs', () => {
    it('rejects an out-of-range club_id / ecclesiastical_year_id (annual)', async () => {
      expect(
        await failingProps(GenerateAnnualReportDto, {
          club_id: OVERFLOW,
          ecclesiastical_year_id: OVERFLOW,
        }),
      ).toEqual(['club_id', 'ecclesiastical_year_id']);
    });

    it('accepts the int4 maximum (annual)', async () => {
      expect(
        await failingProps(GenerateAnnualReportDto, {
          club_id: INT4_MAX,
          ecclesiastical_year_id: INT4_MAX,
        }),
      ).toEqual([]);
    });

    it('rejects an out-of-range club_id (quarterly)', async () => {
      expect(
        await failingProps(GenerateQuarterlyReportDto, {
          club_id: OVERFLOW,
          year: 2026,
          quarter: 2,
        }),
      ).toEqual(['club_id']);
    });

    it('accepts the int4 maximum (quarterly)', async () => {
      expect(
        await failingProps(GenerateQuarterlyReportDto, {
          club_id: INT4_MAX,
          year: 2026,
          quarter: 2,
        }),
      ).toEqual([]);
    });
  });

  describe.each([
    [
      'monthly',
      UpdateMonthlyManualDataDto,
      [
        'has_weekly_bible_instruction',
        'bible_studies_given',
        'literature_distributed',
        'certificates_delivered',
        'members_have_booklet',
        'booklet_requirements_signed',
      ],
      ['club_participation_description', 'community_service_description'],
    ],
    [
      'quarterly',
      UpdateQuarterlyManualDataDto,
      ['certificates_delivered'],
      ['club_participation_description', 'community_service_description'],
    ],
    [
      'annual',
      UpdateAnnualManualDataDto,
      ['all_investitures_completed'],
      ['annual_achievements_description', 'community_service_description'],
    ],
  ] as Array<[string, Ctor<object>, string[], string[]]>)(
    '%s manual-data DTO',
    (_label, cls, booleans, strings) => {
      const fields = intFields(cls, booleans, strings);

      it('has integer fields to check', () => {
        expect(fields.length).toBeGreaterThan(0);
      });

      it.each(fields)('rejects %s above int4', async (field) => {
        expect(await failingProps(cls, { [field]: OVERFLOW })).toEqual([field]);
      });

      it.each(fields)('accepts %s at int4 max', async (field) => {
        expect(await failingProps(cls, { [field]: INT4_MAX })).toEqual([]);
      });
    },
  );
});
