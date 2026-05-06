import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { QrService } from './qr.service';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { StorageBucketAlias } from '../common/services/file-storage.service';

describe('QrService', () => {
  let service: QrService;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(),
  };

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    activities: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    enrollments: {
      findFirst: jest.fn(),
    },
    emergency_contacts: {
      findFirst: jest.fn(),
    },
  };

  const mockAchievementsService = {
    emitEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        QrService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AchievementsService, useValue: mockAchievementsService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
      ],
    }).compile();

    service = moduleRef.get(QrService);
  });

  it('builds a self QR payload with signed avatar and canonical authorization', async () => {
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      profile: {
        user_id: 'user-1',
        email: 'member@sacdia.app',
        name: 'Juan',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'Gómez',
        user_image: 'user-profiles/avatar.png',
      },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: 'assignment-1' },
        effective: {
          permissions: ['qr:issue_self'],
          scope: { global: {}, club: null },
        },
      },
      legacy: {
        club: {
          club_id: 7,
          club_name: 'Club Test',
          club_type: 'Pathfinders',
        },
        club_context: {
          active_assignment_id: 'assignment-1',
          active: {
            assignment_id: 'assignment-1',
            role_name: 'member',
            club_section_id: 22,
            club_id: 7,
            club_name: 'Club Test',
            club_type: 'Pathfinders',
          },
          available: [],
        },
        permissions: ['qr:issue_self'],
        roles: ['user'],
      },
      post_register_complete: true,
    });
    mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(
      'https://signed.example/avatar.png',
    );
    mockJwtService.sign.mockReturnValue('jwt-qr-token');
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: {
        name: 'Pathfinders',
        clubs: { name: 'Club Test' },
      },
    });

    const result = await service.getMyQr('user-1');

    expect(
      mockAuthorizationContextService.resolveUserAuthorization,
    ).toHaveBeenCalledWith('user-1');
    expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.USER_PROFILES,
      'user-profiles/avatar.png',
      expect.objectContaining({ expiresInSeconds: expect.any(Number) }),
    );
    expect(mockJwtService.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      aud: 'sacdia:qr-member',
      ver: 1,
    });
    expect(result).toEqual({
      token: 'jwt-qr-token',
      expires_in: 86400,
      expires_at: expect.any(String),
      member: {
        user_id: 'user-1',
        full_name: 'Juan Pérez Gómez',
        avatar: 'https://signed.example/avatar.png',
        club_name: 'Club Test',
        section_name: 'Pathfinders',
        current_class: null,
        blood_type: null,
        emergency_contact: null,
      },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: 'assignment-1' },
        effective: {
          permissions: ['qr:issue_self'],
          scope: { global: {}, club: null },
        },
      },
    });
  });

  it('builds a card payload with the QR token and visual data', async () => {
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      profile: {
        user_id: 'user-1',
        email: 'member@sacdia.app',
        name: 'Juan',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
      },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['qr:issue_self'],
          scope: { global: {}, club: null },
        },
      },
      legacy: {
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
        permissions: ['qr:issue_self'],
        roles: ['user'],
      },
      post_register_complete: false,
    });
    mockJwtService.sign.mockReturnValue('jwt-qr-token');
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({ blood: 'O+' });
    mockPrismaService.enrollments.findFirst.mockResolvedValue({
      classes: { name: 'Conquistador' },
    });
    mockPrismaService.emergency_contacts.findFirst.mockResolvedValue({
      name: 'María García',
      phone: '+1234567890',
      relationship_types: { name: 'Madre' },
    });

    const result = await service.getMyCard('user-1');

    expect(result).toEqual({
      token: 'jwt-qr-token',
      expires_in: 86400,
      expires_at: expect.any(String),
      member: {
        user_id: 'user-1',
        full_name: 'Juan',
        avatar: null,
        club_name: null,
        section_name: null,
        current_class: 'Conquistador',
        blood_type: 'O+',
        emergency_contact: {
          name: 'María García',
          phone: '+1234567890',
          relationship: 'Madre',
        },
      },
      visual: {
        title: 'SACDIA',
        subtitle: 'Credencial virtual',
        primary_line: 'Juan',
        secondary_line: 'member@sacdia.app',
        club_name: null,
        section_name: null,
      },
    });
  });

  it('returns null for card extras when no enrollment or emergency contact exists', async () => {
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      profile: {
        user_id: 'user-2',
        email: 'new@sacdia.app',
        name: 'Pedro',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
      },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['qr:issue_self'],
          scope: { global: {}, club: null },
        },
      },
      legacy: {
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
        permissions: ['qr:issue_self'],
        roles: ['user'],
      },
      post_register_complete: false,
    });
    mockJwtService.sign.mockReturnValue('jwt-qr-token-2');
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({ blood: null });
    mockPrismaService.enrollments.findFirst.mockResolvedValue(null);
    mockPrismaService.emergency_contacts.findFirst.mockResolvedValue(null);

    const result = await service.getMyCard('user-2');

    expect(result.member.current_class).toBeNull();
    expect(result.member.blood_type).toBeNull();
    expect(result.member.emergency_contact).toBeNull();
  });

  it('generates a PDF buffer for the card', async () => {
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue({
      profile: {
        user_id: 'user-1',
        email: 'member@sacdia.app',
        name: 'Juan',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
      },
      authorization: {
        grants: { global_roles: [], club_assignments: [] },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['qr:issue_self'],
          scope: { global: {}, club: null },
        },
      },
      legacy: {
        club: null,
        club_context: {
          active_assignment_id: null,
          active: null,
          available: [],
        },
        permissions: ['qr:issue_self'],
        roles: ['user'],
      },
      post_register_complete: false,
    });
    mockJwtService.sign.mockReturnValue('jwt-qr-token');
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({ blood: null });
    mockPrismaService.enrollments.findFirst.mockResolvedValue(null);
    mockPrismaService.emergency_contacts.findFirst.mockResolvedValue(null);

    const buffer = await service.generateMyCardPdf('user-1');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('returns canonical validation results and keeps the legacy scan shape', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'member-1',
      aud: 'sacdia:qr-member',
      ver: 1,
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-1',
      name: 'Ana',
      paternal_last_name: 'Lopez',
      maternal_last_name: null,
      user_image: null,
      club_role_assignments: [
        {
          club_sections: {
            name: 'Pathfinders',
            clubs: { name: 'Club Norte' },
          },
        },
      ],
    });
    mockPrismaService.activities.findUnique.mockResolvedValue(null);

    await expect(
      service.validateMemberQr('jwt-qr-token', 'validator-1'),
    ).resolves.toMatchObject({
      valid: true,
      member: {
        user_id: 'member-1',
        full_name: 'Ana Lopez',
        club_name: 'Club Norte',
        section_name: 'Pathfinders',
      },
      attendance: null,
      scanned_at: expect.any(String),
    });

    await expect(
      service.scanMemberToken('jwt-qr-token', 'validator-1'),
    ).resolves.toMatchObject({
      member: {
        user_id: 'member-1',
        full_name: 'Ana Lopez',
      },
      attendance: null,
      scanned_at: expect.any(String),
    });
  });

  it('does not expose a raw avatar path when signing fails during validation', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'member-1',
      aud: 'sacdia:qr-member',
      ver: 1,
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-1',
      name: 'Ana',
      paternal_last_name: 'Lopez',
      maternal_last_name: null,
      user_image: 'user-profiles/private.png',
      club_role_assignments: [],
    });
    mockFileStorageService.getSignedDownloadUrl.mockRejectedValue(
      new Error('storage unavailable'),
    );

    await expect(
      service.validateMemberQr('jwt-qr-token', 'validator-1'),
    ).resolves.toMatchObject({
      valid: true,
      member: {
        user_id: 'member-1',
        avatar: null,
      },
    });
  });
});
