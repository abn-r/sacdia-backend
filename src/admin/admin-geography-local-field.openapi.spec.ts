import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AdminGeographyController } from './admin-geography.controller';
import { AdminGeographyService } from './admin-geography.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GlobalRolesGuard } from '../common/guards/global-roles.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

type JsonSchema = {
  oneOf?: Array<{ $ref?: string }>;
  required?: string[];
  properties?: Record<string, unknown>;
  enum?: unknown[];
};

function resolveRef(
  document: { components?: { schemas?: Record<string, JsonSchema> } },
  ref: string,
): JsonSchema {
  const name = ref.replace('#/components/schemas/', '');
  const schema = document.components?.schemas?.[name];
  if (!schema) {
    throw new Error(`Missing schema component: ${name}`);
  }
  return schema;
}

describe('AdminGeographyController OpenAPI create local-field', () => {
  it('emits oneOf where timezone is required unless active is false', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminGeographyController],
      providers: [{ provide: AdminGeographyService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('c01-openapi').build(),
    );
    await app.close();

    const operation = document.paths['/api/v1/admin/local-fields']?.post;
    const schema = operation?.requestBody?.content?.['application/json']
      ?.schema as JsonSchema | undefined;

    expect(schema?.oneOf?.length).toBe(2);

    const variants = (schema?.oneOf ?? []).map((entry) => {
      if (!entry.$ref) {
        throw new Error('Expected oneOf entries to use $ref');
      }
      return resolveRef(document, entry.$ref);
    });

    const activeVariant = variants.find((variant) =>
      (variant.required ?? []).includes('timezone'),
    );
    const inactiveVariant = variants.find(
      (variant) =>
        !(variant.required ?? []).includes('timezone') &&
        Array.isArray(
          (variant.properties?.active as { enum?: unknown[] } | undefined)
            ?.enum,
        ) &&
        (variant.properties?.active as { enum?: unknown[] }).enum?.includes(
          false,
        ),
    );

    expect(activeVariant).toBeDefined();
    expect(activeVariant?.required).toEqual(
      expect.arrayContaining(['name', 'abbreviation', 'union_id', 'timezone']),
    );
    expect(activeVariant?.required ?? []).not.toContain('active');

    expect(inactiveVariant).toBeDefined();
    expect(inactiveVariant?.required).toEqual(
      expect.arrayContaining(['name', 'abbreviation', 'union_id', 'active']),
    );
    expect(inactiveVariant?.required ?? []).not.toContain('timezone');
  });
});
