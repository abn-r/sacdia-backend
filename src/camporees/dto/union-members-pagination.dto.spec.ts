import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UnionMembersPaginationDto } from './union-members-pagination.dto';

describe('UnionMembersPaginationDto', () => {
  it('should fail validation when limit is 201 (exceeds Max 200)', async () => {
    const dto = plainToInstance(UnionMembersPaginationDto, { limit: 201 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should pass validation when limit is 200 (at boundary)', async () => {
    const dto = plainToInstance(UnionMembersPaginationDto, { limit: 200 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should pass validation when limit is 1 (minimum)', async () => {
    const dto = plainToInstance(UnionMembersPaginationDto, { limit: 1 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should fail validation when limit is 0 (below Min 1)', async () => {
    const dto = plainToInstance(UnionMembersPaginationDto, { limit: 0 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });
});
