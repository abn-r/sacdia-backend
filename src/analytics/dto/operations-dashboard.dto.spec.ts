import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DECORATORS } from '@nestjs/swagger';
import {
  HonorsMetricsDto,
  MonthlyReportsMetricsDto,
  OperationsDashboardQueryDto,
  OperationsDashboardScopeDto,
  OperationsMetricsDto,
  QueuesMetricsDto,
} from './operations-dashboard.dto';

describe('OperationsDashboardQueryDto', () => {
  const validateQuery = async (query: Record<string, unknown>) => {
    const dto = plainToInstance(OperationsDashboardQueryDto, query);
    return { dto, errors: await validate(dto) };
  };

  it('accepts omitted filters and transforms positive integer query strings', async () => {
    const empty = await validateQuery({});
    expect(empty.errors).toHaveLength(0);

    const populated = await validateQuery({
      ecclesiastical_year_id: '7',
      division_id: '1',
      union_id: '2',
      local_field_id: '3',
      report_year: '2026',
      report_month: '6',
    });

    expect(populated.errors).toHaveLength(0);
    expect(populated.dto).toMatchObject({
      ecclesiastical_year_id: 7,
      division_id: 1,
      union_id: 2,
      local_field_id: 3,
      report_year: 2026,
      report_month: 6,
    });
  });

  it.each([
    ['ecclesiastical_year_id', 0],
    ['division_id', -1],
    ['union_id', 0],
    ['local_field_id', 1.5],
  ])('rejects invalid positive integer %s', async (field, value) => {
    const { errors } = await validateQuery({ [field]: value });
    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('requires report_year and report_month together', async () => {
    const yearOnly = await validateQuery({ report_year: 2026 });
    const monthOnly = await validateQuery({ report_month: 6 });

    expect(
      yearOnly.errors.some((error) => error.property === 'report_month'),
    ).toBe(true);
    expect(
      monthOnly.errors.some((error) => error.property === 'report_year'),
    ).toBe(true);
  });

  it.each([0, 13, 1.5])('rejects invalid report_month %s', async (month) => {
    const { errors } = await validateQuery({
      report_year: 2026,
      report_month: month,
    });

    expect(errors.some((error) => error.property === 'report_month')).toBe(
      true,
    );
  });
});

describe('Operations dashboard response DTO metadata', () => {
  it.each([
    [OperationsDashboardScopeDto, 'id'],
    [OperationsMetricsDto, 'operational_rate_pct'],
    [MonthlyReportsMetricsDto, 'coverage_pct'],
    [HonorsMetricsDto, 'in_progress'],
    [HonorsMetricsDto, 'pending_review'],
    [HonorsMetricsDto, 'approved'],
    [QueuesMetricsDto, 'honors_review_pending'],
  ])(
    'documents %s.%s as a nullable numeric scalar',
    (dtoClass, propertyName) => {
      const metadata = Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        dtoClass.prototype,
        propertyName,
      );

      expect(metadata).toEqual(
        expect.objectContaining({ type: Number, nullable: true }),
      );
    },
  );
});
