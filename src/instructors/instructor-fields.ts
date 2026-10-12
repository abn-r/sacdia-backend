import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const INSTRUCTOR_NAME_MIN = 3;
export const INSTRUCTOR_NAME_MAX = 150;

/** Trim y espacios colapsados. Lo que no es texto pasa tal cual (lo rechaza `@IsString`). */
export function normalizeInstructorName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

/**
 * `instructor_user_id` / `instructorUserId`. `undefined` = no cambia, `null` =
 * borra, uuid = asigna (`@IsOptional` omite las dos primeras). El Campo Local y
 * la edad se validan en `InstructorsService.assertEligible`, no aquí.
 */
export function InstructorUserIdField() {
  return applyDecorators(
    ApiPropertyOptional({
      description:
        'Instructor que es usuario del sistema (mismo Campo Local que el dueño, activo, aprobado y mayor de edad). null lo borra; mandar un valor reemplaza al nombre libre. No combinar con el nombre libre.',
      format: 'uuid',
      nullable: true,
    }),
    IsOptional(),
    IsUUID(),
  );
}

/** `instructor_name` / `instructorName`. Misma semántica que `InstructorUserIdField`. */
export function InstructorNameField() {
  return applyDecorators(
    ApiPropertyOptional({
      description:
        'Instructor externo (sin cuenta o de otro Campo Local), nombre completo libre de 3 a 150 caracteres. null lo borra; mandar un valor reemplaza al usuario del sistema. No combinar con el usuario.',
      minLength: INSTRUCTOR_NAME_MIN,
      maxLength: INSTRUCTOR_NAME_MAX,
      nullable: true,
    }),
    Transform(({ value }: { value: unknown }) =>
      normalizeInstructorName(value),
    ),
    IsOptional(),
    IsString(),
    MinLength(INSTRUCTOR_NAME_MIN),
    MaxLength(INSTRUCTOR_NAME_MAX),
    Matches(/^[^\p{Cc}]+$/u),
  );
}
