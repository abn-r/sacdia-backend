import { ErrorCode } from '../errors/error-codes';
import { SectionRoleMutationPolicy } from './section-role-mutation.policy';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const SECTION = 7;
const CLUB_LOCAL_FIELD = 5;

type ActorSetup = {
  globalRoles?: string[];
  localFieldId?: number;
  club?: Array<{
    role_name: string;
    section: number;
    operational?: boolean;
  }>;
};

function setup(actor: ActorSetup) {
  const resolveUserAuthorization = jest.fn().mockResolvedValue({
    authorization: {
      grants: {
        global_roles: (actor.globalRoles ?? []).map((role_name) => ({
          role_name,
          permissions: [],
          scope: {},
        })),
        club_assignments: (actor.club ?? []).map((g) => ({
          assignment_id: 'a',
          role_name: g.role_name,
          operational: g.operational ?? true,
          section: { club_section_id: g.section },
        })),
        direct_permissions: [],
      },
      effective: {
        scope: {
          global:
            actor.localFieldId === undefined
              ? {}
              : { local_field: { id: actor.localFieldId } },
          club: null,
        },
      },
    },
  });
  const findUnique = jest
    .fn()
    .mockResolvedValue({ clubs: { local_field_id: CLUB_LOCAL_FIELD } });
  const policy = new SectionRoleMutationPolicy(
    { resolveUserAuthorization } as never,
    { club_sections: { findUnique } } as never,
  );
  return { policy, resolveUserAuthorization, findUnique };
}

const input = (
  over: Partial<
    Parameters<SectionRoleMutationPolicy['assertCanMutate']>[0]
  > = {},
) => ({
  actorUserId: ACTOR,
  clubSectionId: SECTION,
  targetRoleName: 'secretary',
  targetUserId: TARGET,
  mutation: 'assign' as const,
  ...over,
});

describe('SectionRoleMutationPolicy', () => {
  const allowed: Array<[string, ActorSetup]> = [
    ['super-admin', { globalRoles: ['super-admin'] }],
    ['admin', { globalRoles: ['admin'] }],
    [
      'director-lf of the same local field',
      { globalRoles: ['director-lf'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'assistant-lf of the same local field',
      { globalRoles: ['assistant-lf'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'director of the same section',
      { club: [{ role_name: 'director', section: SECTION }] },
    ],
  ];

  it.each(allowed)('allows %s', async (_name, actor) => {
    const { policy } = setup(actor);
    await expect(policy.assertCanMutate(input())).resolves.toBeUndefined();
  });

  const denied: Array<[string, ActorSetup]> = [
    ['assistant-admin', { globalRoles: ['assistant-admin'] }],
    [
      'director-lf of another local field',
      { globalRoles: ['director-lf'], localFieldId: 99 },
    ],
    ['director-lf without local field scope', { globalRoles: ['director-lf'] }],
    [
      'director-union',
      { globalRoles: ['director-union'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'assistant-union',
      { globalRoles: ['assistant-union'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'director-dia',
      { globalRoles: ['director-dia'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'assistant-dia',
      { globalRoles: ['assistant-dia'], localFieldId: CLUB_LOCAL_FIELD },
    ],
    [
      'director of another section',
      { club: [{ role_name: 'director', section: 8 }] },
    ],
    [
      'non-operational director of the same section',
      {
        club: [{ role_name: 'director', section: SECTION, operational: false }],
      },
    ],
    [
      'deputy-director of the same section',
      { club: [{ role_name: 'deputy-director', section: SECTION }] },
    ],
    [
      'secretary of the same section',
      { club: [{ role_name: 'secretary', section: SECTION }] },
    ],
    ['an actor without grants', {}],
  ];

  it.each(denied)('denies %s', async (_name, actor) => {
    const { policy } = setup(actor);
    await expect(policy.assertCanMutate(input())).rejects.toMatchObject({
      code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN,
      status: 403,
    });
  });

  it('denies a section director acting on themselves', async () => {
    const { policy } = setup({
      club: [{ role_name: 'director', section: SECTION }],
    });
    await expect(
      policy.assertCanMutate(input({ targetUserId: ACTOR })),
    ).rejects.toMatchObject({ code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN });
  });

  it('denies a section director assigning director', async () => {
    const { policy } = setup({
      club: [{ role_name: 'director', section: SECTION }],
    });
    await expect(
      policy.assertCanMutate(input({ targetRoleName: 'director' })),
    ).rejects.toMatchObject({ code: ErrorCode.CLUB_ROLE_MUTATION_FORBIDDEN });
  });

  it('still lets the local field director designate a director', async () => {
    const { policy } = setup({
      globalRoles: ['director-lf'],
      localFieldId: CLUB_LOCAL_FIELD,
    });
    await expect(
      policy.assertCanMutate(
        input({ targetRoleName: 'director', targetUserId: ACTOR }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each(['assign', 'update', 'revoke'] as const)(
    'passes member (%s) without resolving anything',
    async (mutation) => {
      const { policy, resolveUserAuthorization, findUnique } = setup({});
      await expect(
        policy.assertCanMutate(input({ targetRoleName: 'member', mutation })),
      ).resolves.toBeUndefined();
      expect(resolveUserAuthorization).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('does not read the club when a global admin acts', async () => {
    const { policy, findUnique } = setup({ globalRoles: ['admin'] });
    await policy.assertCanMutate(input());
    expect(findUnique).not.toHaveBeenCalled();
  });
});
