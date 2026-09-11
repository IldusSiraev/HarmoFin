`# Stage 7: production readiness — implementation plan

> Выполнять в отдельной сессии task-by-task. Работать в current checkout, без worktree, subagents, workflows или agent-driven development. После каждого Task останавливаться до явного подтверждения пользователя. Не push, merge, create PR, provision staging/production, run restore drill или deploy без отдельного подтверждения.

**Goal:** Make HarmoFin MVP reproducibly deployable to isolated staging and production environments with safe images, deployment gates, observability, backup/recovery evidence and controlled release procedure.

**Architecture:** GitHub Actions builds immutable SHA-tagged OCI images and deploys the same image set to a provider-neutral Docker Compose host. Caddy is the only public ingress. Managed PostgreSQL remains outside Compose. API/web/worker have independent probes; logs, metrics, traces and error reports cross sanitized boundaries only. Staging deploy is automated after `main`; production deploy is an approved manual workflow using an already staged SHA.

**Spec:** [Stage 7 design](../specs/2026-09-09-stage-7-production-readiness-design.md)

## Required reading

Before implementation read:

- `CLAUDE.md`;
- [development specification](../specs/2026-08-30-family-budget-development-spec.md), sections 4.6, 9, 12–15, 19–21;
- [Stage 7 design](../specs/2026-09-09-stage-7-production-readiness-design.md);
- current `.github/workflows/ci.yml`, `infra/compose/local.yml`, `.env.example`, root `package.json`;
- `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/config/env.ts`, `apps/api/src/health/*`, `apps/api/src/common/logging/logger.ts`;
- `apps/worker/src/main.ts`, `apps/worker/src/config.ts`, `apps/worker/src/runtime.ts`, `apps/worker/src/logger.ts`.

## Global constraints

- Start from current `main` on `feat/stage-7-production-readiness`.
- Use Node 24, Corepack/pnpm lockfile, TypeScript strict and existing server/client boundaries.
- Never commit or print credentials, DSNs, real hostnames/IPs, private keys, backup references, customer data, cookies, passwords, secrets or full financial payloads.
- Do not add PostgreSQL, SMTP or production data volumes to production Compose. Local `infra/compose/local.yml` stays local-only.
- Public traffic reaches Caddy only. Worker health/metrics, API metrics, database and SMTP have no public published ports.
- Production migrations use `prisma migrate deploy` in a one-shot controlled step. No `migrate dev`, `migrate reset`, destructive down migration or automatic database rollback.
- Production release and restore drill are operational actions. Stop and request explicit authorization before performing either.
- User-facing messages remain Russian. Code/API identifiers remain English.
- Treat browser test execution as CI-only unless user explicitly authorizes local `pnpm test:e2e`.

## File map

| Path | Responsibility |
| --- | --- |
| `infra/docker/Dockerfile` | Multi-stage production build targets for web, API, worker and migrate. |
| `.dockerignore` | Prevents secrets/local artifacts from entering Docker build context. |
| `infra/compose/production.yml` | Private production service topology with no database service. |
| `infra/caddy/Caddyfile` | TLS ingress, same-origin routing and request boundary. |
| `infra/env/staging.example` | Safe variable-name-only Compose example. |
| `infra/scripts/deploy.sh` | Validated SHA deployment, migration, health and smoke orchestration. |
| `infra/scripts/smoke.sh` | Non-destructive post-deploy health/smoke checks. |
| `apps/web/server/routes/health/live.get.ts` | Internal web liveness route. |
| `apps/worker/src/health-server.ts` | Internal worker liveness/readiness HTTP service. |
| `apps/worker/src/runtime.ts` | Exposes safe worker-started/readiness state. |
| `apps/api/src/config/env.ts` | Validates required runtime/telemetry configuration. |
| `apps/worker/src/config.ts` | Validates worker health/release/telemetry configuration. |
| `apps/api/src/common/logging/*` | Request outcome logging, redaction and safe telemetry boundary. |
| `apps/api/src/observability/*` | API metrics, trace and error-reporting adapters. |
| `apps/worker/src/observability/*` | Worker metrics, trace and error-reporting adapters. |
| `.github/workflows/ci.yml` | Pull-request quality, contract, image and scan gates. |
| `.github/workflows/publish.yml` | SHA image publication after main build. |
| `.github/workflows/deploy-staging.yml` | Environment-scoped automatic staging deployment. |
| `.github/workflows/deploy-production.yml` | Manually approved production deployment. |
| `docs/runbooks/*.md` | Safe operational procedures and evidence templates. |
| `docs/operations/*.md` | Provider capability, backup/restore, release and load evidence templates. |
| `README.md` | Verified commands and production-operational boundaries only after implementation. |

## Task 1 — Production images, ingress and topology

**Files:**

- Create: `.dockerignore`
- Create: `infra/docker/Dockerfile`
- Create: `infra/compose/production.yml`
- Create: `infra/caddy/Caddyfile`
- Create: `infra/env/staging.example`
- Create: tests/scripts necessary to inspect production build topology
- Modify: `.gitignore` only if required for new local runtime paths

**Steps:**

1. Write failing configuration/image smoke tests or deterministic scripts: no secrets in context, each target starts non-root, Compose exposes only Caddy, and no `postgres` service exists.
2. Run focused checks; observe expected failure because production files do not exist.
3. Implement multi-stage target builds from lockfile with minimal non-root runtime layers. Pin base images by digest or document automated digest update policy.
4. Add Compose services `caddy`, `web`, `api`, `worker`, `migrate`; use private network boundaries, health/restart/resource settings and SHA image variables. `migrate` must be one-shot.
5. Add Caddy same-origin routing: `/api/*` to API, all other requests to web; TLS/redirect, safe headers, request-size limit, timeouts and request-ID propagation. Do not route metrics or worker probes.
6. Add safe placeholder environment file and `docker compose ... config` verification.
7. Build targets and run provider-independent container smoke against fake staging values. Do not publish images or use secrets.
8. Commit only Task 1 files with `feat: add production container topology`.

**Acceptance:** Production config resolves without secrets, no DB is containerized, no non-Caddy public port appears, and all target images build/run as non-root.

## Task 2 — Web/worker health, secure configuration and shutdown

**Files:**

- Create: `apps/web/server/routes/health/live.get.ts`
- Create: `apps/worker/src/health-server.ts` and focused tests
- Modify: `apps/worker/src/main.ts`, `apps/worker/src/runtime.ts`, `apps/worker/src/config.ts`
- Modify: `apps/api/src/config/env.ts` only for necessary release/proxy/telemetry settings
- Modify: `.env.example`, `infra/env/staging.example`, Compose health checks
- Create/modify focused web, worker and API tests

**Steps:**

1. Write failing tests for safe web liveness, worker live/ready semantics, unready database/runtime state and SIGTERM stop order.
2. Implement web liveness route with static safe response.
3. Implement internal worker health server bound to private container interface. `/live` proves process; `/ready` requires successful worker runtime start plus database check. No job/user/config data in responses.
4. Expose readiness state from `WorkerRuntime` rather than copying job runner internals.
5. Extend Zod environment schemas only with required validated health/release/telemetry settings; production rejects unsafe/missing enabled integration values.
6. Wire Compose health checks to private health paths. Preserve API `HealthController` and `DatabaseHealthService`; do not duplicate its database semantics.
7. Run focused tests, typecheck, Compose config and staging-like container smoke.
8. Commit only Task 2 files with `feat: add production health checks`.

**Acceptance:** API, web and worker independently become healthy only under their documented conditions, return no sensitive data and terminate cleanly.

## Task 3 — Safe logs, metrics, tracing and error reporting

**Files:**

- Create: API/worker `observability` modules and tests
- Modify: `apps/api/src/app.ts`, `apps/api/src/common/logging/logger.ts`
- Modify: `apps/worker/src/logger.ts`, `apps/worker/src/main.ts`, worker runtime/job paths as required
- Modify: API/worker config schemas, production Compose and safe env examples
- Create: dashboard/alert contract documentation

**Steps:**

1. Write failing tests proving request correlation/outcome fields, worker outcome counters, metrics privacy and telemetry redaction.
2. Add internal Prometheus-compatible metric endpoints. Include release SHA, process health, HTTP count/latency/error class, database readiness/latency, worker poll/job outcomes, notification/export/login failures and resource metrics available from runtime.
3. Add request ID propagation and Pino request outcome events without raw payloads. Expand existing API logger redaction and add equivalent worker redaction.
4. Add environment-configured Sentry-compatible error reporter and OpenTelemetry-compatible exporter. Both sanitize data before egress and are disabled cleanly when endpoint is not configured.
5. Add tests that secrets, cookies, comments and financial values cannot reach logs/metrics/reporter payloads.
6. Document required dashboards, alert thresholds/owners and backend setup contract; no live DSN or dashboard URL enters Git.
7. Run focused tests, full static suite and container smoke.
8. Commit only Task 3 files with `feat: add runtime observability`.

**Acceptance:** Operator can correlate safe request/job outcomes and receive health/error signals without expanding public attack surface or exporting sensitive financial data.

## Task 4 — CI contract, image and security gates

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `scripts/openapi/*`, `scripts/ci/*` only if needed
- Modify: package scripts/dependencies only after proof
- Create: workflow test/validation documentation

**Steps:**

1. Write workflow-level acceptance checklist before modifying CI: existing quality/migration/seed/unit/integration/build/browser checks must remain.
2. Add deterministic OpenAPI JSON generation, lint and breaking-change comparison against `main`. Preserve `/api/v1` compatibility policy.
3. Add production image target builds, OCI metadata by commit SHA, SBOM, dependency scan and image scan. Define fail policy for actionable high/critical findings and evidence for reviewed exception.
4. Constrain action permissions, pin Actions or define managed update policy, and ensure PR jobs cannot access staging/production secrets.
5. Upload contract/build/SBOM/scan artifacts with SHA. Keep browser execution in CI.
6. Validate YAML/action configuration with available tooling and prove all existing repository commands still work.
7. Commit only Task 4 files with `ci: add release quality gates`.

**Acceptance:** A PR cannot merge when contract, image or required security gates fail; reports are retained and no deployment secret reaches PR jobs.

## Task 5 — Immutable publish, staging deploy and safe migrations

**Files:**

- Create: `.github/workflows/publish.yml`
- Create: `.github/workflows/deploy-staging.yml`
- Create: `infra/scripts/deploy.sh`, `infra/scripts/smoke.sh`, tests
- Modify: production Compose/config/docs as needed

**Steps:**

1. Write failing script tests for missing required variable, mutable image tag, failed migration, unhealthy service and previous SHA handling.
2. Build/publish exact OCI SHA images only from successful `main` revision. Registry credentials use GitHub Environment/registry permissions, never literals.
3. Implement staging deployment script: validate input, pull exact SHA, execute migration once, reconcile services, wait for API/web/worker probes, run safe smoke, publish redacted release metadata.
4. Configure `staging` GitHub Environment deployment after main. It may use environment-scoped credentials only.
5. On migration failure stop before rollout. On application failure permit rollback only to prior SHA when migration compatibility is explicitly confirmed; never run database rollback.
6. Test scripts in disposable local staging-like containers with fake values. Staging external deploy needs separate user confirmation and provisioning prerequisites.
7. Commit only Task 5 files with `ci: add staging deployment`.

**Acceptance:** Same published SHA is deployed to staging through one controlled migration, health and smoke sequence; failure state is explicit and non-destructive.

## Task 6 — Production approval and release automation

**Files:**

- Create: `.github/workflows/deploy-production.yml`
- Modify: deploy scripts and operational docs
- Create: production release checklist/evidence template

**Steps:**

1. Write acceptance test/checklist for production workflow inputs: only published SHA, manual dispatch, required staging evidence, GitHub Environment protection and no destructive rollback path.
2. Implement workflow dispatch selecting exact SHA, with `production` environment approval before credential access.
3. Require provided non-secret references to staging success, migration compatibility and backup/restore evidence; abort if absent.
4. Reuse staged deploy script with production environment input, explicit observation window and release evidence output.
5. Document human decision points and forbid production execution without explicit confirmation in the active session.
6. Validate workflow syntax and test input validation without contacting a production environment.
7. Commit only Task 6 files with `ci: add approved production deployment`.

**Acceptance:** Production deployment cannot happen through PR/main push and cannot use an unverified/mutable artifact or automatic destructive recovery.

## Task 7 — Provider capability, backup/restore and runbooks

**Files:**

- Create: `docs/operations/provider-capability-checklist.md`
- Create: `docs/operations/backup-restore-record.md`
- Create: `docs/operations/release-record.md`
- Create: `docs/operations/load-baseline-record.md`
- Create: `docs/runbooks/{deploy,image-rollback,database-restore,secret-rotation,postgres-outage,worker-failure,api-error-spike,suspicious-activity,account-data-request,incident-escalation}.md`

**Steps:**

1. Create provider-neutral provisioning checklist: isolated hosts/databases/domains, network/firewall, managed PostgreSQL with PITR, secret injection, SMTP, registry, observability, GitHub Environment protection and least privilege.
2. Document backup requirements, RPO/RTO, restore target isolation, evidence fields and cleanup. Do not include real backup references or commands that reset/destroy data.
3. Write operational runbooks with triggers, prerequisites, safe actions, evidence, escalation and prohibited shortcuts.
4. Create staging/production release records and non-destructive load baseline template for home, login, typical journal filter and worker polling checks.
5. Review documentation for no provider secrets, customer data or fabricated provider-specific commands.
6. Commit only Task 7 files with `docs: add production runbooks`.

**External hold point:** Stop before provisioning staging, restoring any backup or testing external service until user authorizes that exact operation and supplies secure access outside chat/repository.

**Acceptance:** An operator can evaluate provider suitability, prepare staging, execute safe recovery/release procedures and record evidence without relying on undocumented tribal knowledge.

## Task 8 — Staging acceptance, restore drill, review and controlled release

**No repository changes required unless findings need a separately approved fix.**

**Steps:**

1. With explicit authorization, provision staging using Task 7 checklist and deploy a fixed SHA through Task 5 workflow.
2. Verify private network exposure, TLS/session behavior, all probes, safe logs/metrics/traces/error reporting, and authenticated critical smoke journey.
3. With explicit authorization, restore approved staging or anonymized source into isolated target; measure RPO/RTO, verify schema/integrity, record results and securely remove restore target.
4. Run security review: workflow permissions, images/dependencies, TLS/headers/cookies, secret exposure, role/budget isolation regression, rate limits, telemetry redaction and public attack surface.
5. Execute reproducible non-destructive load baseline against staging. Compare observed home/login/journal API behavior with development-spec targets and record capacity/findings.
6. Fix confirmed findings as separate tasks with TDD and repeat affected evidence.
7. Prepare production release record. Production deploy requires separate explicit user confirmation after every precondition is evidenced.

## Final repository quality gate

Run after Tasks 1–7 and any approved remediation:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose -f infra/compose/local.yml config --quiet
docker compose --env-file infra/env/staging.example -f infra/compose/production.yml config --quiet
pnpm db:migrate
```

CI additionally proves browser tests, OpenAPI contract checks, production image builds, SBOM and dependency/image scans. External completion claims require fresh staging/backup/restore/release evidence; repository commands alone are not proof of provisioning or production readiness.
