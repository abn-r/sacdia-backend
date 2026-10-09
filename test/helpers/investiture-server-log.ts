import { readFileSync } from 'node:fs';

export function requireInvestitureServerLogPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = env.SACDIA_POSTGRES_SERVER_LOG?.trim();
  if (!path) {
    throw new Error(
      'SACDIA_POSTGRES_SERVER_LOG es obligatorio para verificar el log del servidor. Sin ese archivo no se puede distinguir un interbloqueo de un log que no registra ERROR.',
    );
  }
  return path;
}

export function assertServerLogHasWarningMarker(
  path: string,
  marker: string,
): void {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(marker)) {
    throw new Error(
      `El log ${path} no contiene el marcador WARNING ${marker}. El archivo no es de este servidor o log_min_messages no registra WARNING.`,
    );
  }
}
