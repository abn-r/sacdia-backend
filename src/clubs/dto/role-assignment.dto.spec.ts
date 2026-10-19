import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRoleAssignmentDto } from './role-assignment.dto';

describe('UpdateRoleAssignmentDto.status (PATCH /club-roles/:assignmentId)', () => {
  const errorsFor = async (status: unknown) =>
    validate(plainToInstance(UpdateRoleAssignmentDto, { status }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it.each([
    'active',
    'inactive',
    'pending',
    'rejected',
    'expired',
    'cancelled',
    'ended',
    'designated',
  ])('accepts the assignment status %s', async (status) => {
    expect(await errorsFor(status)).toEqual([]);
  });

  it.each(['ACTIVE', 'approved', 'activ', '', 'active ', 'suspended'])(
    'rejects %p: status is validated against the enum, not a free string',
    async (status) => {
      const errors = await errorsFor(status);
      expect(errors.map((error) => error.property)).toEqual(['status']);
    },
  );

  it('keeps status optional', async () => {
    expect(
      await validate(plainToInstance(UpdateRoleAssignmentDto, {}), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
  });
});
