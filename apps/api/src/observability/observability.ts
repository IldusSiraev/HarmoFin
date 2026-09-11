const SAFE_TELEMETRY_KEYS = new Set([
  'event',
  'requestId',
  'route',
  'method',
  'status',
  'durationMs',
  'service',
  'environment',
  'release',
  'releaseSha',
  'errorCode',
  'errorName',
  'outcome',
  'jobType',
  'count',
  'statusClass',
]);

const SAFE_COUNTER_NAMES = new Set([
  'login_failures_total',
  'notification_creation_failures_total',
  'export_failures_total',
  'database_errors_total',
]);

type TelemetryPrimitive = string | number | boolean;
export type TelemetryPayload = Record<string, TelemetryPrimitive>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function sanitizeTelemetry(input: unknown): TelemetryPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const result: TelemetryPayload = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_TELEMETRY_KEYS.has(key) || !isTelemetryPrimitive(value)) continue;
    result[key] = value;
  }
  return result;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly observations = new Map<string, { count: number; sum: number }>();

  constructor(
    private readonly identity: { service: string; environment: string; releaseSha: string },
  ) {}

  setProcessHealth(value: number): void {
    this.gauges.set('process_health', value === 1 ? 1 : 0);
  }

  setDatabaseReadiness(value: number): void {
    this.gauges.set('database_readiness', value === 1 ? 1 : 0);
  }

  recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
    const statusClass = `${Math.floor(status / 100)}xx`;
    this.incrementCounter('http_requests_total', {
      method,
      route: normalizeRoute(route),
      status_class: statusClass,
    });
    this.observe('http_request_duration_ms', durationMs, { method, route: normalizeRoute(route) });
  }

  recordDatabaseLatency(durationMs: number): void {
    this.observe('database_query_duration_ms', durationMs);
  }

  increment(name: string): void {
    if (SAFE_COUNTER_NAMES.has(name)) this.incrementCounter(name, {});
  }

  render(): string {
    const lines = [
      '# HELP harmofin_process_health Process health.',
      '# TYPE harmofin_process_health gauge',
      `harmofin_process_health${labels(this.baseLabels())} ${this.gauges.get('process_health') ?? 0}`,
      '# HELP harmofin_database_readiness Database readiness.',
      '# TYPE harmofin_database_readiness gauge',
      `harmofin_database_readiness${labels(this.baseLabels())} ${this.gauges.get('database_readiness') ?? 0}`,
      '# HELP harmofin_release_info Running release.',
      '# TYPE harmofin_release_info gauge',
      `harmofin_release_info${labels({ ...this.baseLabels(), release: this.identity.releaseSha })} 1`,
    ];

    for (const [key, value] of this.counters) lines.push(`harmofin_${key} ${value}`);
    for (const [key, observation] of this.observations) {
      lines.push(`harmofin_${key}_count ${observation.count}`);
      lines.push(`harmofin_${key}_sum ${observation.sum}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private incrementCounter(name: string, labelValues: Record<string, string>): void {
    const key = `${name}${labels(labelValues)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  private observe(name: string, value: number, labelValues: Record<string, string> = {}): void {
    const key = `${name}${labels(labelValues)}`;
    const current = this.observations.get(key) ?? { count: 0, sum: 0 };
    current.count += 1;
    current.sum += Number.isFinite(value) && value >= 0 ? value : 0;
    this.observations.set(key, current);
  }

  private baseLabels(): Record<string, string> {
    return { service: this.identity.service, environment: this.identity.environment };
  }
}

export function createErrorReporter(
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
            context: sanitizeTelemetry(context),
          }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export function createTraceExporter(
  endpoint: string | undefined,
  fetcher: Fetcher = fetch,
): {
  export(span: unknown): Promise<boolean>;
} {
  return {
    async export(span: unknown): Promise<boolean> {
      if (!endpoint) return false;
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ span: sanitizeTelemetry(span) }),
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

function normalizeRoute(route: string): string {
  return (route.split('?')[0] ?? route)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function labels(values: Record<string, string>): string {
  const entries = Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
