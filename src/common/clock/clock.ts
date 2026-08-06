/** Absolute-time source. Capture once per authorization evaluation. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
