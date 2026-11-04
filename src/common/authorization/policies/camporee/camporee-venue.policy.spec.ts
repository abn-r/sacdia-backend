import { ErrorCode } from '../../../errors/error-codes';
import { TerritoryScopeValidator } from '../scope/territory-scope';
import {
  buildAuthorizationContext,
  buildCtx,
  buildHierarchy,
} from '../scope/territory-scope.testing';
import { CamporeeVenuePolicy } from './camporee-venue.policy';

describe('CamporeeVenuePolicy', () => {
  const build = (venue: unknown, canAccess: boolean) => {
    const prisma = {
      camporee_venues: { findUnique: jest.fn().mockResolvedValue(venue) },
      unions: {
        findUnique: jest.fn().mockResolvedValue({ country_id: 9 }),
      },
      local_fields: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ union_id: 2, unions: { country_id: 9 } }),
      },
      union_camporee_local_fields: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const hierarchy = buildHierarchy();
    return new CamporeeVenuePolicy(
      prisma,
      hierarchy,
      new TerritoryScopeValidator(
        buildAuthorizationContext(canAccess),
        prisma,
        hierarchy,
      ),
    );
  };
  const byId = () =>
    buildCtx(
      { type: 'camporee_venue', idParam: 'venueId' },
      { params: { venueId: '6' } },
    );
  const byBody = (body: unknown) =>
    buildCtx(
      { type: 'camporee_venue', idParam: 'venueId' },
      { params: {}, body },
    );
  const localVenue = {
    scope: 'local_field',
    union_id: null,
    local_field_id: 3,
  };
  const unionVenue = { scope: 'union', union_id: 2, local_field_id: null };

  it('handles the camporee_venue resource type', () => {
    expect(build(localVenue, true).type).toBe('camporee_venue');
  });

  it('throws 404 when the venue does not exist', async () => {
    await expect(build(null, true).resolve(byId())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CAMPOREE_VENUE_NOT_FOUND,
    });
  });

  it('local_field venue: allows through the hierarchy scope', async () => {
    await expect(build(localVenue, true).resolve(byId())).resolves.toBe(true);
  });

  it('union venue: denies with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build(unionVenue, false).resolve(byId()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('union venue: allows through the hierarchy scope', async () => {
    await expect(build(unionVenue, true).resolve(byId())).resolves.toBe(true);
  });

  it('body fallback: reads scope and local_field_id from the body', async () => {
    const policy = build(null, true);
    await expect(
      policy.resolve(byBody({ scope: 'local_field', local_field_id: 3 })),
    ).resolves.toBe(true);
  });

  it('body fallback: reads scope and union_id from the body', async () => {
    const policy = build(null, true);
    await expect(
      policy.resolve(byBody({ scope: 'union', union_id: 2 })),
    ).resolves.toBe(true);
  });

  it('body fallback: denies when the body scope is missing or incomplete', async () => {
    const policy = build(null, true);
    await expect(policy.resolve(byBody({}))).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
    await expect(
      policy.resolve(byBody({ scope: 'union' })),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
