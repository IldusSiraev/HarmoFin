# Stage 7: production readiness — дизайн

## Статус и назначение

Этот документ фиксирует target design Stage 7. Он не запускает provisioning, staging deployment, restore drill или production release без отдельного явного подтверждения в момент выполнения.

Stages 1–6 завершили MVP-домен HarmoFin. Репозиторий уже содержит локальный PostgreSQL/Mailpit Compose, GitHub Actions quality pipeline, API health endpoints, Pino logs и graceful shutdown API/worker. Production images, production Compose, deployment automation, runtime observability, backup/restore evidence и operational runbooks ещё не реализованы.

Stage 7 делает MVP готовым к контролируемому запуску. Решение остаётся provider-neutral: infrastructure implementation выбирается отдельно, но repository contract и release gates одинаковы для любого provider, удовлетворяющего требованиям ниже.

## Scope

В Stage 7 входят:

- reproducible production images для web, API и worker;
- provider-neutral Compose deployment topology и TLS ingress;
- отдельные staging и production environments;
- health/readiness checks, structured safe logs, metrics, traces и error reporting;
- CI quality, OpenAPI contract, image/SBOM/security checks;
- SHA-pinned staging deployment и manual production approval;
- migration safety, backup/PITR requirements и practical restore drill;
- runbooks, security review, load baseline, acceptance и controlled release checklist.

Не входят:

- provider SDK, Terraform/Pulumi modules или committed cloud account identifiers;
- secrets, DSNs, private hostnames/IPs, credentials, backups или customer data;
- Kubernetes, HA/multi-region, blue-green deployment и automatic production rollback;
- object-storage integration, пока её не требует product feature;
- новые финансовые domain rules, API products или UI features;
- automated destructive database rollback/reset.

## Неподвижные правила

- Production database — managed PostgreSQL или эквивалент с encryption, PITR, retention и восстановлением в изолированную среду. PostgreSQL не живёт единственной копией на application host.
- RPO MVP — не более 1 часа; RTO — не более 4 часов.
- Каждый image и deploy однозначно привязаны к immutable commit SHA. Тег `latest` не является deployment input.
- Pull request pipeline не получает staging/production secrets. Production workflow требует GitHub Environment approval.
- Migration запускается отдельным one-shot step до rollout services. Migration rollback не автоматизируется.
- Перед потенциально опасной migration требуется актуальное backup/restore evidence; migration остаётся backward-compatible по expand/contract policy.
- Все probes, metrics, database и worker services закрыты от public Internet. Только Caddy слушает public HTTP/HTTPS.
- Logs, telemetry и error reporting не содержат пароли, cookies, session secrets, database URLs, полные financial payloads или пользовательские comments.
- Production release, restore и destructive recovery требуют отдельного human confirmation в момент выполнения.

## Целевая топология

```text
Internet
   |
DNS + CDN/WAF + TLS
   |
Caddy on application host
   |-- web container
   `-- /api/* -> api container
                     |-- managed PostgreSQL
                     |-- SMTP provider
                     |-- error/tracing backend
                     `-- internal metrics collector

worker container ---- managed PostgreSQL
       |
       `-- internal health/metrics only
```

Для MVP допустим один Docker host на environment с отдельными `web`, `api`, `worker`, `migrate` и `caddy` containers. Staging и production используют разные hosts, databases, credentials, domains, monitoring projects и GitHub Environment secrets.

Caddy — единственный публичный service. Он завершает TLS, redirect-ит HTTP на HTTPS, задаёт безопасные headers/request limits/timeouts и проксирует web plus API через same HTTPS origin. Это сохраняет production `__Host-` session-cookie model; API, worker, metrics, PostgreSQL и SMTP не получают published ports.

Короткий controlled restart одного host допустим для MVP. При росте переходят к multiple API replicas, load balancer и separate worker pool без изменения API contract.

## Runtime images and Compose

Один multi-stage Dockerfile produces distinct `web`, `api`, `worker` и `migrate` targets. Build воспроизводится из Node 24, Corepack, `pnpm-lock.yaml` и checked-in source. Runtime layers минимальны, run as non-root, содержат no `.env` and no build secrets, and process SIGTERM correctly.

Production Compose:

- references fully qualified SHA-tagged OCI images;
- loads environment-specific secret file outside Git or runtime secret injection;
- exposes only Caddy ports 80/443;
- puts Caddy on public and private networks; application services only on private network;
- applies restart policy, resource limits and health checks to long-running services;
- runs `migrate` without restart and never starts application rollout after migration failure;
- uses named volumes only when runtime requires them; database data is not a Compose volume;
- has an example environment file with variable names and harmless placeholders, never production values.

Production config does not reuse `infra/compose/local.yml`: local Compose remains only PostgreSQL and Mailpit for development/test.

## Health and readiness

Existing API endpoints remain contract:

```text
GET /api/v1/health/live   process liveness
GET /api/v1/health/ready  database-dependent readiness
```

`/ready` reuses `DatabaseHealthService` and never reveals config or secret data. Caddy may proxy public health checks only if the operator needs them; container checks call private loopback/network addresses.

Stage 7 adds:

- web internal liveness route returning a static safe response;
- worker internal `/live` and `/ready` endpoint; readiness proves database connectivity and completed worker runtime start, not merely that Node process exists;
- container health checks for all long-running services;
- startup/readiness smoke verification in deployment automation.

Health and metrics endpoints return no user, budget, job or configuration details. Metrics are reached only on a private network by collector or operator-controlled host policy.

## Environment and secret boundary

| Class | Examples | Storage | May enter browser/image/logs |
| --- | --- | --- | --- |
| Public deployment config | public web origin, API same-origin route, release SHA, log level | committed example + environment config | only intended public values |
| Runtime secret | database URL, session hash secret, SMTP password, Sentry DSN, OTLP credentials | environment-specific secret manager/injection | never |
| Deployment credential | registry token, SSH/OIDC identity, GitHub Environment credentials | CI provider/environment secret store | never |
| Operational evidence | backup reference, restore record, alert routing, approval | protected operations record | no secrets or customer data in Git |

API and worker environment parsing remains centralized in existing config modules. Stage 7 adds only necessary release, health, telemetry and error-reporting variables; it fails closed where an enabled integration lacks a required secret. `.env` stays ignored. Production secrets never appear in Dockerfiles, Compose, workflow output, fixtures, reports or client bundles.

## Observability and data safety

Pino remains the runtime logger. API request outcome logs contain request ID, route, method, status, duration, service, environment and safe error code. Worker logs contain job class/outcome/counts but not job payload. Existing redact policy expands rather than weakens.

Prometheus-compatible internal metrics include:

- process/container health and release SHA;
- API request count, duration and error class;
- database readiness and measurable query latency;
- worker poll, lease, completed/failed/retried job counts and backlog indicators;
- notification, export and login failure counts;
- backup-status gauge populated by operator-controlled collector/integration.

Sentry-compatible error reporting and OpenTelemetry-compatible tracing are opt-in via runtime configuration. The reporting boundary removes sensitive request context and financial payloads before exporting. Provider choice and DSNs remain operational decisions.

Required dashboards/alerts cover availability/readiness, HTTP error rate/latency, database latency, worker failure/backlog, notification/export/login failures, container resources, backup status and post-release error increase. Alert ownership/escalation is recorded before production release.

## CI/CD lifecycle

### Pull request

GitHub Actions runs locked install, format, lint, typecheck, Prisma schema/migration checks, idempotent seed, unit/integration tests, build, browser tests, OpenAPI artifact/lint/breaking-change comparison, production image build, SBOM/dependency scan and image scan.

PR jobs use minimal read-only permissions and cannot access deployment environments. Artifacts contain commit SHA and scan/contract reports. A documented severity policy fails actionable high/critical findings; exceptions require an explicit tracked review, not a silent workflow bypass.

### Main to staging

A successful main build publishes `web`, `api` and `worker` OCI images tagged by exact SHA. Deployment workflow uses only staging GitHub Environment secrets and:

1. validates runtime input;
2. pulls exact image references;
3. runs migration once;
4. reconciles Compose services;
5. waits for web/API/worker health;
6. executes safe smoke requests and authenticated critical journey;
7. verifies logs, metrics, trace/error delivery;
8. publishes SHA and outcome to workflow/PR status.

Failure before rollout leaves current running services intact when possible. A failed migration stops deployment. Application rollback selects a previously verified SHA only after migration compatibility check; no automatic database rollback exists.

### Production

Production is manual workflow dispatch selecting a SHA already proven in staging. GitHub Environment protection requires approval. Preconditions are successful checks, same-SHA staging smoke result, migration compatibility, current backup/restore evidence for relevant risk, alert routing and release owner acknowledgement.

After migration and rollout, operator verifies all probes, safe health request, database connection, worker start, telemetry and an agreed observation window. Release record includes SHA, image digests, migration version, backup reference, approvals, smoke evidence and rollback decision.

## Database backup and recovery

Provider contract requires encrypted automatic backups, PITR, retention matching product/legal policy and an isolated restore target. At least one copy lives in separate failure domain when provider supports it.

Backup is accepted only after practical restore drill:

1. select an approved staging backup or anonymized production-derived source;
2. restore to isolated target with no production network access;
3. verify database reachability, migration/schema state, integrity checks and selected anonymized acceptance data;
4. record elapsed RTO, restore point/RPO, outcome and remediation;
5. destroy restore target securely.

Production data is never copied to staging without explicit authorization and anonymization. Restore runbook directs forward-fix or provider restore; it never suggests `prisma migrate reset`, destructive migration down, or deletion of unverified backups.

## Provider-neutral provisioning contract

Before staging work, operator provides outside Git:

- separate staging/production domains, DNS and TLS capability;
- two Linux Docker hosts or equivalent container runtime with hardened access/firewall;
- managed PostgreSQL instances with private access from respective host only;
- secret manager/injection, OCI registry access and least-privilege deploy identity;
- outbound transactional SMTP;
- compatible metrics, tracing and error-reporting backends;
- GitHub Environment protection/approvals;
- documented backup/PITR/retention and isolated restore procedure.

The chosen provider must meet this capability contract. No provider-specific SDK enters application code. The design permits Yandex Cloud, VK Cloud, Selectel or equivalent provider when jurisdiction, PostgreSQL support, PITR, secret management, storage requirements, network quality, cost and support satisfy product constraints.

## Runbooks and release evidence

Repository documents runbooks for deploy, image rollback, database restore, secret rotation, PostgreSQL outage, worker failure/stuck jobs, elevated API errors, suspicious activity, account deletion/data export and incident escalation. Runbooks identify preconditions, safe commands, evidence, escalation owner and prohibited destructive shortcuts.

Operations record protected evidence outside Git for staging/prod provisioning, deploys, approvals, restore drills, backup checks, security exceptions, load baselines and releases. Git contains templates and non-sensitive checklists only.

## Acceptance criteria

Stage 7 is ready for controlled production release only when:

- one SHA creates reproducible signed/scanned images and staging deploys it successfully;
- web/API/worker health, graceful shutdown and private probe boundaries are proven;
- CI enforces quality, contract, migration, browser, image and security gates;
- logs, metrics, traces and safe error reporting appear in configured backends;
- managed PostgreSQL backup/PITR meets RPO/RTO and successful restore drill evidence exists;
- runbooks, alert routing, security review and non-destructive load baseline are complete;
- staging critical acceptance smoke succeeds;
- production release checklist gets explicit human approval.
