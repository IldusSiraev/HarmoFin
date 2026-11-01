import { SetMetadata } from '@nestjs/common';

export const EXTERNAL_WEBHOOK = 'harmofin:external-webhook';

/**
 * Marks a route called by an external service (Telegram) that sends no Origin header. The global
 * OriginGuard skips such a route; the route must authenticate the caller itself (secret header).
 */
export const ExternalWebhook = (): MethodDecorator => SetMetadata(EXTERNAL_WEBHOOK, true);
