import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UnionMembersListQueryDto } from './union-members-list-query.dto';

describe('UnionMembersListQueryDto', () => {
  it('should fail validation when limit is 201 (exceeds Max 200)', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, { limit: 201 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should pass validation when limit is 200 (at boundary)', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, { limit: 200 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should pass validation when limit is 1 (minimum)', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, { limit: 1 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should fail validation when limit is 0 (below Min 1)', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, { limit: 0 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should apply default limit of 100 when no limit is provided', () => {
    const dto = plainToInstance(UnionMembersListQueryDto, {});
    expect(dto.limit).toBe(100);
  });

  it('should accept page, limit, and status together without errors', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, {
      page: 1,
      limit: 100,
      status: 'approved',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('approved');
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(100);
  });

  it('should reject an invalid status value', async () => {
    const dto = plainToInstance(UnionMembersListQueryDto, {
      status: 'not-a-valid-status',
    });
    const errors = await validate(dto);
    const statusErrors = errors.filter((e) => e.property === 'status');
    expect(statusErrors.length).toBeGreaterThan(0);
  });
});
