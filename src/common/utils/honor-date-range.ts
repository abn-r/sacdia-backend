import { BadRequestException } from '@nestjs/common';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { AppBadRequestException } from '../errors/app.exception';
import type { ErrorCode } from '../errors/error-codes';

/**
 * D6. Rango válido de la fecha completada de una especialidad y de la fecha de
 * investidura de una clase: `1960-01-01 <= fecha <= hoy`. La app replica esta
 * constante en un solo archivo; los tests de cada lado la fijan.
 */
export const MIN_CERTIFICATE_DATE = '1960-01-01';

export type DateRangeIssue = 'INVALID' | 'TOO_OLD' | 'IN_FUTURE';

export type DateRangeCodes<C extends string = ErrorCode> = {
  tooOld: C;
  inFuture: C;
};

/** Fecha civil de hoy en UTC (yyyy-mm-dd). Igual que el `assertNotFuture` previo. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && todayUtc(parsed) === value;
}

/**
 * Devuelve por qué `value` queda fuera de rango, o `null` si es válido.
 * Compara cadenas yyyy-mm-dd, que ordenan igual que las fechas.
 */
export function checkDateInRange(
  value: string,
  now: Date = new Date(),
): DateRangeIssue | null {
  if (!isRealIsoDate(value)) return 'INVALID';
  if (value < MIN_CERTIFICATE_DATE) return 'TOO_OLD';
  if (value > todayUtc(now)) return 'IN_FUTURE';
  return null;
}

/**
 * Lanza `AppBadRequestException` con el código que corresponda. Pensado para
 * los flujos que responden con `ErrorCode` traducido (`HONOR_DATE_*`). La carga
 * por certificado conserva su estilo de mensaje plano y usa `checkDateInRange`.
 */
export function assertDateInRange(
  value: string,
  codes: DateRangeCodes,
  now: Date = new Date(),
): void {
  const issue = checkDateInRange(value, now);
  if (issue === 'TOO_OLD') throw new AppBadRequestException(codes.tooOld);
  if (issue === 'IN_FUTURE') throw new AppBadRequestException(codes.inFuture);
  if (issue === 'INVALID') throw new BadRequestException('Invalid date');
}

/**
 * Decorador de DTO: exige `yyyy-mm-dd` real dentro de `[1960-01-01, hoy]`.
 * El mensaje de error es el código recibido (`tooOld` / `inFuture`), de modo
 * que el cliente distingue los dos casos.
 */
export function IsDateInRange(
  codes: DateRangeCodes<string>,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isDateInRange',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && checkDateInRange(value) === null,
        defaultMessage: (args?: ValidationArguments) => {
          const value = args?.value;
          const issue =
            typeof value === 'string' ? checkDateInRange(value) : 'INVALID';
          if (issue === 'TOO_OLD') return codes.tooOld;
          if (issue === 'IN_FUTURE') return codes.inFuture;
          return `${args?.property ?? 'date'} must be a valid date (yyyy-mm-dd)`;
        },
      },
    });
  };
}
