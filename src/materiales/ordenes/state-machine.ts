/**
 * State machine for MaterialOrder.estado — pure, no DI, no Prisma.
 * Transitions map mirrors the spec state table (§3, locked).
 */
import { UnprocessableEntityException } from '@nestjs/common';

export type MaterialOrderEstado =
  | 'en_revision'
  | 'aprobada'
  | 'pagada'
  | 'entregada'
  | 'cancelada';

/**
 * Allowed state transitions.
 * Key = current state. Value = array of reachable next states.
 */
export const ALLOWED_TRANSITIONS: Record<
  MaterialOrderEstado,
  MaterialOrderEstado[]
> = {
  en_revision: ['aprobada', 'cancelada'],
  aprobada: ['pagada', 'cancelada'],
  pagada: ['entregada', 'cancelada'],
  entregada: [], // terminal
  cancelada: [], // terminal
};

/**
 * Returns true if the transition from → to is allowed.
 */
export function canTransition(
  from: MaterialOrderEstado,
  to: MaterialOrderEstado,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Asserts that from → to is a valid transition.
 * Throws UnprocessableEntityException with code `state_machine_violation` if not.
 */
export function assertTransition(
  from: MaterialOrderEstado,
  to: MaterialOrderEstado,
): void {
  if (!canTransition(from, to)) {
    throw new UnprocessableEntityException({
      code: 'state_machine_violation',
      message: `Transition from '${from}' to '${to}' is not allowed`,
      from,
      to,
    });
  }
}
