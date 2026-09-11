# Observability dashboards and alerts

This document defines the required dashboards, alert thresholds and backend
setup contract for HarmoFin. It contains no live DSN, dashboard URL or
provider credential; those are operational decisions recorded outside Git.

## Metrics source

- API exposes internal Prometheus-compatible metrics at `/internal/metrics`
  (private network only, no `/api/v1` prefix).
- Worker exposes the same contract at `/internal/metrics` on its private
  health port.
- Both endpoints require no authentication because they are reachable only
  from a private network/collector, per the topology in
  [Stage 7 design](../superpowers/specs/2026-09-09-stage-7-production-readiness-design.md).

## Required metrics

| Metric                                            | Source      | Purpose                          |
| ------------------------------------------------- | ----------- | -------------------------------- |
| `harmofin_process_health`                         | API, worker | Liveness/availability panel      |
| `harmofin_release_info`                           | API, worker | Correlate deploy with dashboards |
| `harmofin_database_readiness`                     | API         | Database availability panel      |
| `harmofin_database_query_duration_ms_{count,sum}` | API         | Database latency panel           |
| `harmofin_http_requests_total`                    | API         | HTTP error rate/traffic panel    |
| `harmofin_http_request_duration_ms_{count,sum}`   | API         | HTTP latency panel               |
| `harmofin_login_failures_total`                   | API         | Login failure alert              |
| `harmofin_export_failures_total`                  | API         | Export failure alert             |
| `harmofin_database_errors_total`                  | API         | Database error alert             |
| `harmofin_worker_polls_total`                     | worker      | Worker liveness/backlog panel    |
| `harmofin_worker_jobs_total`                      | worker      | Job outcome panel/alert          |
| `harmofin_worker_backlog`                         | worker      | Backlog alert                    |

## Required dashboards

1. **Availability/readiness** — process health, database readiness, release
   version for API and worker.
2. **HTTP error rate/latency** — `harmofin_http_requests_total` by
   `status_class`, `harmofin_http_request_duration_ms` percentiles.
3. **Database latency** — `harmofin_database_query_duration_ms` and
   `harmofin_database_readiness`.
4. **Worker failure/backlog** — `harmofin_worker_jobs_total` by outcome,
   `harmofin_worker_backlog`.
5. **Notification/export/login failures** — `harmofin_login_failures_total`,
   `harmofin_export_failures_total`, `harmofin_database_errors_total`.
6. **Container resources** — CPU/memory per container from the collector's
   own container metrics (not emitted by the application).
7. **Backup status** — gauge populated by the operator's backup/PITR
   integration, not by application code.
8. **Post-release error increase** — error reporter volume filtered by
   `release`, compared to the previous release window.

## Alert thresholds (starting point, tune per environment)

| Alert                       | Condition                                                                                      | Severity |
| --------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| API unavailable             | `harmofin_process_health{service="api"} == 0` for 2m                                           | Critical |
| Worker unavailable          | `harmofin_process_health{service="worker"} == 0` for 2m                                        | Critical |
| Database unready            | `harmofin_database_readiness == 0` for 2m                                                      | Critical |
| Elevated 5xx rate           | 5xx share of `harmofin_http_requests_total` > 2% over 5m                                       | High     |
| Elevated latency            | p95 of `harmofin_http_request_duration_ms` > 1000ms over 5m                                    | High     |
| Worker backlog growth       | `harmofin_worker_backlog` above agreed threshold for 10m                                       | High     |
| Repeated job failure        | `harmofin_worker_jobs_total{outcome="failed"}` increases over 15m                              | High     |
| Login failure spike         | `harmofin_login_failures_total` rate exceeds baseline                                          | Medium   |
| Export failure              | any increase in `harmofin_export_failures_total`                                               | Medium   |
| Post-release error increase | error reporter volume for new release exceeds prior release baseline within observation window | High     |

## Error reporting and tracing

- `ERROR_REPORTING_ENDPOINT` and `OTEL_EXPORTER_OTLP_ENDPOINT` are optional
  runtime variables. When unset, the reporter/exporter is a no-op; no request
  is sent.
- Both API and worker sanitize payloads before egress: only safe fields
  (`event`, `requestId`, `route`, `method`, `status`, `durationMs`, `service`,
  `environment`, `release`, `releaseSha`, `errorCode`, `errorName`,
  `outcome`, `jobType`, `count`, `statusClass`) leave the process. Secrets,
  cookies, comments and financial payload fields never reach the reporter.
- Provider choice, DSN and dashboard URLs are recorded in the operations
  record store outside Git, never in this repository.

## Alert ownership

Alert routing and on-call ownership are recorded in the protected operations
record before production release, per the Stage 7 design's `Task 8`
acceptance criteria. This document defines only the contract; the ownership
record itself contains no secrets and lives outside Git.
