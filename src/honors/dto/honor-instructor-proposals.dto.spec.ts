import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ListHonorInstructorProposalsDto,
  ProposeHonorInstructorDto,
  RejectHonorInstructorProposalDto,
} from './honor-instructor-proposals.dto';

const ANA = '7d1f6c52-5a6f-4b8a-9d57-6f6b1a2f3c11';

async function run<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    messages: Object.fromEntries(
      errors.map((error) => [
        error.property,
        Object.keys(error.constraints ?? {}),
      ]),
    ),
  };
}

describe('honor instructor proposal DTOs (B9)', () => {
  describe('ProposeHonorInstructorDto', () => {
    it('passes the shape check with none of the two: REQUIRED/AMBIGUOUS belong to the service', async () => {
      await expect(run(ProposeHonorInstructorDto, {})).resolves.toMatchObject({
        messages: {},
      });
      await expect(
        run(ProposeHonorInstructorDto, {
          instructorUserId: ANA,
          instructorName: 'Ana Pérez',
        }),
      ).resolves.toMatchObject({ messages: {} });
    });

    it('accepts a uuid and a 3..150 char name, trimming and collapsing spaces', async () => {
      const { dto, messages } = await run(ProposeHonorInstructorDto, {
        instructorUserId: ANA,
        instructorName: '  Juan   López  ',
      });
      expect(messages).toEqual({});
      expect(dto.instructorName).toBe('Juan López');
    });

    it('rejects an invalid uuid', async () => {
      const { messages } = await run(ProposeHonorInstructorDto, {
        instructorUserId: 'no-uuid',
      });
      expect(Object.keys(messages)).toEqual(['instructorUserId']);
    });

    it.each([
      ['ab'],
      ['a'.repeat(151)],
      ['Juan\u0007 López'],
      ['  ab  '],
      [42],
    ])('rejects the name %j', async (instructorName) => {
      const { messages } = await run(ProposeHonorInstructorDto, {
        instructorName,
      });
      expect(Object.keys(messages)).toEqual(['instructorName']);
    });

    it('accepts names of exactly 3 and 150 characters', async () => {
      for (const instructorName of ['Ana', 'a'.repeat(150)]) {
        await expect(
          run(ProposeHonorInstructorDto, { instructorName }),
        ).resolves.toMatchObject({ messages: {} });
      }
    });

    it('rejects unknown properties (snake_case is not accepted on this controller)', async () => {
      const { messages } = await run(ProposeHonorInstructorDto, {
        instructor_name: 'Ana Pérez',
      });
      expect(Object.keys(messages)).toEqual(['instructor_name']);
    });
  });

  describe('RejectHonorInstructorProposalDto', () => {
    it('requires the reason', async () => {
      const { messages } = await run(RejectHonorInstructorProposalDto, {});
      expect(Object.keys(messages)).toEqual(['reason']);
    });

    it.each([[''], ['  '], ['ab'], ['  ab  '], ['a'.repeat(501)], [null], [7]])(
      'rejects the reason %j',
      async (reason) => {
        const { messages } = await run(RejectHonorInstructorProposalDto, {
          reason,
        });
        expect(Object.keys(messages)).toEqual(['reason']);
      },
    );

    it('accepts 3 and 500 characters and trims the text', async () => {
      const short = await run(RejectHonorInstructorProposalDto, {
        reason: '  No  ',
      });
      // "No" tiene 2: el recorte se aplica ANTES de medir.
      expect(Object.keys(short.messages)).toEqual(['reason']);

      for (const reason of ['Nop', 'a'.repeat(500)]) {
        await expect(
          run(RejectHonorInstructorProposalDto, { reason: ` ${reason} ` }),
        ).resolves.toMatchObject({ messages: {} });
      }
    });
  });

  describe('ListHonorInstructorProposalsDto', () => {
    it('defaults and accepts the three queue statuses', async () => {
      for (const status of ['PENDING', 'APPROVED', 'REJECTED', undefined]) {
        await expect(
          run(ListHonorInstructorProposalsDto, { status }),
        ).resolves.toMatchObject({ messages: {} });
      }
    });

    it('rejects WITHDRAWN and unknown statuses, and bad pagination', async () => {
      for (const body of [
        { status: 'WITHDRAWN' },
        { status: 'pending' },
        { page: '0' },
        { limit: '101' },
      ]) {
        const { messages } = await run(ListHonorInstructorProposalsDto, body);
        expect(Object.keys(messages)).toHaveLength(1);
      }
    });
  });
});
