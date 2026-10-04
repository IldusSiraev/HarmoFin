# Envelope Plan Model v2.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать Envelope Plan Model v2.1: планы и разметка дохода как назначения (не хранилища денег), funding rules, draft/confirmed lifecycle, новые dashboard-агрегаты и одноразовая миграция текущего бюджета.

**Architecture:** Сервер (NestJS/Fastify + Prisma/PostgreSQL 18) получает 3 новые сущности (`PeriodPlan`, `EnvelopeFundingRule`, `PlanProposal`), `DRAFT` в разметках и пересчитанные агрегаты в dashboard. Правило формируется при подтверждении дохода — в той же транзакции. Web (Nuxt 4) переключается на новый dashboard endpoint. Legacy-поля (starting_balance, reallocations, transfer_parts, period_slot) остаются read-only.

**Tech Stack:** TypeScript strict, NestJS + Fastify, Prisma + raw SQL (integer minor units), Vitest + Supertest (unit: `pnpm test` в `apps/api`, integration: `pnpm test:integration`), Vitest в `apps/web`, Playwright (`pnpm test:e2e`), pnpm 11.24.0 / Node 24.20.0.

**Spec:** `docs/superpowers/specs/2026-09-28 HarmoFin_Envelope_Plan_Model_v2.1.md` (источник истины). Файл плана: `docs/superpowers/plans/2026-09-28-envelope-plan-model-v2.1.md`.

## Global Constraints

- Деньги: integer minor units, валидация decimal-строк на границе API. НИГДА не `number` для денег в домене.
- Единственный жёсткий инвариант: `баланс(счёта) = starting + Σ доход(CONFIRMED) − Σ расход(CONFIRMED) ± переводы(CONFIRMED)`. Планы/разметки/конверты НЕ меняют баланс счёта.
- Только `CONFIRMED` операции — финансовые факты. ДRAFT не влияет на балансы/отчёты.
- Изоляция `workspace_id`/`budget_id` в каждом запросе (фильтр в SQL, не post-fetch).
- Все финансово значимые мутации — идемпотентные (существующий `IdempotencyService`).
- Аудит (audit) на изменения планов/разметок/правил; логическое удаление финансов; `NOW()` в legacy raw-SQL.
- Правила (funding rules): ≤1 активного на конверт; действуют только вперёд; никогда не меняют подтверждённый план/разметку молча — только черновик или `PlanProposal`.
- UI-тексты — по-русски; код/имена endpoint — по-английски. В UI не использовать: `allocation`, `reallocation`, `starting_balance`, `funding rule`, `balance convergence`, «Свободные» как конверт, replace/transfer parts.
- API `/api/v1`: breaking change по семантике конвертов разрешён ТОЛЬКО в новых endpoint'ах + `plan_model_version = 2`. Старые endpoint'ы живут до Task A11.
- Не коммитить вне шагов «Commit». Не удалять legacy-колонки из схемы (только read-only).
- Не трогать `identity/logo_description.png`.

---

## Д. Доменный контракт (исходный из spec + review-решения 29.09.2026)

Этот блок — семантика. Tasks не переформулируют его, а ссылаются.

### Д.1. Формулы (все — на сервере, period = текущий, из `cycleAndPeriodFor()`)

```text
available_cash      = Σ текущих балансов всех счетов (CONFIRMED-only)
reserved_by_plans   = Σ max(0, remaining(e, P)) по confirmed-планам текущего периода P
spendable_cash      = available_cash − reserved_by_plans            (может быть < 0 → предупреждение)
remaining(e, P)     = allocated(e, P) − spent(e, P)                  (может быть < 0 → «Превышение»)
allocated(e, P)     = Σ confirmed income_allocations на конверт e, occurred_on ∈ P
                     (join: соответствующий доход не CANCELLED/DELETED; учёт по allocation.occurred_on)
spent(e, P)         = Σ confirmed расходов, envelopeId = e, occurred_on ∈ P
unallocated (all-time) = Σ confirmed доходы − Σ confirmed разметки
                     (join: доход разметки не CANCELLED/DELETED)
```

### Д.2. Сумма плана по типу funding rule

| rule | `plan_amount(e, P)` |
|---|---|
| `MANUAL` | `PeriodPlan.amount` (confirmed snapshot) |
| `FIXED_MONTHLY` | `PeriodPlan.amount` (snapshot; черновик создаётся на `fixed_amount` при новом периоде) |
| `SUM_OF_PLANS` | `PeriodPlan.amount` (snapshot при подтверждении = Σ confirmed планов детей периода P) |
| `PERCENT_OF_INCOME` | **Σ confirmed аллокаций периода** (явное исключение из «snapshot на старт»: сумма на старт неизвестна; `plan_source = 'ALLOCATIONS'`, строки `PeriodPlan` НЕ создаются) |

### Д.3. Жизненные циклы

- `PeriodPlan`: `DRAFT → CONFIRMED` (явное действие, аудит) или `DRAFT → REJECTED`; подтверждённый меняется только явным `PATCH` с аудитом (§31.4/§31.7; `sum_of_plans` — при изменении детей система создаёт предложение, не молча).
- `IncomeAllocation`: `DRAFT → CONFIRMED` (проверка Σ confirmed + new ≤ доход, иначе 409 `ALLOCATION_EXCEEDS_INCOME`) или `DRAFT → CANCELLED`. DRAFT не участвует в лимите до подтверждения.
- `PlanProposal`: `PROPOSED → APPLIED` (меняет confirmed-план на `proposed_amount`, аудит) или `→ DISMISSED`.
- Доход отредактирован: confirmed-разметки не меняются; DRAFT-разметки не меняются; при overflow → 409/предупреждение (§8.7). Доход удалён/отменён: confirmed — существующий flow (`409 INCOME_HAS_CONFIRMED_ALLOCATIONS` или `deleteWithAllocations(CANCEL|DELETE)`), DRAFT-разметки → автоматически `CANCELLED` в той же транзакции (§8.8).
- Перевод: чистое движение денег; `transfer_parts` в новой модели не используются (§13, §26).

### Д.4. Схема (new/changed)

```prisma
enum PlanStatus { DRAFT CONFIRMED REJECTED }
enum FundingRuleType { MANUAL SUM_OF_PLANS FIXED_MONTHLY PERCENT_OF_INCOME }
enum ProposalStatus { PROPOSED APPLIED DISMISSED }

model PeriodPlan {
  id          String     @id @default(uuid())
  budgetId    String     @map("budget_id")
  envelopeId  String     @map("envelope_id")
  periodStart DateTime   @map("period_start") @db.Date
  periodEnd   DateTime   @map("period_end") @db.Date
  status      PlanStatus @map("status")
  amountMinor BigInt     @map("amount_minor")
  createdAt   DateTime   @map("created_at") @default(now())
  updatedAt   DateTime   @map("updated_at")
  budget      Budget     @relation(...)  // по существующим alias
  envelope    Envelope   @relation(...)
  @@unique([budgetId, envelopeId, periodStart])
  @@map("period_plans")
}

model EnvelopeFundingRule {
  id               String          @id @default(uuid())
  envelopeId       String          @unique @map("envelope_id")
  ruleType         FundingRuleType @map("rule_type")
  fixedAmountMinor BigInt?         @map("fixed_amount_minor")
  percentBps       Int?            @map("percent_bps")  // 0..10000
  createdAt/updatedAt
  @@map("envelope_funding_rules")
}

model PlanProposal {
  id                        String        @id @default(uuid())
  budgetId/envelopeId       (budget, envelope relation)
  periodStart       DateTime      @map("period_start") @db.Date
  sourceIncomeTransactionId String?   @map("source_income_transaction_id") // null для sum_of_plans
  proposedAmountMinor BigInt      @map("proposed_amount_minor")
  status              ProposalStatus @map("status")
  createdAt/updatedAt
  @@index([budgetId, status])
  @@map("plan_proposals")
}
```

Изменения в существующих:
- `IncomeAllocationStatus` += `DRAFT`.
- `IncomeAllocation` += `periodPlanId String?` (relation → `PeriodPlan`, nullable) — заполняется при `DRAFT→CONFIRMED`, если для конверта/периода существует confirmed-план.
- `Envelope` += `parentEnvelopeId String?` (self-relation; обратное `childEnvelopes Envelope[]`) — для `SUM_OF_PLANS`.
- `Budget` += `planModelVersion Int @default(2) @map("plan_model_version")`.

### Д.5. Новый dashboard endpoint

`GET /api/v1/budgets/:budgetId/dashboard` (новый; старый `GET /:budgetId/summary` живёт до A11):

```ts
interface V2DashboardResponse {
  modelVersion: 2;
  period: { start: string; end: string };          // 'YYYY-MM-DD'
  availableCash: Money;                              // { amountMinor: string; currency: 'RUB'; scale: 2 }
  reservedByPlans: Money;
  spendableCash: { amountMinor: string; currency: 'RUB'; scale: 2; state: 'POSITIVE' | 'NEGATIVE' };
  unallocated: Money;                                // all-time (Д.1)
  accounts: { accountId: string; name: string; balance: Money }[];
  plans: {
    envelopeId: string; envelopeName: string;
    ruleType: FundingRuleType | null;
    planSource: 'SNAPSHOT' | 'ALLOCATIONS';
    planAmount: Money; allocated: Money; spent: Money; remaining: Money;
    status: 'COVERED' | 'SHORTFALL' | 'EXCEEDED' | 'NO_PLAN';
  }[];
  futureObligations: Money;                          // Σ confirmed планов будущих периодов (только отображение)
  pending: {
    periodPlanDrafts: { envelopeId: string; envelopeName: string; periodStart: string; amount: Money }[];
    allocationDrafts: { incomeTransactionId: string; envelopeId: string; envelopeName: string; amount: Money }[];
    planProposals: { envelopeId: string; envelopeName: string; proposedAmount: Money; sourceIncomeId: string | null }[];
  };
  attention: {
    type: 'UNALLOCATED' | 'SHORTFALL' | 'EXCEEDED' | 'ALLOCATION_DRAFT' | 'PERIOD_PROPOSAL';
    envelopeId: string | null; amount: Money | null; actionPath: string;
  }[];
}
```

Статусы плана: `COVERED` (allocated ≥ plan), `SHORTFALL` (allocated < plan, spent ≤ allocated), `EXCEEDED` (remaining < 0), `NO_PLAN` (нет подтверждённого плана; для `MANUAL`/`PERCENT`).

### Д.6. Endpoint'ы (новые, `/api/v1`)

```text
GET    /budgets/:budgetId/period-plans?periodStart=YYYY-MM-DD
POST   /budgets/:budgetId/period-plans/drafts            { envelopeId, periodStart?, amountMinor? }  // amount: для manual; null → правило (fixed/sum)
POST   /budgets/:budgetId/period-plans/:planId/confirm
POST   /budgets/:budgetId/period-plans/:planId/reject
PATCH  /budgets/:budgetId/period-plans/:planId           { amountMinor }  // draft — свободно; confirmed — явное, с аудитом
GET    /budgets/:budgetId/funding-rules
PUT    /budgets/:budgetId/envelopes/:envelopeId/funding-rule   { ruleType, fixedAmountMinor?, percentBps?, childEnvelopeIds? }
POST   /budgets/:budgetId/allocations/:allocationId/confirm
POST   /budgets/:budgetId/allocations/:allocationId/reject
GET    /budgets/:budgetId/allocations/drafts
GET    /budgets/:budgetId/plan-proposals
POST   /budgets/:budgetId/plan-proposals/:id/apply
POST   /budgets/:budgetId/plan-proposals/:id/dismiss
GET    /budgets/:budgetId/dashboard
```

Правило в income-confirmation flow (в существующей транзакции `transaction.confirm`):
для каждого неархивного конверта с правилом `PERCENT_OF_INCOME` (и если нет DRAFT-allocation на `(income, envelope)`):
1. `amount = round_incoming(income.amount × percentBps / 10000)`; если `amount > 0` → создать **DRAFT** allocation (account = счёт дохода).
2. Если у конверта есть **confirmed** `PeriodPlan` периода дохода: `proposed = план + amount` → создать `PlanProposal(PROPOSED)` (idempotency: один PROPOSED на `(envelope, period, income)`).
Другие типы правил при подтверждении дохода ничего не создают (§8.5).

---

## Track A — Backend

### Task A1: Schema + миграция Prisma

**Files:**
- Modify: `prisma/schema.prisma` (Д.4, ровно по коду блока)
- Create: `prisma/migrations/<ts>_add_period_plan_model/migration.sql` (через `pnpm db:migrate:dev --create-only`-паттерн репо — проверить существующие migrations)
- Test: `apps/api/src/period-plans/period-plan.repository.test.ts` (smoke: upsert+get)

**Interfaces:**
- Produces: Prisma models `PeriodPlan`, `EnvelopeFundingRule`, `PlanProposal`, enum'ы; `PeriodPlanRepository` (см. A3) — пока только сгенерированные типы клиента.

- [ ] **Step 1: Изменить `schema.prisma`** по Д.4 (модели, enum'ы, relations, `parentEnvelopeId`, `periodPlanId`, `planModelVersion`).
- [ ] **Step 2: Сгенерировать и применить миграцию** локально (`pnpm db:generate`; `pnpm db:migrate:dev` или create-only + apply в dev-БД). Проверить: `@@unique([budgetId, envelopeId, periodStart])`, nullable-колонки.
- [ ] **Step 3: Запустить** `pnpm typecheck` в `apps/api` — PASS (тип клиента обновлён).
- [ ] **Step 4: Запустить** `pnpm test` в `apps/api` — PASS (нichts ломается; legacy-колонки не тронуты).
- [ ] **Step 5: Commit** `feat(prisma): add period plan model schema`

### Task A2: Домен формул (unit)

**Files:**
- Create: `apps/api/src/period-plans/plan-metrics.domain.ts`
- Test: `apps/api/src/period-plans/plan-metrics.domain.test.ts`

**Interfaces:**
- Consumes: Д.1, Д.2; `formatMinorUnits` (apps/api/src/common, как в `dashboard.application.service.ts`).
- Produces:
  ```ts
  type PlanMetricsInput = { allocatedMinor: bigint; spentMinor: bigint; planAmountMinor: bigint | null; planSource: 'SNAPSHOT' | 'ALLOCATIONS' };
  function planRemainingMinor(allocated: bigint, spent: bigint): bigint;               // allocated − spent
  function planStatus(input: { planAmountMinor: bigint | null; allocatedMinor: bigint; spentMinor: bigint }): 'COVERED'|'SHORTFALL'|'EXCEEDED'|'NO_PLAN';
  function reservedByPlansMinor(rows: { plannedAmountMinor: bigint; allocatedMinor: bigint; spentMinor: bigint }[]): bigint; // Σ max(0, allocated − spent), только confirmed-планы (фильтр на входе — status)
  function spendableMinor(availableCash: bigint, reserved: bigint): { amount: bigint; state: 'POSITIVE'|'NEGATIVE' };
  function percentOfIncome(incomeMinor: bigint, percentBps: number): bigint;            // round half away from zero? — нет: Math.round, floor для положительного; 0bps → 0n
  function sumOfPlansMinor(childAmounts: bigint[]): bigint;
  ```

- [ ] **Step 1: Пишущие-файлы тесты** `plan-metrics.domain.test.ts`:
  ```ts
  it('remaining = allocated - spent, может быть отрицательным', () => {
    expect(planRemainingMinor(20_000_00n, 25_000_00n)).toBe(-5_000_00n);
    expect(planStatus({ planAmountMinor: 50_000_00n, allocatedMinor: 20_000_00n, spentMinor: 5_000_00n })).toBe('SHORTFALL'); // 20 < 50
    expect(planStatus({ planAmountMinor: 20_000_00n, allocatedMinor: 25_000_00n, spentMinor: 30_000_00n })).toBe('EXCEEDED');
    expect(reservedByPlansMinor([
      { plannedAmountMinor: 50_000_00n, allocatedMinor: 80_000_00n, spentMinor: 0n },          // 80 000
      { plannedAmountMinor: 10_000_00n, allocatedMinor: 20_000_00n, spentMinor: 25_000_00n },  // -5 000 → 0
    ])).toBe(80_000_00n);
    expect(percentOfIncome(100_000_00n, 3000)).toBe(30_000_00n);
    expect(percentOfIncome(50_001_00n, 3000)).toBe(15_000_30n);
  });
  it('spendable: 200 000 − 170 000; и отрицательный случай 70 000 − 80 000', () => {
    expect(spendableMinor(200_000_00n, 170_000_00n)).toEqual({ amount: 30_000_00n, state: 'POSITIVE' });
    expect(spendableMinor(70_000_00n, 80_000_00n)).toEqual({ amount: -10_000_00n, state: 'NEGATIVE' });
  });
  ```
- [ ] **Step 2: Run** `pnpm --filter api test plan-metrics` (или `pnpm test` в `apps/api`, фильтр по файлу) — FAIL (нет модуля).
- [ ] **Step 3: Реализовать** `plan-metrics.domain.ts` по сигнатурам выше (только bigint, без side effects).
- [ ] **Step 4: Run** тест — PASS.
- [ ] **Step 5: Commit** `feat(api): plan metrics domain formulas`

### Task A3: Repository — new SQL-агрегаты

**Files:**
- Create: `apps/api/src/period-plans/period-plan.repository.ts`
- Modify: `apps/api/src/dashboard/dashboard.repository.ts` (add function'ы; не менять существующие до A10)
- Test: `apps/api/test/period-plan.repository.integration.test.ts`

**Interfaces:**
- Consumes: Prisma client (A1); Д.1.
- Produces (все с `tx: Prisma.TransactionClient`, `budgetId: string`, `period: { start: Date; end: Date }`):
  ```ts
  availableCashMinor(tx, budgetId): Promise<bigint>                      // reuse логики financial-balance: Σ starting + Σ INCOME − Σ EXPENSE ± transfer (CONFIRMED), по всем счетам бюджета
  periodAllocatedAndSpent(tx, budgetId, period): Promise<{ envelopeId: string; allocatedMinor: bigint; spentMinor: bigint }[]>
  // allocated: SELECT allocation.envelope_id, SUM(amount) FROM income_allocations a JOIN transactions t ON t.id = a.income_transaction_id
  //            WHERE a.budget_id=? AND a.status='CONFIRMED' AND t.status='CONFIRMED' AND a.occurred_on >= ? AND a.occurred_on < ? GROUP BY 1
  // spent:      SELECT t.envelope_id, SUM(t.amount) FROM transactions t WHERE t.budget_id=? AND t.type='EXPENSE' AND t.status='CONFIRMED' AND t.occurred_on ∈ [start,end) GROUP BY 1
  unallocatedAllTimeMinor(tx, budgetId): Promise<bigint>
  // SELECT (Σ INCOME CONFIRMED − Σ (alloc CONFIRMED JOIN t.status='CONFIRMED'))::BIGINT — DANGER: без join по t статусу dangling-разметки считаются; join ОБЯЗАТЕЛЕН (ревью point 1)
  futureObligationsMinor(tx, budgetId, from: Date): Promise<bigint>      // Σ confirmed PeriodPlan.amount, periodStart >= from
  upsertPeriodPlanDraft / findPeriodPlans(tx, budgetId, period) / findConfirmedPeriodPlans
  createPlanProposal / findPlanProposalsByStatus / updatePlanProposalStatus
  ```

- [ ] **Step 1: Integration-тест** `period-plan.repository.integration.test.ts` (pattern как `apps/api/test/dashboard-summary.integration.test.ts`: test DB, seed через Prisma):
  - seed: budget (cycleStartDay=10, boundary=15), 2 аккаунта, income 100 000 (2026-09-12, CONFIRMED), allocation 30 000 (2026-09-12, CONFIRMED) на конверт E1, расход 12 000 (E1, 2026-09-15), PeriodPlan confirmed E1 (period 2026-09-10..25) amount 50 000; income 50 000 (2026-08-12, CANCELLED) с allocation 10 000 (CONFIRMED — dangling).
  - assert: `availableCash` = Σ стартовых ± движения по факту; `periodAllocatedAndSpent` → E1: allocated 30 000 (cancel-инкама не учитывается), spent 12 000; `unallocatedAllTime` = (100 000) − (30 000 + 0) = 70 000 (dangling 10 000 НЕ вычитается, потому что доход CANCELLED — join); `futureObligations` при from=2026-09-25 → 0.
- [ ] **Step 2: Run** `pnpm --filter api test:integration` (файл) — FAIL.
- [ ] **Step 3: Реализовать** raw-SQL по комментам (параметры как `$${...}::uuid` — по существующим примерам в `dashboard.repository.ts`).
- [ ] **Step 4: Run** — PASS. `pnpm typecheck` в api — PASS.
- [ ] **Step 5: Commit** `feat(api): period plan metrics repository`

### Task A4: CRUD + lifecycle `PeriodPlan` (service + controller)

**Files:**
- Create: `apps/api/src/period-plans/period-plan.service.ts`, `period-plan.controller.ts`, `period-plan.schemas.ts` (zod, как в соседних модулях)
- Modify: `apps/api/src/app.module.ts` (модуль)
- Test: `apps/api/test/period-plans.integration.test.ts`, `apps/api/src/period-plans/period-plan.service.test.ts`

**Interfaces:**
- Consumes: A3 (repository), A2 (`planStatus`), `IdempotencyService` (pattern `transaction.application.service.ts`), audit pattern как в `envelope.application.service.ts`.
- Produces (Д.6 endpoints, статусы Д.3):
  ```ts
  service.list(budgetId, periodStart?): PeriodPlanView[]          // + rule/allocated/spent/remaining (join A3)
  service.createDraft(budgetId, envelopeId, period, amountMinor?): PeriodPlanView
  service.confirm(budgetId, planId): PeriodPlanView               // DRAFT→CONFIRMED; если rule=SUM_OF_PLANS → amount = Σ children confirmed на момент confirm (АУДИТ old→new)
  service.reject(budgetId, planId): PeriodPlanView                // DRAFT→REJECTED
  service.updateAmount(budgetId, planId, amountMinor): PeriodPlanView // любой статус, только явный; confirmed → аудит
  ```
  View: `{ id, envelopeId, envelopeName, periodStart, periodEnd, status, amount, ruleType, planSource, allocated, spent, remaining, planAmount, planStatus }` (amount в `formatMinorUnits`-вид).

- [ ] **Step 1: Integration-тесты** (супertest по pattern `plans.integration.test.ts`): create draft → list; confirm → amount snapshot при SUM_OF_PLANS (children: 20 000 + 3 000 = 23 000); confirm draft повторно → 409; reject confirmed → 409; update amount DRAFT → 200 + audit-запись; PATCH confirmed → 200 + audit (стара́я→новая); isolation: budget A не видит бюджет B (404).
- [ ] **Step 2: Run** — FAIL (нет endpoint'ов).
- [ ] **Step 3: Реализовать** service (идемпотентность по pattern: key `period-plan.confirm:<id>`), controller (routes Д.6), zod-схемы, OpenAPI description.
- [ ] **Step 4: Run** — PASS. Unit-тесты service (confirm/reject/update amount state machine — `period-plan.service.test.ts`, без БД: моки репозитория как в `dashboard.application.service.test.ts`).
- [ ] **Step 5: Commit** `feat(api): period plans lifecycle API`

### Task A5: `EnvelopeFundingRule` CRUD

**Files:**
- Create: `apps/api/src/funding-rules/funding-rule.service.ts`, `funding-rule.controller.ts`, `funding-rule.repository.ts`
- Test: `apps/api/test/funding-rules.integration.test.ts`

**Interfaces:**
- Consumes: A1 (models), A4 (`PeriodPlan` для children).
- Produces:
  ```ts
  GET  /budgets/:budgetId/funding-rules   → { envelopeId, ruleType, fixedAmount?, percentBps?, childEnvelopes: string[] }[]
  PUT  /budgets/:budgetId/envelopes/:id/funding-rule { ruleType, fixedAmountMinor?, percentBps?, childEnvelopeIds? }
  ```
  Валидации: `PERCENT` ⇒ `percentBps` 0..10000; `FIXED` ⇒ `fixedAmountMinor` > 0; `SUM_OF_PLANS` ⇒ `childEnvelopeIds` не пусто; children ≠ parent (cycles запрещены: child не может быть потомком родителя через другую цепь — проверка одного уровня достаточно + child ≠ self); child может иметь только одного parent (update `parentEnvelopeId`, сброс старого); конверт archived → 409.

- [ ] **Step 1: Тесты** (как A4): upsert-семантика PUT; inвалидные combos → 400; cycle child=self → 400; archived → 409; isolation 404.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать** (1 строка правила на конверт — upsert по `envelopeId` идемпотентно; аудит изменений).
- [ ] **Step 4: Run** — PASS + typecheck.
- [ ] **Step 5: Commit** `feat(api): funding rules API`

### Task A6: Rule engine при подтверждении дохода

**Files:**
- Modify: `apps/api/src/transactions/transaction.application.service.ts` (`confirm`: после `occurrences.completeForConfirmedTransaction` добавить вызов)
- Create: `apps/api/src/period-plans/income-proposal.service.ts` (имя — в plan-модуле; логика Д.6)
- Test: `apps/api/test/income-proposal.integration.test.ts`, `apps/api/src/period-plans/income-proposal.service.test.ts`

**Interfaces:**
- Consumes: A3 (find DRAFT allocations по income), A4 (`findConfirmedPeriodPlans`), A5 (правила), A2 (`percentOfIncome`).
- Produces:
  ```ts
  incomeProposalService.proposeForConfirmedIncome(tx, budget, income: {id, amountMinor, accountId, occurredOn}, userId, requestId): Promise<void>
  ```
  Логика ровно Д.6. Идемпотентность: guard «нет DRAFT-allocation на (income, envelope)» + guard «нет PROPOSED PlanProposal на (envelope, period, income)» — повторный вызов = no-op (в любом случае confirm дохода one-shot: DRAFT→CONFIRMED terminal).

- [ ] **Step 1: Unit** (без БД): percent 30% × 100 000 = 30 000 → draft; 0% → нет; 120% → draft 120 000 (warning, не ошибка); percent + confirmed plan 30 000 → proposal 30 000 + 15 000; повторный вызов с существующим DRAFT → no дублей (mock-верификация).
- [ ] **Step 2: Integration**: budget, конверт E (rule PERCENT 30%), доход 100 000 → confirm → 1 DRAFT-allocation 30 000; confirmed plan E на периоде → 1 PlanProposal PROPOSED 15 000? нет: `проposed = план + 30 000`; second confirm impossible (state) — идемпотентность проверить повторным `POST confirm` → 409 без дублей.
- [ ] **Step 3: Run** — FAIL; **Step 4: Реализовать**; **Step 5: Run** — PASS; **Step 6: Commit** `feat(api): income confirmation funding rule engine`

### Task A7: Draft lifecycle для разметок + cleanup при delete/modify дохода

**Files:**
- Modify: `apps/api/src/allocations/income-allocation.controller.ts`, `.application/service` (модуль `allocations`), `apps/api/src/transactions/transaction.application.service.ts` (`update` income: после 409-проверки — auto-cancel DRAFTs при overflow? нет: DRAFTs остаются, но `create`/`confirm` проверяет Σ; `delete`/`cancel` income — DRAFTs → CANCELLED в той же trans), `prisma` — уже A1.
- Test: `apps/api/test/income-allocations-draft.integration.test.ts`

**Interfaces:**
- Consumes: A1 (DRAFT enum), A2, existing `assertAllocationTotal` (repo :82-109 — extends: Σ подтверждённых + new ≤ income, DRAFT не входит).
- Produces (Д.6):
  ```ts
  POST /allocations/:id/confirm   // DRAFT→CONFIRMED; if Σ confirmed + this > income → 409 ALLOCATION_EXCEEDS_INCOME; fill periodPlanId (confirmed plan периода occurredOn, если есть)
  POST /allocations/:id/reject    // DRAFT→CANCELLED
  GET  /allocations/drafts        // по бюджету
  // существующие: edit/delete confirmed — без изменений; income delete/cancel → DRAFTs auto CANCELLED (та же транзакция, без запроса пользователя — Д.3)
  ```

- [ ] **Step 1: Тесты**: create DRAFT (через income-proposal flow A6 или ручной POST с draft-флагом — реальный path: rule flow) → confirm → amount входит в лимит; overflow → 409; reject → CANCELLED + лимит свободен; income delete с DRAFTs → DRAFTs CANCELLED, confirmed path — как сейчас (409 / with resolutions); income edit 100 000→20 000 при confirmed 30 000 → 409 (как сейчас, `allocationsExceedIncome`), DRAFTs не тронуты.
- [ ] **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(api): income allocation draft lifecycle`

### Task A8: Worker job — черновики планов нового периода

**Files:**
- Modify: `apps/worker/src` (найти существующий job-паттерн `MATERIALIZE_PLAN_OCCURRENCES` — grep в `apps/worker`)
- Create (в api): `apps/api/src/period-plans/period-rollover.service.ts` (чистая логика, вызывается job'ом и/или dashboard lazy-check)
- Test: `apps/api/test/period-rollover.integration.test.ts`

**Interfaces:**
- Consumes: A3, A4, A5, `cycleAndPeriodFor` (`apps/api/src/cycles/cycle-period.domain.ts:30`).
- Produces:
  ```ts
  periodRolloverService.materializeDraftsForNewPeriod(budget): number  // кол-во созданных DRAFT
  // per неархивного конверта: FIXED → DRAFT(fixedAmount); SUM_OF_PLANS → DRAFT(Σ children: confirmed, если нет — amount draft); MANUAL/PERCENT → 0; no plan row for (budget, envelope, periodStart) only
  ```
  Job: при входе бюджета в новый период (по `cycleAndPeriodFor` для `today` vs. последний обработанный период) — один `WorkerJob` (идемпотентный по pattern существующих jobs).

- [ ] **Step 1: Тесты**: budget с 4 конвертами (FIXED 20k, SUM (children 15k+3k), MANUAL, PERCENT) → `materializeDraftsForNewPeriod` → 2 DRAFT (20 000; 18 000); повторный вызов → 0 создано; confirmed plan на периоде → DRAFT не создаётся.
- [ ] **Step 2: Run** — FAIL. **Step 3: Реализовать** service + job. **Step 4: Run** — PASS (+ worker-тест по pattern `apps/worker` test'ов, если есть). **Step 5: Commit** `feat(worker): period rollover plan drafts`

### Task A9: Новый dashboard endpoint + deprecation старого в ответах

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.repository.ts` (add `v2Summary(tx, budget, asOf)`), `dashboard.service.ts` (add `getV2`), `dashboard.controller.ts` (`GET budgets/:budgetId/dashboard`), `openapi.json` (через существующий ген/реген flow — проверить `openapi.json` в корне и как он собирается)
- Test: `apps/api/test/dashboard-v2.integration.test.ts`

**Interfaces:**
- Consumes: A2, A3, A4, A5, `cycleAndPeriodFor`.
- Produces: `V2DashboardResponse` (Д.5) — ровно по shape; `spendableCash.state`; `attention` — элементы в порядке: `UNALLOCATED` (if unallocated > 0), `SHORTFALL`/`EXCEEDED` (per-plan), `ALLOCATION_DRAFT`, `PERIOD_PROPOSAL`; `planSource='ALLOCATIONS'` для PERCENT (planAmount = allocated).

- [ ] **Step 1: Тест** (scenario §16/§28): бюджет из A3-seed + numbers: available 206 000; plans: Обязательные (SUM: 20+3+15+40=78k, allocated 65k, spent 32k, remaining 33k → COVERED? allocated 65 < 78 → SHORTFALL 13k), Ремонт 50k (alloc 40, spent 12, rem 28, SHORTFALL 10); unallocated 35 000; reserved = 33+28 = 61k… (per test data — assert exact); `spendable = 206 000 − reserved`. Negative case: spent > allocated.
- [ ] **Step 2: Run** — FAIL. **Step 3: Реализовать** `getV2` (composition из A3 queries + A2; one raw roundtrip где можно — как `dashboard.repository.ts` делает сейчас). **Step 4: Run** — PASS + typecheck + openapi regen. **Step 5: Commit** `feat(api): v2 dashboard endpoint`

### Task A10: `plan_model_version` в API + OpenAPI

**Files:**
- Modify: `apps/api/src/budgets` (budget view: +`planModelVersion`), `openapi.json`

**Interfaces:** produces: `BudgetResponse.planModelVersion: number` (=2 для всех бюджетов после A1-дефолта).

- [ ] **Step 1: Тест**: GET budget включает `planModelVersion: 2`; GET dashboard — `modelVersion: 2`. **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS. **Step 5: Commit** `feat(api): expose plan model version`

### Task A11: One-off migration текущего бюджета

**Files:**
- Create: `scripts/migrate-budget-v2.ts` (tsx, по pattern других scripts в `scripts/` — проверить), `scripts/migrate-budget-v2.sql` (invariant checks)
- Test: `apps/api/test/migrate-budget-v2.integration.test.ts` (dry-run на test DB с seed, повторяющим прод: 681 134,70 / 139 738,76)

**Interfaces:**
- Consumes: A1–A9 live schema.
- Produces: script с флагами `--dry-run`, `--rollback`; шаги:
  1. Snapshot: `CREATE TABLE backup_20260929_<t> AS SELECT *` для `period_plans`, `plan_proposals`, `envelope_funding_rules` (пустые) + current-state snapshot ключевых таблиц (allocations, transactions — read-only).
  2. Mapping (без финансовых движений): для каждого конверта с allocated > 0 за текущий период (legacy semantics: `Σ confirmed allocations` по конверту за период) → `PeriodPlan CONFIRMED` (amount = allocated, period = текущий); rules: если конверт был sum-агрегатором — flag `SUM_OF_PLANS` (детерминация по данным); `Budget.plan_model_version = 2` (уже 2 по дефолту — verify).
  3. Verify: `SELECT` account-balance (formula §3.1) = **681 134,70 ₽** (68113470 minor); `unallocatedAllTimeMinor` = **139 738,76 ₽** (13973876 minor).
  4. На failure: rollback snapshot + `abort release`.

- [ ] **Step 1: Тест-dry-run** на test DB с прод-похожим seed (суммы 681 134,70 / 139 738,76): script → verify both invariants → PASS; negative: seed с altered allocation → verify fail → rollback → state = pre-migration (assert: no `PeriodPlan` rows, balances unchanged).
- [ ] **Step 2: Run** — FAIL (нет скрипта).
- [ ] **Step 3: Реализовать** script (`import { PrismaClient } from '@prisma/client'` — по pattern `scripts/` и `.env` как в CLAUDE.md: `COPY .env.example → .env` если нет).
- [ ] **Step 4: Run** — PASS (dry-run на test DB). **НЕ выполнять** на реальной БД в песочнице без явного подтверждения владельца.
- [ ] **Step 5: Commit** `feat(scripts): one-off budget v2.1 migration`

### Task A12: Legacy deprecation (после web switch — Task B1)

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/envelopes/envelope.controller.ts`, `openapi.json`, `apps/web` usage of old endpoints (grep `/summary`, `/balance-summary`)

**Interfaces:**
- Consumes: B1 done (web не использует old endpoints).
- Produces: `GET /budgets/:id/summary` и `GET /budgets/:id/envelopes/:id/balance-summary` помечены `@Deprecated()` в OpenAPI и возвращают 410? нет — **оставить рабочие** с `Deprecation` header + note в OpenAPI; физическое удаление — отдельным релизом (CLAUDE.md: breaking changes `/api/v1` только с migration plan).

- [ ] **Step 1: Тест**: оба old endpoint'а возвращают header `Deprecation: true` (или `Sunset`); body без изменений.
- [ ] **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS. **Step 5: Commit** `chore(api): deprecate legacy envelope endpoints`

---

## Track B — Frontend (Nuxt 4, `apps/web`, Russian UI, Calm Fintech guidelines — читать перед visual changes)

### Task B1: Dashboard hero — `SpendableCashCard`

**Files:**
- Create: `apps/web/app/components/SpendableCashCard.vue`
- Modify: `apps/web/app/pages/app/index.vue` (replace `AvailableBudgetCard` usage), `apps/web/app/composables`/api client (grep `summary` → add `dashboard` fetch)
- Test: `apps/web/app/pages/app/index.test.ts` (update), `apps/web/app/components/SpendableCashCard.test.ts`

**Interfaces:**
- Consumes: `V2DashboardResponse` (Д.5).
- Produces: card with `data-testid="spendable-cash"`: «Можно потратить» + big amount; lines «На счетах {availableCash}», «На планы {reservedByPlans}»; if `state: 'NEGATIVE'` → `data-testid="spendable-negative"` «Планы превышают свободные деньги на {N}» + button «Посмотреть планы» (`/app/envelopes`).

- [ ] **Step 1: Component test** (vi.mock fetch → fixture): positive/negative states, correct RUB formatting (1 234,56 ₽). **Step 2: Run** `pnpm --filter web test` — FAIL. **Step 3: Реализовать** + wire fetch in `index.vue` (`/api/v1/budgets/:id/dashboard`). **Step 4: Run** — PASS + typecheck web. **Step 5: Commit** `feat(web): spendable cash dashboard card`

### Task B2: Dashboard — «Не размещено», «Требует внимания», accounts, plans list

**Files:**
- Create: `apps/web/app/components/UnallocatedBlock.vue`, `AttentionList.vue`, `PlanList.vue`, `PlanCard.vue`
- Modify: `apps/web/app/pages/app/index.vue`

**Interfaces:**
- Consumes: `V2DashboardResponse`.
- Produces (data-testid):
  - `unallocated-block` (if unallocated > 0): «Не размещено {amount}» + [Распределить] → `/app/allocations` (или existing allocation flow page — grep).
  - `attention-list`: items by `attention[]` type: `UNALLOCATED`→[Распределить]; `SHORTFALL`→«{envelope}: не хватает {amount}»→[Изменить план]→`/app/plans?envelope=`; `EXCEEDED`→«{envelope}: превышение {amount}»; `ALLOCATION_DRAFT`→«Новый доход: есть предложение»→[Посмотреть]; `PERIOD_PROPOSAL`→аналогично.
  - `accounts-block`: per account name+balance, total «Все деньги».
  - `plan-list` → `PlanCard`: «{name}», lines «План/Назначено/Потрачено/Осталось» + status chip: `✓ Покрыт` (`data-testid="plan-status-covered"`), `◐ Не хватает {N}`, `! Превышение {N}`, `Без плана`.
  - Old strings to remove from index: «Можно потратить» old semantics, «Свободные», leftovers of `previousPeriodLeftover` card (заменить на `PERIOD_PROPOSAL`).

- [ ] **Step 1: Komponent tests** с fixtures (all attention types, empty states). **Step 2: Run** — FAIL. **Step 3: Реализовать** (Calm Fintech: icon-only buttons where spec says, visible focus, contrast). **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(web): dashboard attention and plan cards`

### Task B3: Income flow — предложение разметки

**Files:**
- Create: `apps/web/app/components/IncomeProposalSheet.vue`
- Modify: existing operation-creation flow (grep `operations.vue` / confirm income step)
- Test: `apps/web/app/components/IncomeProposalSheet.test.ts`

**Interfaces:**
- Consumes: allocation drafts (`GET /allocations/drafts` filtered by income) + plan proposal (`GET /plan-proposals`).
- Produces: after income confirm — sheet `data-testid="income-proposal"`: «HarmoFin предлагает: {envelope}: {amount}; Оставить не размещёнными: {rest}» + [Подтвердить] (POST `/allocations/:id/confirm` per draft; if plan proposal exists → also `POST /plan-proposals/:id/apply`) / [Изменить] (amount edit → PATCH draft allocation) / [Оставить как есть] (reject: POST `/allocations/:id/reject`). If no drafts → no sheet.

- [ ] **Step 1: Component test** (mock api). **Step 2: Run** — FAIL. **Step 3: Реализовать** + wire. **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(web): income allocation proposal flow`

### Task B4: Новый период — prompt «Подтвердить план»

**Files:**
- Create: `apps/web/app/components/PeriodPlanPrompt.vue`
- Modify: `apps/web/app/pages/app/index.vue` (show when `pending.periodPlanDrafts.length > 0`), plan-edit page for draft (grep `plans.vue` — add draft editing)
- Test: `apps/web/app/components/PeriodPlanPrompt.test.ts`

**Interfaces:**
- Consumes: `pending.periodPlanDrafts`, `POST /period-plans/drafts`, `POST .../confirm`, `PATCH ...`.
- Produces: banner `data-testid="period-plan-prompt"`: «Начался новый период. HarmoFin предлагает план:» + rows {name: amount} + [Принять план] (confirm all drafts) / [Изменить] (per-row amount edit → PATCH). After confirm — toast «План периода подтверждён.»

- [ ] **Step 1: Test** (multiple drafts, accept all, edit one). **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(web): new period plan confirmation`

### Task B5: Envelope settings — funding rule editor

**Files:**
- Create: `apps/web/app/components/FundingRuleEditor.vue`
- Modify: `apps/web/app/pages/app/envelopes.vue` (or envelope edit dialog)
- Test: `apps/web/app/components/FundingRuleEditor.test.ts`

**Interfaces:**
- Consumes: `GET/PUT funding-rules`, envelopes list (for children selection).
- Produces: `data-testid="funding-rule-editor"`: radio `ruleType` (MANUAL «Вручную», SUM_OF_PLANS «Сумма планов», FIXED_MONTHLY «Фиксированная сумма», PERCENT_OF_INCOME «Процент от дохода»); inputs: `fixedAmount` (RUB), `percent` (0..100 % → bps), `children` multi-select (only for SUM). Save → PUT. Inline validation errors (Russian). Note: 0% and >100% allowed with warning, not error.

- [ ] **Step 1: Test** (all 4 types, validation). **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(web): funding rule editor`

### Task B6: Terminology cleanup (legacy words out of UI)

**Files:**
- Modify: grep `apps/web` for: `реаллок`, `реаллокати`, `starting`, `Свободные`, `balance` (card), `replace`/`replacement`, `transfer part`; fix copy per spec §26/§30.5.
- Test: `apps/web/app/pages/app/*.test.ts` (update expected strings), new grep assert in `apps/web` test.

**Interfaces:**
- Produces: no user-facing legacy terms; «Без назначения» for expenses without envelope (existing fast entry).

- [ ] **Step 1: Grep** — list все matches; update strings + component tests. **Step 2: Run** `pnpm --filter web test` — PASS. **Step 3: Grep-assert** (add `terminology.test.ts`: no forbidden tokens in `*.vue`). **Step 4: Run** — FAIL if any → fix → PASS. **Step 5: Commit** `refactor(web): remove legacy terminology`

### Task B7: Fast entry — envelope suggestion + «Без назначения»

**Files:**
- Modify: existing expense fast entry (grep `operations.vue` / add-expense dialog)
- Test: existing operations test update

**Interfaces:**
- Consumes: dashboard `plans` (current period) for suggestion (first plan with remaining > 0).
- Produces: auto-select envelope = suggested (changeable), default «Без назначения» shown as explicit state `data-testid="no-assignment"`; no blocking on excess (per §12).

- [ ] **Step 1: Test** (suggestion shown, user can un-assign). **Step 2: Run** — FAIL. **Step 3: Реализовать**. **Step 4: Run** — PASS + typecheck. **Step 5: Commit** `feat(web): fast entry envelope suggestion`

---

## Track C — QA (verification, non-functional, end-to-end)

### Task C1: Acceptance matrix §28 (integration)

**Files:**
- Create: `apps/api/test/acceptance-v2.integration.test.ts`
**Interfaces:** consumes A1–A10. Test each §28 scenario as separate test (exact numbers from spec):
1. §28.1 new budget: balance unchanged after plan creation.
2. §28.2 SUM: 20 000 + 3 000 + 15 000 = 38 000.
3. §28.3 spend > plan: 25 000 vs 20 000 → «Осталось −5 000, EXCEEDED 5 000», no block.
4. §28.4 transfer 50 000 A→B → plans unchanged (assert `reserved`, `unallocated`, plans).
5. §28.5 extra income +50 000: without rule → plans unchanged, 50 000 allocatable; with 30% → proposal 15 000/35 000, no allocation before confirm.
6. §28.6 rule 30%→40% → history untouched (assert old confirmed amounts unchanged).
7. §28.7 draft: repeated event → no duplicates; draft doesn't appear in reports.
8. §28.8 migration: `balance before == after`, zero new financial movements (assert count of `transactions` unchanged).
9. §28.9 isolation: budget A vs B (plans, rules, incomes, allocations, drafts — 404/empty).

- [ ] **Step 1: Написать** tests (TDD: many will fail pre-A-tasks — run after A1–A10).
- [ ] **Step 2: Run** `pnpm --filter api test:integration acceptance-v2` — all PASS.
- [ ] **Step 3: Коммит** `test(api): v2.1 acceptance matrix`

### Task C2: Invariants + idempotency + OpenAPI

**Files:**
- Create/Modify: `apps/api/test/invariants-v2.integration.test.ts`

**Interfaces:** consumes A1–A10.
1. Sequence of operations (income, allocate, spend, transfer, extra income, draft confirm/reject, rollover) → at each step: `available_cash` formula (independent re-compute from raw transactions) equals endpoint value; Σ account balance changes only by confirmed income/expense/transfer net.
2. Idempotency: retry `confirm`/`apply`/`PUT funding-rule` with same key → no dupes (assert row counts).
3. OpenAPI: `openapi.json` contains all Д.6 endpoints + request/response schemas; `plan_model_version` present.

- [ ] **Step 1: Test** (recompute helper = raw SQL like A3 but independent).
- [ ] **Step 2: Run** — PASS.
- [ ] **Step 3: Коммит** `test(api): v2.1 invariants and idempotency`

### Task C3: E2E Playwright happy path

**Files:**
- Modify/Create: `e2e/` (grep existing `*.spec.ts` patterns; new `envelope-plan-v2.spec.ts`)

**Interfaces:** consumes B1–B7, A1–A10. Steps (Russian UI, `data-testid` from B-tasks):
create budget → add account → add income (fast entry) → confirm → allocation proposal → distribute (accept) → confirm period plan → add expense (to plan; then over-plan → excess chip visible) → extra income → accept 30% proposal → dashboard: «Можно потратить» value = independent formula (assert by numbers), «Не размержено» block, attention items disappear after action.

- [ ] **Step 1: Write** spec (reuse existing fixture/login patterns in `e2e/`).
- [ ] **Step 2: Run** `pnpm test:e2e` (local infra: `pnpm infra:up` first) — PASS.
- [ ] **Step 3: Коммит** `test(e2e): envelope plan v2.1 journey`

### Task C4: Migration drill on production copy (sandbox)

**Files:**
- Modify: `scripts/migrate-budget-v2.ts` if gaps found
**Interfaces:** consumes A11.
Steps (owner's sandbox DB per CLAUDE.md — local Postgres = prod copy):
1. Snapshot (script `--dry-run`).
2. Run migration with `--rollback` available.
3. Verify: `681 134,70` / `139 738,76`; no new `transactions`.
4. Rollback drill: `--rollback` → re-verify pre-state.
NOTE: only if owner explicitly confirms (DB mutations constraint).

- [ ] **Step 1: Dry-run** → report snapshot.
- [ ] **Step 2: Ask owner** (question tool) → if yes, apply.
- [ ] **Step 3: Verify + rollback drill.**
- [ ] **Step 4: Коммит** (report/notes if any) — `chore: v2.1 migration verified`

### Task C5: Full regression + release gate

**Files:** none (runs only)

**Interfaces:** consumes everything.
1. `pnpm install --frozen-lockfile && pnpm build && pnpm lint && pnpm format:check && pnpm typecheck && ppm test && pnpm test:integration && pnpm test:e2e` — all green.
2. Migration compatibility per `.github/workflows/ci.yml` (blank DB + existing data migration check) — local run of those steps if scripts allow.
3. Spec §29 unit coverage check: each rule type, 0/100/>100%, draft confirm/reject, re-event, income edit/delete, remaining, negative remaining — assert tests exist (grep test names).
4. Report: list of deprecated endpoints, list of unchanged legacy columns, `plan_model_version` verification per budget.

- [ ] **Step 1: Run** full suite; **Step 2: Fix** (separate commits if needed); **Step 3: Run** — all PASS.
- [ ] **Step 4: Коммит** (if any) `chore: v2.1 release gate`

---

## Self-Review Notes

- Spec §1–§32 coverage: §3–§5 → A2/A3/D.1–D.4; §6 → A5/A6/A8; §7 → A8 + B4; §8 → A6/A7 + B3; §9 → A3 (`unallocatedAllTime`) + B2; §10–§11 → B2/B5; §12 → B7; §13 → A3 (transfers unchanged) + C2(4); §14–§15 → A5 (archive check) + B5; §16 → Б1/Б2 (+ fixed: 21 800 is marketing, new formula per Д.1 — owner confirmed 29.09.2026); §17 → B7; §18 → B3; §19 → B4; §20 → B2 statuses; §21 → Д.1/Д.5 (formula: available − reserved, negative = warning — owner confirmed); §22 → B2; §23 → A9/A10/A12; §24 → D + tasks; §25 → A11/C4; §26/§27 → A1 (legacy read-only) + B6; §28–§29 → C1/C2/C3; §30 → D.1 (reserved virtual aggregate); §31 → Д (all 10 decisions mapped: percent = Σ alloc — owner confirmed; global unallocated — owner confirmed).
- `sum_of_plans` children: one-level parent only; `parentEnvelopeId` on `Envelope`.
- `PERCENT` envelopes don't have `PeriodPlan` rows — `planSource='ALLOCATIONS'`, `futureObligations` excludes them (no row).
- `round` of percent: `Math.round(int)` in major units → minor conversion (D.2 note in A2).
