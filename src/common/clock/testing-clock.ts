import type { Clock } from './clock';

/** Deterministic clock for temporal-policy tests. */
export class TestingClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date): void {
    this.current = new Date(value);
  }
}
