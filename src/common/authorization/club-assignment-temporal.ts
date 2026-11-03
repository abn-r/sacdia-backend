import type { TemporalLocalField } from '../clock/temporal-context.factory';
import { ECCLESIASTICAL_YEAR_TIMEZONE } from '../services/ecclesiastical-year.service';
import { classifyLocalFieldTimezone } from '../validators/iana-timezone.validator';

/**
 * Columnas que `ClubAssignmentEffectivityPolicy.isEffective` necesita leer de
 * una fila de `club_role_assignments` (ademas de `active`/`status`).
 */
export const CLUB_ASSIGNMENT_TEMPORAL_FIELDS = {
  start_date: true,
  end_date: true,
  expires_at: true,
} as const;

/**
 * Select anidado `club_sections -> clubs -> local_fields` con la zona horaria
 * del Campo Local, necesaria para construir el `TemporalContext` de la fila.
 */
export const CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT = {
  club_sections: {
    select: {
      clubs: {
        select: {
          local_fields: {
            select: { local_field_id: true, timezone: true },
          },
        },
      },
    },
  },
} as const;

/**
 * Entrada de `TemporalContextFactory.forLocalField` para el Campo Local de un
 * assignment. `local_fields.timezone` es nullable en el schema: si falta o no
 * es una zona canonica se usa la zona del calendario eclesiastico
 * (America/Mexico_City) en lugar de denegar el acceso por un dato de catalogo.
 */
export function toTemporalLocalField(
  localField:
    { local_field_id: number; timezone?: string | null } | null | undefined,
): TemporalLocalField {
  const classified = classifyLocalFieldTimezone(localField?.timezone);
  return {
    local_field_id: localField?.local_field_id ?? 0,
    timezone: classified.ok ? classified.value : ECCLESIASTICAL_YEAR_TIMEZONE,
  };
}
