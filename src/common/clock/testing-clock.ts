import type { Clock } from './clock';

export class TestingClock implements Clock {
  private current: Date;

  constructor(value: Date) {
    this.current = new Date(value);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date): void {
    this.current = new Date(value);
  }
}
