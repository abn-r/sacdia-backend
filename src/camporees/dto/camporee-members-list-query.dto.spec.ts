import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CamporeeMembersListQueryDto } from './camporee-members-list-query.dto';

describe('CamporeeMembersListQueryDto', () => {
  it('should fail validation when limit is 101 (exceeds Max 100)', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, { limit: 101 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should pass validation when limit is 100 (at boundary)', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, { limit: 100 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should pass validation when limit is 1 (minimum)', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, { limit: 1 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should fail validation when limit is 0 (below Min 1)', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, { limit: 0 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should apply default limit of 50 when no limit is provided', () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, {});
    expect(dto.limit).toBe(50);
  });

  it('should accept page, limit, and status together without errors', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, {
      page: 1,
      limit: 50,
      status: 'approved',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('approved');
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(50);
  });

  it('should reject an invalid status value', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, {
      status: 'not-a-valid-status',
    });
    const errors = await validate(dto);
    const statusErrors = errors.filter((e) => e.property === 'status');
    expect(statusErrors.length).toBeGreaterThan(0);
  });

  it('should allow status to be optional', async () => {
    const dto = plainToInstance(CamporeeMembersListQueryDto, {
      page: 2,
      limit: 25,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBeUndefined();
  });
});
