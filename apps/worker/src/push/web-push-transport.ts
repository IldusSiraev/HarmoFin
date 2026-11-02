import webpush from 'web-push';

import type { WorkerPushConfig } from '../config.js';
import type { PushTransportResult } from './summary.js';

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSendOptions = { ttlSeconds: number; topic: string };

export interface PushTransport {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushTransportResult>;
}

const TIMEOUT_MS = 10_000;

/** Retry-After is either seconds or an HTTP date. */
export function retryAfterSeconds(value: unknown, now = Date.now()): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1_000));
}

/**
 * Encrypts the payload for the device (RFC 8291) and signs the request with VAPID (RFC 8292) via
 * the web-push package. A push service answer becomes a status; anything else is a network error
 * whose message never carries the endpoint or keys.
 */
export class WebPushTransport implements PushTransport {
  constructor(private readonly vapid: WorkerPushConfig) {}

  async send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<PushTransportResult> {
    try {
      const response = await webpush.sendNotification(target, payload, {
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
        TTL: options.ttlSeconds,
        urgency: 'high',
        topic: options.topic,
        timeout: TIMEOUT_MS,
      });
      return { status: response.statusCode, retryAfterSeconds: null };
    } catch (error) {
      const status = (error as { statusCode?: unknown } | null)?.statusCode;
      if (typeof status === 'number') {
        const headers = (error as { headers?: Record<string, unknown> }).headers ?? {};
        return { status, retryAfterSeconds: retryAfterSeconds(headers['retry-after']) };
      }
      throw Object.assign(new Error('Push network error'), { code: 'PUSH_NETWORK' });
    }
  }
}
