/**
 * Fecha de finalización efectiva de una fila de `users_honors`.
 *
 * `completed_at` (M5) es la fecha de finalización; `date` es la de INICIO. Las
 * filas de la carga por certificado anteriores a M5 guardaron la de finalización
 * en `date` y el backfill de M5 la copia a `completed_at`. Cuando `completed_at`
 * sigue en NULL (fila vieja sin backfill) se cae a `date`, que es el
 * comportamiento previo de las comparaciones de la carga por certificado.
 */
export function honorCompletionDate(row: {
  completed_at?: Date | null;
  date?: Date | null;
}): Date | null {
  return row.completed_at ?? row.date ?? null;
}
