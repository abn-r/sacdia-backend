import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminListUsersQueryDto } from './users.dto';

describe('AdminListUsersQueryDto', () => {
  it('rejects an invalid sortBy with a validation error (HTTP 400 at the pipe)', async () => {
    const dto = plainToInstance(AdminListUsersQueryDto, { sortBy: 'email' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortBy')).toBe(true);
  });

  it('rejects an invalid sortOrder with a validation error (HTTP 400 at the pipe)', async () => {
    const dto = plainToInstance(AdminListUsersQueryDto, { sortOrder: 'up' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sortOrder')).toBe(true);
  });

  it('accepts sortBy=name and sortOrder=asc', async () => {
    const dto = plainToInstance(AdminListUsersQueryDto, {
      sortBy: 'name',
      sortOrder: 'asc',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
