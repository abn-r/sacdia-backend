import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/common/guards';
import { EvidenceFolderService } from '../src/folders/evidence-folder.service';
import {
  createBearerToken,
  createTestJwtService,
} from './helpers/rbac-test-helpers';

const TEST_USER_ID = 'user-evidence-1';

@Injectable()
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = {
      sub: TEST_USER_ID,
      email: 'evidence@test.local',
    };
    return true;
  }
}

describe('Evidence Folder E2E', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockEvidenceFolderService = {
    getFolder: jest.fn(),
    submitSection: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  };

  const makeToken = (sub: string, email: string) =>
    createBearerToken(jwtService, sub, email);

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;

    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'test-secret';

    jwtService = createTestJwtService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EvidenceFolderService)
      .useValue(mockEvidenceFolderService)
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GET /club-sections/:sectionId/evidence-folder returns the mapped folder structure', async () => {
    mockEvidenceFolderService.getFolder.mockResolvedValue({
      folder_id: 1,
      folder_name: 'Carpeta de Evidencias 2026',
      description: 'Ruta de evidencias',
      is_open: true,
      total_points: 100,
      total_percentage: 0.75,
      sections: [
        {
          section_id: 10,
          name: 'Requisitos básicos',
          status: 'pendiente',
          max_points: 20,
          earned_points: 0,
          submitted_by_name: null,
          submitted_at: null,
          validated_by_name: null,
          validated_at: null,
          files: [],
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/club-sections/42/evidence-folder')
      .set(
        'Authorization',
        `Bearer ${makeToken(TEST_USER_ID, 'evidence@test.local')}`,
      )
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.data.folder_id).toBe(1);
    expect(response.body.data.sections).toHaveLength(1);
    expect(mockEvidenceFolderService.getFolder).toHaveBeenCalledWith(
      TEST_USER_ID,
      42,
    );
  });

  it('POST /club-sections/:sectionId/evidence-folder/sections/:efSectionId/submit submits a section', async () => {
    mockEvidenceFolderService.submitSection.mockResolvedValue({
      folder_section_record_id: 10,
      status: 'enviado',
      submitted_by_id: TEST_USER_ID,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/club-sections/42/evidence-folder/sections/7/submit')
      .set(
        'Authorization',
        `Bearer ${makeToken(TEST_USER_ID, 'evidence@test.local')}`,
      )
      .expect(201);

    expect(response.body.status).toBe('success');
    expect(response.body.data.status).toBe('enviado');
    expect(mockEvidenceFolderService.submitSection).toHaveBeenCalledWith(
      TEST_USER_ID,
      42,
      7,
    );
  });

  it('POST /club-sections/:sectionId/evidence-folder/sections/:efSectionId/files uploads a multipart file', async () => {
    mockEvidenceFolderService.uploadFile.mockResolvedValue({
      file_id: 33,
      url: 'https://r2.example/evidence-33.pdf',
      file_name: 'comprobante.pdf',
      file_type: 'pdf',
      uploaded_by_name: 'Juan García',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/club-sections/42/evidence-folder/sections/7/files')
      .set(
        'Authorization',
        `Bearer ${makeToken(TEST_USER_ID, 'evidence@test.local')}`,
      )
      .attach('file', Buffer.from('%PDF-1.4 evidence'), 'comprobante.pdf')
      .expect(201);

    expect(response.body.status).toBe('success');
    expect(response.body.data.file_name).toBe('comprobante.pdf');
    expect(mockEvidenceFolderService.uploadFile).toHaveBeenCalledTimes(1);

    const [userId, clubSectionId, efSectionId, file] =
      mockEvidenceFolderService.uploadFile.mock.calls[0];
    expect(userId).toBe(TEST_USER_ID);
    expect(clubSectionId).toBe(42);
    expect(efSectionId).toBe(7);
    expect(file).toEqual(
      expect.objectContaining({
        originalname: 'comprobante.pdf',
        mimetype: 'application/pdf',
      }),
    );
  });

  it('DELETE /club-sections/:sectionId/evidence-folder/sections/:efSectionId/files/:fileId soft deletes a file', async () => {
    mockEvidenceFolderService.deleteFile.mockResolvedValue({
      file_id: 33,
      active: false,
    });

    const response = await request(app.getHttpServer())
      .delete('/api/v1/club-sections/42/evidence-folder/sections/7/files/33')
      .set(
        'Authorization',
        `Bearer ${makeToken(TEST_USER_ID, 'evidence@test.local')}`,
      )
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.data.active).toBe(false);
    expect(mockEvidenceFolderService.deleteFile).toHaveBeenCalledWith(
      TEST_USER_ID,
      42,
      7,
      33,
    );
  });
});
