const SAFE_TELEMETRY_KEYS = new Set([
  'event',
  'requestId',
  'service',
  'environment',
  'release',
  'releaseSha',
  'errorName',
  'outcome',
  'jobType',
  'count',
  'durationMs',
]);

type TelemetryPrimitive = string | number | boolean;
export type WorkerTelemetryPayload = Record<string, TelemetryPrimitive>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function sanitizeWorkerTelemetry(input: unknown): WorkerTelemetryPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const result: WorkerTelemetryPayload = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_TELEMETRY_KEYS.has(key) || !isTelemetryPrimitive(value)) continue;
    result[key] = value;
  }
  return result;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  constructor(
    private readonly identity: { service: string; environment: string; releaseSha: string },
  ) {}

  setProcessHealth(value: number): void {
    this.gauges.set('process_health', value === 1 ? 1 : 0);
  }

  recordPoll(outcome: 'success' | 'failure'): void {
    this.increment('worker_polls_total', { outcome });
  }

  recordJob(jobType: string, outcome: 'completed' | 'failed' | 'retried'): void {
    this.increment('worker_jobs_total', { job_type: jobType, outcome });
  }

  setBacklog(value: number): void {
    this.gauges.set('worker_backlog', Number.isFinite(value) && value >= 0 ? value : 0);
  }

  render(): string {
    const lines = [
      '# HELP harmofin_process_health Process health.',
      '# TYPE harmofin_process_health gauge',
      `harmofin_process_health${labels({ service: this.identity.service, environment: this.identity.environment })} ${this.gauges.get('process_health') ?? 0}`,
      '# HELP harmofin_release_info Running release.',
      '# TYPE harmofin_release_info gauge',
      `harmofin_release_info${labels({ service: this.identity.service, environment: this.identity.environment, release: this.identity.releaseSha })} 1`,
      '# HELP harmofin_worker_backlog Due worker jobs.',
      '# TYPE harmofin_worker_backlog gauge',
      `harmofin_worker_backlog ${this.gauges.get('worker_backlog') ?? 0}`,
    ];

    for (const [key, value] of this.counters) lines.push(`harmofin_${key} ${value}`);
    return `${lines.join('\n')}\n`;
  }

  private increment(name: string, labelValues: Record<string, string>): void {
    const key = `${name}${labels(labelValues)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
}

export function createWorkerErrorReporter(
  endpoint: string | undefined,
  fetcher: Fetcher = fetch,
): {
  report(error: unknown, context?: unknown): Promise<boolean>;
} {
  return {
    async report(error: unknown, context?: unknown): Promise<boolean> {
      if (!endpoint) return false;
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            error: { name: error instanceof Error ? error.name : 'UnknownError' },
            context: sanitizeWorkerTelemetry(context),
          }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

function isTelemetryPrimitive(value: unknown): value is TelemetryPrimitive {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function labels(values: Record<string, string>): string {
  const entries = Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
