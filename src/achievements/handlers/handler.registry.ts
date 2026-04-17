import { Injectable } from '@nestjs/common';
import { achievement_type } from '@prisma/client';
import { AchievementHandler } from './handler.interface';

@Injectable()
export class HandlerRegistry {
  private readonly handlers = new Map<achievement_type, AchievementHandler>();

  register(type: achievement_type, handler: AchievementHandler): void {
    this.handlers.set(type, handler);
  }

  getHandler(type: achievement_type): AchievementHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for achievement type: ${type}`);
    }
    return handler;
  }
}
