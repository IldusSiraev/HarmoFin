# HarmoFin agent guidance

## Source of truth

- The [functional specification](docs/superpowers/specs/2026-08-30-family-budget-app-spec.md) is authoritative for product behavior, business rules, and acceptance criteria.
- The [development specification](docs/superpowers/specs/2026-08-30-family-budget-development-spec.md) is authoritative for architecture, implementation, operations, and technical choices.
- The [initialization design](docs/superpowers/specs/2026-08-30-project-initialization-design.md) defines the repository-only scope of the current initialization work.
- Prefer these sources over copied summaries. When they conflict, use the functional specification for behavior and the development specification for implementation.

## Current scope and planned architecture

This repository is currently metadata-only. The approved architecture is planned and has not been scaffolded: a TypeScript monorepo containing a Nuxt 4/Vue 3 web app, a NestJS/Fastify API, and a separate worker, backed by PostgreSQL and Prisma. The application is a modular monolith with clear domain modules, one transactional database, and OpenAPI contracts between web and API. Do not represent planned directories, services, or tooling as already present.

The MVP is for one active owner budget, while the data model and authorization boundaries must be ready for multiple budgets and future workspace roles. MVP exclusions remain explicit: bank statement import and bank integrations, Telegram or external notification delivery, full multi-currency conversion, credit/debt accounts, collaborative UI access, AI analysis, and SaaS billing.

## Financial correctness

- Never use floating-point values as the source of truth for money. Use integer minor units or decimal-safe handling; accept and validate decimal strings at API boundaries where appropriate.
- Financial calculations are performed or confirmed by the server, inside transactional application services. The frontend is not a source of truth for balances, limits, deficits, or aggregates.
- Only `CONFIRMED` operations affect calculations. Draft, cancelled, and logically deleted records do not.
- An income allocation must reference an income and the sum of allocations cannot exceed that income.
- A transfer's positive parts must sum exactly to its total; its source and destination accounts must differ.
- A transfer that preserves purpose does not change total account money or total envelope money; it only moves money between accounts. A deliberate envelope change must be represented as an explicit reallocation.
- Use idempotency for mutations where retrying could create a duplicate financial movement.

## Data isolation and authorization

Every query and mutation involving user data must enforce `workspace_id` and `budget_id` ownership, membership, and role access on the server. Check the full chain—authenticated user, workspace membership, budget access, role permission, object ownership, and object state—in application services/policies and in repository queries. Filter by budget in the database query itself; do not fetch another budget's rows and filter them afterward. UI visibility and route parameters are never sufficient authorization.

All related objects in a financial operation must belong to the same budget. Preserve audit history and use logical deletion for financial records.

## Authentication and secrets

Use Argon2id password hashes with a minimum password length of 10 characters, rate limits for sign-in and recovery, and one-time recovery tokens that are not stored in plaintext. Web authentication uses server-side sessions: HttpOnly cookies, Secure cookies in production, SameSite=Lax or stricter, session rotation after sign-in, revocation on sign-out/password change, and the ability to revoke all sessions. Never put authentication tokens in `localStorage`.

Never commit secrets or put them in a Dockerfile or client bundle. Obtain secrets from a secret manager, protected CI/CD secrets, or a local `.env` kept out of Git. Do not store or log full card numbers, CVV, bank passwords, payment credentials, passwords, session secrets, or full sensitive financial payloads.

## Engineering rules

- Use TypeScript strict mode and keep shared packages limited to client-safe contracts, types, and schemas; never put Prisma, SQL, secrets, repositories, or trusted-environment rules in client-shared packages.
- OpenAPI is the frontend/backend contract. Document and version every endpoint and its request, response, and error schemas; do not make breaking changes to `/api/v1` without a migration plan.
- Keep repository access in repositories, domain and financial rules in domain/application services, and HTTP translation in controllers. Controllers must not calculate money or access Prisma directly.
- Keep migrations in Git, make changes compatible with the surrounding deployment strategy, and do not use destructive production rollback commands without a backup and a recovery plan.
- Tests must cover financial calculations and invariants, transactionality, budget isolation, authorization, API/OpenAPI behavior, audit and logical deletion, idempotency, worker behavior, and critical responsive user journeys. Use the approved testing direction (Vitest and/or Jest with Supertest, plus Playwright).
- Meet accessibility expectations: keyboard operation, visible focus, sufficient contrast, labels and field-level errors, non-color-only status communication, screen-reader basics, and touch-friendly controls.
- Do not fabricate commands or dependencies. Install, development, migration, seed, test, and build commands are not available until implementation creates and verifies them. Update `README.md` when real commands appear.
- Write user-facing documentation and UI text in Russian. Use English for code identifiers, API names, and database schema.

## Working agreement

Read the source documents linked above before making product or architectural assumptions. Keep planned architecture separate from implemented code, preserve budget isolation and server-side financial correctness in every change, and avoid adding future features to MVP acceptance scope.
