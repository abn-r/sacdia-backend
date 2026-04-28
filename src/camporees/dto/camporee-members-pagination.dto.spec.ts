import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CamporeeMembersPaginationDto } from './camporee-members-pagination.dto';

describe('CamporeeMembersPaginationDto', () => {
  it('should fail validation when limit is 101 (exceeds Max 100)', async () => {
    const dto = plainToInstance(CamporeeMembersPaginationDto, { limit: 101 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should pass validation when limit is 100 (at boundary)', async () => {
    const dto = plainToInstance(CamporeeMembersPaginationDto, { limit: 100 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should pass validation when limit is 1 (minimum)', async () => {
    const dto = plainToInstance(CamporeeMembersPaginationDto, { limit: 1 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should fail validation when limit is 0 (below Min 1)', async () => {
    const dto = plainToInstance(CamporeeMembersPaginationDto, { limit: 0 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should apply default limit of 50 when no limit is provided', () => {
    const dto = plainToInstance(CamporeeMembersPaginationDto, {});
    expect(dto.limit).toBe(50);
  });
});
