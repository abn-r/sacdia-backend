import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { InstructorCandidatesController } from './instructor-candidates.controller';
import { SearchInstructorCandidatesDto } from './dto/search-instructor-candidates.dto';

// Claves internas de @nestjs/throttler (no se exportan desde el índice).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

describe('InstructorCandidatesController', () => {
  const instructors = { searchCandidates: jest.fn() };
  const controller = new InstructorCandidatesController(instructors as never);
  const handler = InstructorCandidatesController.prototype.search;

  beforeEach(() => jest.clearAllMocks());

  it('delegates with the authenticated user and wraps the data', async () => {
    instructors.searchCandidates.mockResolvedValue([{ user_id: 'u-2' }]);

    const result = await controller.search(
      { user: { sub: 'u-1' } },
      { q: 'ana' },
    );

    expect(instructors.searchCandidates).toHaveBeenCalledWith('u-1', 'ana');
    expect(result).toEqual({ status: 'success', data: [{ user_id: 'u-2' }] });
  });

  it('is GET /instructor-candidates, authenticated, outside RBAC permissions', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, InstructorCandidatesController),
    ).toBe('instructor-candidates');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(
      Reflect.getMetadata(SKIP_PERMISSIONS_KEY, InstructorCandidatesController),
    ).toBe(true);
    expect(
      Reflect.getMetadata('__guards__', InstructorCandidatesController),
    ).toHaveLength(1);
  });

  it('rate limits to 30 requests per minute on every configured tier', () => {
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}${tier}`, handler)).toBe(
        30,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}${tier}`, handler)).toBe(
        60_000,
      );
    }
  });

  describe('query DTO', () => {
    const run = async (q: unknown) => {
      const dto = plainToInstance(SearchInstructorCandidatesDto, { q });
      return { dto, errors: await validate(dto) };
    };

    it('accepts a missing or short q (the service answers [])', async () => {
      await expect(run(undefined)).resolves.toMatchObject({ errors: [] });
      await expect(run('a')).resolves.toMatchObject({ errors: [] });
    });

    it('trims q and caps it at 100 characters', async () => {
      expect((await run('  ana  ')).dto.q).toBe('ana');
      expect((await run('a'.repeat(101))).errors).toHaveLength(1);
    });
  });
});
