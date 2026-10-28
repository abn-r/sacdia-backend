import { join } from 'path';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Query,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AcceptLanguageResolver,
  I18nModule,
  I18nValidationPipe,
  QueryResolver,
} from 'nestjs-i18n';
import request from 'supertest';
import { RegisterDto } from '../../auth/dto/register.dto';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { ListHonorInstructorProposalsDto } from '../../honors/dto/honor-instructor-proposals.dto';
import { createValidationExceptionFilter } from './validation-exception-filter';

@Controller('t')
class TestController {
  @Post('register')
  register(@Body() _dto: RegisterDto) {
    return { ok: true };
  }

  @Get('proposals')
  proposals(@Query() _q: ListHonorInstructorProposalsDto) {
    return { ok: true };
  }
}

/**
 * Real I18nValidationPipe + real filter + real src/i18n catalogs, over HTTP.
 */
describe('Global validation errors (real pipe, filter and i18n)', () => {
  let app: INestApplication;
  const validBody = {
    name: 'QA',
    paternal_last_name: 'Legal',
    maternal_last_name: 'Prueba',
    email: 'qa.valid@example.com',
    password: 'Password123!',
    accepted_terms_version: '1.0.0',
    accepted_privacy_version: '1.0.0',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'es',
          loaderOptions: {
            path: join(__dirname, '..', '..', 'i18n'),
            watch: false,
          },
          resolvers: [
            { use: QueryResolver, options: ['lang'] },
            AcceptLanguageResolver,
          ],
        }),
      ],
      controllers: [TestController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    app.useGlobalFilters(createValidationExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('localizes the forbidNonWhitelisted case (es) with a field list', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/register')
      .set('Accept-Language', 'es')
      .send({ ...validBody, pLastName: 'x' })
      .expect(400);

    expect(res.body).toMatchObject({
      status: 'error',
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      path: '/t/register',
    });
    expect(res.body.message).toEqual(['El campo pLastName no está permitido']);
    expect(res.body.errors).toEqual([
      expect.objectContaining({
        field: 'pLastName',
        message: 'El campo pLastName no está permitido',
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('should not exist');
  });

  it('localizes the same error in en, fr and pt-BR', async () => {
    const expected: Record<string, string> = {
      en: 'The field pLastName is not allowed',
      fr: "Le champ pLastName n'est pas autorisé",
      'pt-BR': 'O campo pLastName não é permitido',
    };
    for (const [lang, message] of Object.entries(expected)) {
      const res = await request(app.getHttpServer())
        .post('/t/register')
        .set('Accept-Language', lang)
        .send({ ...validBody, pLastName: 'x' })
        .expect(400);
      expect(res.body.message).toEqual([message]);
    }
  });

  it('keeps DTO-authored messages (password policy) and localizes defaults in one response', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/register')
      .set('Accept-Language', 'es')
      .send({ ...validBody, password: 'short', email: 'nope' })
      .expect(400);

    const messages: string[] = res.body.message;
    expect(messages).toContain(
      'La contraseña debe tener al menos 12 caracteres',
    );
    expect(messages).toContain(
      'El campo email debe ser un correo electrónico válido',
    );
    expect(messages.join(' ')).not.toMatch(/\bmust\b|should/);
  });

  it('localizes query DTO enum failures with the allowed values', async () => {
    const res = await request(app.getHttpServer())
      .get('/t/proposals?status=pending')
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({
      field: 'status',
      message:
        'El campo status debe ser uno de los siguientes valores: PENDING, APPROVED, REJECTED',
    });
  });

  it('localizes numeric constraints with their limits and never echoes values', async () => {
    const res = await request(app.getHttpServer())
      .get('/t/proposals?page=0&limit=500')
      .set('Accept-Language', 'en')
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'The field page cannot be less than 1',
        'The field limit cannot be greater than 100',
      ]),
    );
    expect(JSON.stringify([res.body.message, res.body.errors])).not.toContain(
      '500',
    );
  });

  it('accepts a valid request', async () => {
    await request(app.getHttpServer())
      .get('/t/proposals?status=PENDING')
      .expect(200);
  });
});
