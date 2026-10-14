import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SocialAccountResolver } from './social-account.resolver';
import type { VerifiedIdentity } from './social-sign-in.types';

describe('SocialAccountResolver', () => {
  let resolver: SocialAccountResolver;

  const tx = {
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    session: { deleteMany: jest.fn() },
    users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    users_pr: { findUnique: jest.fn(), create: jest.fn() },
    users_roles: { findFirst: jest.fn(), create: jest.fn() },
    roles: { findFirst: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };

  const identity: VerifiedIdentity = {
    provider: 'google',
    sub: 'google-sub-1',
    email: 'ana@example.com',
    emailVerified: true,
    givenName: 'Ana',
    familyName: 'Pérez',
    picture: 'https://lh3.googleusercontent.com/a/photo',
  };
  const existingUser = {
    user_id: 'user-1',
    email: 'ana@example.com',
    email_verified: true,
    user_image: null,
    active: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    );
    tx.users_pr.findUnique.mockResolvedValue({ user_id: 'user-1' });
    tx.users_roles.findFirst.mockResolvedValue({ user_id: 'user-1' });

    const module = await Test.createTestingModule({
      providers: [
        SocialAccountResolver,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    resolver = module.get(SocialAccountResolver);
  });

  it('returns the linked user when (provider, sub) already exists', async () => {
    tx.account.findUnique.mockResolvedValue({ userId: 'user-1' });
    tx.users.findUnique.mockResolvedValue(existingUser);

    await expect(resolver.resolve(identity)).resolves.toEqual({
      userId: 'user-1',
      created: false,
      linked: false,
      revokedPriorAccess: false,
    });
    expect(tx.account.findUnique).toHaveBeenCalledWith({
      where: {
        providerId_accountId: {
          providerId: 'google',
          accountId: 'google-sub-1',
        },
      },
      select: { userId: true },
    });
    expect(tx.account.create).not.toHaveBeenCalled();
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      data: { user_image: identity.picture },
    });
  });

  it('links by email when the account is new and the email exists', async () => {
    tx.account.findUnique.mockResolvedValue(null);
    tx.users.findUnique.mockResolvedValue(existingUser);

    await expect(resolver.resolve(identity)).resolves.toEqual({
      userId: 'user-1',
      created: false,
      linked: true,
      revokedPriorAccess: false,
    });
    expect(tx.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'google-sub-1',
        providerId: 'google',
        userId: 'user-1',
      }),
    });
    expect(tx.account.deleteMany).not.toHaveBeenCalled();
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes sessions and every prior account when linking to an unverified local account', async () => {
    tx.account.findUnique.mockResolvedValue(null);
    tx.users.findUnique.mockResolvedValue({
      ...existingUser,
      email_verified: false,
    });
    const order: string[] = [];
    tx.session.deleteMany.mockImplementation(async () => {
      order.push('sessions');
    });
    tx.account.deleteMany.mockImplementation(async () => {
      order.push('accounts');
    });
    tx.account.create.mockImplementation(async () => {
      order.push('create');
    });

    await expect(resolver.resolve(identity)).resolves.toEqual({
      userId: 'user-1',
      created: false,
      linked: true,
      revokedPriorAccess: true,
    });

    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(order).toEqual(['sessions', 'accounts', 'create']);
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      data: expect.objectContaining({ email_verified: true }),
    });
  });

  it('creates the user, the account and the SACDIA rows when nothing matches', async () => {
    tx.account.findUnique.mockResolvedValue(null);
    tx.users.findUnique.mockResolvedValue(null);
    tx.users.create.mockImplementation(
      async ({ data }: { data: { user_id: string } }) => data,
    );
    tx.users_pr.findUnique.mockResolvedValue(null);
    tx.users_roles.findFirst.mockResolvedValue(null);
    tx.roles.findFirst.mockResolvedValue({ role_id: 7 });

    const result = await resolver.resolve(identity);

    expect(result).toMatchObject({
      created: true,
      linked: false,
      revokedPriorAccess: false,
    });
    expect(tx.users.create).toHaveBeenCalledWith({
      data: {
        user_id: result.userId,
        email: 'ana@example.com',
        name: 'Ana',
        paternal_last_name: 'Pérez',
        email_verified: true,
        user_image: identity.picture,
      },
    });
    expect(tx.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: result.userId,
        providerId: 'google',
      }),
    });
    expect(tx.users_pr.create).toHaveBeenCalledWith({
      data: {
        user_id: result.userId,
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
      },
    });
    expect(tx.users_roles.create).toHaveBeenCalledWith({
      data: { user_id: result.userId, role_id: 7 },
    });
  });

  it('falls back to the email local part when no name is available', async () => {
    tx.account.findUnique.mockResolvedValue(null);
    tx.users.findUnique.mockResolvedValue(null);
    tx.users.create.mockImplementation(
      async ({ data }: { data: { user_id: string } }) => data,
    );

    await resolver.resolve({
      provider: 'apple',
      sub: 'apple-sub',
      email: 'ana@example.com',
      emailVerified: true,
    });

    expect(tx.users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'ana', paternal_last_name: null }),
    });
  });

  it('truncates names to the 50-char columns', async () => {
    tx.account.findUnique.mockResolvedValue(null);
    tx.users.findUnique.mockResolvedValue(null);
    tx.users.create.mockImplementation(
      async ({ data }: { data: { user_id: string } }) => data,
    );

    await resolver.resolve({ ...identity, givenName: 'x'.repeat(80) });

    expect(tx.users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'x'.repeat(50) }),
    });
  });

  it('runs everything inside one transaction', async () => {
    tx.account.findUnique.mockResolvedValue({ userId: 'user-1' });
    tx.users.findUnique.mockResolvedValue(existingUser);
    await resolver.resolve(identity);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
