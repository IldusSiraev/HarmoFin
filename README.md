# HarmoFin

HarmoFin is a planned web application for managing a personal and family budget. It connects the actual movement of money across accounts with the purpose assigned to that money in envelopes, and works with configurable financial cycles rather than calendar months alone.

## Current status

The product and development design are approved. Implementation has not started: the application scaffold, dependencies, services, and tests are not available yet. This repository currently contains project metadata and approved source documents only.

## MVP scope

The MVP is planned to include:

- email/password registration, sign-in, sign-out, password recovery, and server-managed sessions;
- a family budget with bank accounts, cards, cash, initial balances, envelopes, categories, and a configurable financial cycle;
- manually entered confirmed income, expenses, and transfers, including transfers split into parts;
- income allocation without duplicating the underlying income operation, including the configurable `Шабашка` rule;
- regular plans, in-app notifications, dashboard, basic analytics, export, an adaptive interface, logical deletion/recovery, and an audit history;
- a data model prepared for multiple budgets and future roles, while the MVP interface uses one active owner budget.

The MVP explicitly excludes:

- CSV/XLSX statement import and automatic bank connections or bank APIs;
- Telegram, email, and push notification delivery;
- full multi-currency conversion and credit/debt accounts;
- collaborative access in the user interface;
- AI analysis or recommendations;
- SaaS tariffs, subscriptions, and billing.

These exclusions are deliberate acceptance boundaries, not missing implementation tasks for the MVP.

## Approved technology direction

The planned stack is:

- **Web:** Nuxt 4.x, Vue 3.5+, TypeScript in strict mode, Pinia, TanStack Query for Vue;
- **UI and forms:** PrimeVue, Tailwind CSS, vee-validate, Zod, and ECharts;
- **API:** NestJS 11.x with Fastify, REST and OpenAPI contracts;
- **Data:** PostgreSQL 18.x, Prisma with controlled SQL, and PostgreSQL-backed jobs with a separate worker;
- **Authentication:** Argon2id, server-side sessions, and Secure HttpOnly cookies;
- **Infrastructure:** Docker and Docker Compose, managed PostgreSQL, and S3-compatible object storage;
- **Testing and operations:** Vitest and/or Jest with Supertest, Playwright, Sentry or a compatible error service, and OpenTelemetry with a Prometheus-compatible metrics backend.

Versions and dependencies will be introduced in a later implementation task. Nothing in this list implies that the tools are installed or configured now.

## Planned monorepo layout

The target layout is planned, not yet created:

```text
apps/       # web, api, and worker
packages/   # API contracts, validation, domain types, shared configuration
prisma/     # schema, migrations, and seed
infra/      # Docker, Compose, environments, and operational scripts
docs/       # architecture, API, runbooks, and ADRs
e2e/        # end-to-end tests
```

## Implementation stages

The approved implementation sequence is:

0. **Foundation:** monorepo metadata, runtime versions, quality tooling, local container plan, CI plan, README, and ADRs.
1. **Database and authentication:** schema, migrations, seed, users, sessions, workspaces, budgets, access guards, and initial audit support.
2. **Reference data and accounts:** accounts, initial balances, categories, envelopes, budget settings, base balance calculations, and settings pages.
3. **Operations and allocations:** income, expenses, income allocation, the `Шабашка` rule, cycles and periods, dashboard, operations, and filters.
4. **Transfers:** single- and multi-part transfers, envelope allocation, atomicity, idempotency, and balance tests.
5. **Plans and notifications:** recurring plans, occurrences, worker processing, internal notifications, and explicit confirmation before creating actual operations.
6. **Analytics and export:** reports, cycle trends, plan-versus-fact views, savings goals, accessible chart data, export, and responsive polish.
7. **Production readiness:** staging and production infrastructure, backup/PITR, restore drill, monitoring, runbooks, security review, load checks, acceptance tests, and controlled release.

## Commands

Install, development, migration, seed, test, and build commands are **not available yet**. Do not infer or invent commands from the planned stack. This section will be updated when real project commands are added.

## Security baseline

- Never commit secrets or place them in images or client bundles.
- Calculate and validate financial values on the server; use integer-safe minor units or decimal-safe handling rather than floating-point truth.
- Enforce workspace and budget isolation on the server for every relevant operation.
- Do not put passwords, session secrets, payment details, or sensitive financial payloads in logs.
- Store only the payment information needed by the product; full card numbers, CVV, and bank credentials are not part of the model.

## Approved sources

- [Functional specification](docs/superpowers/specs/2026-08-30-family-budget-app-spec.md)
- [Development specification](docs/superpowers/specs/2026-08-30-family-budget-development-spec.md)
- [Project initialization design](docs/superpowers/specs/2026-08-30-project-initialization-design.md)
- [Initial categories](categories.txt)

These documents are the source of product and technical requirements. The functional specification governs product behavior; the development specification governs implementation choices.

## License

No usage license is granted until a `LICENSE` file is added to the repository.
