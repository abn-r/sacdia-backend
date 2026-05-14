import { Injectable, Logger } from '@nestjs/common';

/**
 * Log-only event publisher for materials domain events.
 *
 * v1: emits structured logs only — no queue, no Bull/Redis.
 * Future: swap the impl to enqueue into BullMQ without changing call sites.
 *
 * Supported event types:
 *   order.created | order.approved | order.cancelled
 *   comprobante.uploaded | comprobante.validated | comprobante.rejected
 *   order.delivered
 */
@Injectable()
export class EventsPublisher {
  private readonly logger = new Logger(EventsPublisher.name);

  logEvent(type: string, payload: Record<string, unknown>): void {
    this.logger.log({
      event: type,
      ...payload,
    });
  }
}
