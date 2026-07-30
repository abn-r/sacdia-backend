import { Injectable } from '@nestjs/common';
import type { Clock } from './clock';

@Injectable()
export class SystemClockService implements Clock {
  now(): Date {
    return new Date();
  }
}
