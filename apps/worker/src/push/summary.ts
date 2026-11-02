export type PushTransportResult = { status: number; retryAfterSeconds: number | null };

export type DeviceOutcome = { id: string; result: PushTransportResult | 'network' };

export type PushSummary = {
  delivered: string[];
  gone: string[];
  transient: string | null;
  permanent: string | null;
  retryAt: Date | null;
};

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Sorts the push service answers per device: 2xx delivered; 404/410 (expired) and 403 (VAPID key
 * mismatch) gone; 429 wait for Retry-After; 5xx or network transient; other 4xx permanent.
 */
export function summarizePush(outcomes: readonly DeviceOutcome[], now: Date): PushSummary {
  const summary: PushSummary = {
    delivered: [],
    gone: [],
    transient: null,
    permanent: null,
    retryAt: null,
  };
  for (const { id, result } of outcomes) {
    if (result === 'network') {
      summary.transient = 'PUSH_NETWORK';
      continue;
    }
    const { status } = result;
    if (status >= 200 && status < 300) {
      summary.delivered.push(id);
    } else if (status === 404 || status === 410 || status === 403) {
      summary.gone.push(id);
    } else if (status === 429) {
      const seconds = result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
      const at = new Date(now.getTime() + seconds * 1_000);
      if (!summary.retryAt || at > summary.retryAt) summary.retryAt = at;
    } else if (status >= 500) {
      summary.transient = `PUSH_${status}`;
    } else {
      summary.permanent = `PUSH_${status}`;
    }
  }
  return summary;
}
