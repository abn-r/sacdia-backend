import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

/**
 * Categoría del reporte — coincide con el enum de la app móvil
 * (`lib/features/support/domain/entities/support_category.dart`).
 *
 * Mantener sincronizado con el cliente al agregar valores nuevos.
 */
export enum SupportCategory {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
  ACCOUNT = 'account',
  DATA_ISSUE = 'data_issue',
  PERFORMANCE = 'performance',
  OTHER = 'other',
}

/**
 * Payload aceptado por `POST /api/v1/support/reports`.
 *
 * - `deviceInfo`: metadata capturada por `device_info_plus` (platform,
 *   osVersion, model, appVersion, buildNumber). Enviado siempre — el backend
 *   lo persiste como JSON tal cual para triage.
 * - `userContext`: contexto opcional enviado por la app (ruta actual,
 *   sección activa, locale, etc.). Útil para reproducir el problema.
 */
export class CreateSupportReportDto {
  @ApiProperty({
    description: 'Categoría del reporte',
    enum: SupportCategory,
    example: SupportCategory.BUG,
  })
  @IsEnum(SupportCategory, {
    message:
      'category debe ser uno de: bug, feature_request, account, data_issue, performance, other',
  })
  category!: SupportCategory;

  @ApiProperty({
    description: 'Título breve del reporte',
    maxLength: 120,
    example: 'No puedo iniciar sesión con Google',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120, {
    message: i18nValidationMessage(
      'errors.VALIDATION.support_title_max_length',
      { max: 120 },
    ),
  })
  title!: string;

  @ApiProperty({
    description: 'Descripción detallada del problema o sugerencia',
    maxLength: 2000,
    example:
      'Al tocar el botón de Google, la app se queda en blanco y nunca regresa del flujo OAuth.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000, {
    message: i18nValidationMessage(
      'errors.VALIDATION.support_description_max_length',
      { max: 2000 },
    ),
  })
  description!: string;

  @ApiProperty({
    description:
      'Metadata del dispositivo. Shape esperado: { platform, osVersion, model, appVersion, buildNumber }',
    type: 'object',
    additionalProperties: true,
    example: {
      platform: 'ios',
      osVersion: '17.4.1',
      model: 'iPhone15,3',
      appVersion: '1.4.0',
      buildNumber: '42',
    },
  })
  @IsObject()
  deviceInfo!: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Contexto opcional del usuario al momento de reportar (ruta, sección activa, locale, etc.)',
    type: 'object',
    additionalProperties: true,
    example: { route: '/settings/support/report', locale: 'es' },
  })
  @IsOptional()
  @IsObject()
  userContext?: Record<string, unknown>;
}
