import type { Prisma } from '@prisma/client';

/** Campos del usuario instructor que hacen falta para armar la vista pública. */
export const instructorUserSelect = {
  user_id: true,
  name: true,
  paternal_last_name: true,
  maternal_last_name: true,
  user_image: true,
} satisfies Prisma.usersSelect;

/** Misma forma sin la foto, para listados y paneles de revisión (sin URLs firmadas). */
export const instructorUserSelectNoPhoto = {
  user_id: true,
  name: true,
  paternal_last_name: true,
  maternal_last_name: true,
} satisfies Prisma.usersSelect;

export const DELETED_USER_LABEL = 'Usuario eliminado';

export type InstructorView =
  | {
      kind: 'USER';
      user_id: string;
      display_name: string;
      /** Solo en respuestas del miembro; el admin no recibe `photo_url`. */
      photo_url?: string | null;
    }
  | { kind: 'EXTERNAL'; display_name: string };

type InstructorRow = {
  instructor_user_id?: string | null;
  instructor_name?: string | null;
  instructor?: {
    user_id: string;
    name?: string | null;
    paternal_last_name?: string | null;
    maternal_last_name?: string | null;
  } | null;
};

/**
 * Bloque `instructor` de las respuestas (§4.2). El nombre de un usuario del
 * sistema se lee en vivo: una cuenta anonimizada ya no tiene nombre y se
 * muestra como "Usuario eliminado". Nunca incluye email. `photoUrls` (user_id
 * a URL firmada) activa `photo_url`; sin él la clave no existe.
 */
export function toInstructorView(
  row: InstructorRow,
  photoUrls?: ReadonlyMap<string, string | null>,
): InstructorView | null {
  if (row.instructor_user_id) {
    const user = row.instructor;
    const name = [
      user?.name,
      user?.paternal_last_name,
      user?.maternal_last_name,
    ]
      .map((part) => part?.trim() ?? '')
      .filter((part) => part.length > 0)
      .join(' ');
    return {
      kind: 'USER',
      user_id: row.instructor_user_id,
      display_name: name || DELETED_USER_LABEL,
      ...(photoUrls
        ? { photo_url: photoUrls.get(row.instructor_user_id) ?? null }
        : {}),
    };
  }
  if (row.instructor_name) {
    return { kind: 'EXTERNAL', display_name: row.instructor_name };
  }
  return null;
}

/** Igualdad de instructores entre dos filas (usuario por id, externo por nombre sin mayúsculas). */
export function sameInstructor(
  a: Pick<InstructorRow, 'instructor_user_id' | 'instructor_name'>,
  b: Pick<InstructorRow, 'instructor_user_id' | 'instructor_name'>,
): boolean {
  if (a.instructor_user_id || b.instructor_user_id) {
    return a.instructor_user_id === b.instructor_user_id;
  }
  return (
    (a.instructor_name ?? '').toLowerCase() ===
    (b.instructor_name ?? '').toLowerCase()
  );
}

export function instructorKind(
  row: Pick<InstructorRow, 'instructor_user_id' | 'instructor_name'>,
): 'USER' | 'EXTERNAL' | 'NONE' {
  if (row.instructor_user_id) return 'USER';
  return row.instructor_name ? 'EXTERNAL' : 'NONE';
}
