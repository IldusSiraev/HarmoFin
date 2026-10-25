# Семейный доступ, этап A — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создатель семьи приглашает участников по email или ссылке, управляет ими; участник переключается между своими пространствами; журнал показывает автора операции; плановые уведомления получают все создатели и участники.

**Architecture:** Новый модуль `apps/api/src/family/` (участники, приглашения, принятие) поверх существующих `Workspace` и `WorkspaceMembership`. Регистрация по приглашению переиспользует общую функцию принятия внутри транзакции auth. Активное пространство хранится в `WorkspaceMembership.lastSelectedAt`, веб берёт его из `GET /me` через новый composable вместо `workspaces[0]`. Права EDITOR и VIEWER на финансовые объекты на этапе A не меняются.

**Tech Stack:** NestJS 11 + Fastify, Prisma, PostgreSQL 18, Zod, Vitest, Nuxt 4 / Vue 3.5, `@lucide/vue`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-25-family-access-design.md](../specs/2026-10-25-family-access-design.md)

## Global Constraints

- Роли: `OWNER` (UI «Создатель»), `EDITOR` (UI «Участник»), `VIEWER` (UI «Наблюдатель»). Пригласить можно только `EDITOR` или `VIEWER`; `OWNER` ровно один (`Workspace.ownerId`).
- Срок приглашения — 7 дней. До 10 активных участников и до 20 приглашений `PENDING` на workspace.
- Токен приглашения: 32 байта CSPRNG base64url (`TokenService.createRawToken()`), в БД только `TokenService.digest()` (HMAC-SHA-256). Токен не пишется в логи, `AuditEvent`, `IdempotencyRecord` и ответы, кроме одноразового `inviteUrl` создателю.
- Ссылка: `{WEB_BASE_URL}/invite#token=<raw>`. Токен уходит на API только в теле POST.
- Каждый запрос к данным фильтрует `workspaceId`/`budgetId` в самом запросе к БД. Членство и роль читаются в транзакции мутации.
- Все новые эндпоинты в `/api/v1` (URI-версионирование, `defaultVersion: '1'`). Журнал уже живёт в `/api/v2/budgets/:budgetId/journal` (`@Controller({ version: '2' })`) — авторство и фильтр добавляются туда же. Изменения аддитивные, с OpenAPI (запрос, ответ, ошибки `ProblemDetailsResponse`). Мутации с сессией — `SessionAuthGuard` + `CsrfGuard`.
- Миграции только аддитивные.
- UI-тексты на русском, идентификаторы на английском. Calm Fintech: действия строки — icon-only `UiActionMenu` с `aria-label`, основные действия — `UiButton` с текстом, диалоги `UiModal`, роли текстом, не цветом.
- Local Playwright не запускать; E2E-спека выполняется в CI.
- Не трогать `identity/logo_description.png`. Не создавать worktree. Коммиты делает главная сессия после review задачи.

## Отклонения от дизайна, принятые в плане

1. **`Idempotency-Key` на создании приглашения не используется.** `IdempotencyService` сохраняет тело ответа в `idempotency_records`, а ответ содержит одноразовый токен — это запрещено правилами о секретах. Вместо этого защита от дубля — частичный unique-индекс: повторный POST на тот же email при активном приглашении даёт `409 INVITATION_ALREADY_PENDING`, UI предлагает «Отправить повторно». Приглашение не финансовое движение.
2. **`GET /me` расширяет существующий массив `workspaces[]`** полем `isCreator` вместо нового `memberships[]`: массив уже содержит все активные членства с ролью и бюджетами.
3. **Добавлен `PATCH /me` `{displayName}`.** У создателя имя может быть пустым, а авторство и экран семьи требуют имени. Страница «Семья» просит указать имя до первого приглашения.
4. **Участник без пространств.** Если после выхода или удаления у пользователя не осталось активных членств, в той же транзакции создаётся личный workspace «Мой бюджет» с бюджетом (как `POST /workspaces`). Иначе вход ломается: `findDefaultMembership` требует хотя бы одно членство.
5. **Удаление аккаунта создателя с участниками уже запрещено** (`ACCOUNT_DELETION_HAS_MEMBERS` в `account-deletion.application.service.ts`). Код из дизайна `FAMILY_HAS_MEMBERS` не вводится, существующий код сохраняется; меняется только текст ошибки.

## Карта файлов

API, новый модуль `apps/api/src/family/`:
- `invitation.domain.ts` — чистые функции: нормализация и маскирование email, срок, лимиты, `inviteUrl`, подписи ролей.
- `family.errors.ts` — фабрики ошибок с кодами.
- `family.schemas.ts` — Zod-схемы входа.
- `family.dto.ts` — классы OpenAPI.
- `family.repository.ts` — запросы к участникам и приглашениям (всегда с `workspaceId`).
- `family-notifications.ts` — создание уведомлений о событиях доступа в транзакции.
- `personal-workspace.ts` — создание личного workspace в транзакции (переиспользуется `WorkspaceRepository` и выходом из семьи).
- `invitation-acceptance.ts` — принятие приглашения внутри переданной транзакции (общая для `accept` и регистрации).
- `members.application.service.ts` — список, роль, удаление, выход, выбор пространства.
- `invitations.application.service.ts` — создание, список, повтор, отзыв, preview, accept.
- `family.controller.ts` — эндпоинты под сессией.
- `invitation-public.controller.ts` — `POST invitations/preview` без сессии.
- `family.module.ts`.

API, изменения: `prisma/schema.prisma`, новая миграция, `auth/*` (register, me, default membership, `PATCH /me`, email), `auth-rate-limit.guard.ts`, `workspaces/workspace.repository.ts`, `v2-journal/*`, `account-deletion/*`, `app.module.ts`, `apps/worker/src/notification.handler.ts`.

Web: `composables/useActiveWorkspace.ts`, `composables/useFamily.ts`, `composables/usePermissions.ts`, `components/app/AppWorkspaceSwitcher.vue`, `components/family/*`, `pages/app/settings/family.vue`, `pages/invite.vue`, изменения в `useAuth.ts`, `useApiClient.ts`, страницах с `workspaces[0]`, `register.vue`, `login.vue`, `OperationRow.vue`, `TransferRow.vue`, `OperationDialog.vue`, `OperationsToolbar.vue`, `useOperationFilters.ts`, страница уведомлений.

E2E: `e2e/family-access.spec.ts`.

---

### Task 1: Схема и миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261025000000_family_access/migration.sql`
- Test: `apps/api/test/family-schema.integration.test.ts`

**Interfaces:**
- Produces: модель `WorkspaceInvitation` (Prisma client `prisma.workspaceInvitation`), enum `WorkspaceInvitationStatus`, `WorkspaceMembership.lastSelectedAt: Date | null`, `NotificationType` + `MEMBER_JOINED | MEMBER_LEFT | MEMBER_REMOVED`.

- [ ] **Step 1: Написать падающий тест схемы**

```ts
// apps/api/test/family-schema.integration.test.ts
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const createdUserIds: string[] = [];

async function seedWorkspace() {
  const userId = randomUUID();
  createdUserIds.push(userId);
  await prisma.user.create({
    data: { id: userId, email: `schema-${userId}@harmofin.test`, passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { id: randomUUID(), ownerId: userId, name: 'Семья' },
  });
  return { userId, workspaceId: workspace.id };
}

function invitationData(workspaceId: string, invitedByUserId: string, email: string) {
  return {
    id: randomUUID(),
    workspaceId,
    email,
    role: 'EDITOR' as const,
    tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    expiresAt: new Date(Date.now() + 86_400_000),
    invitedByUserId,
  };
}

describe('family access schema', () => {
  afterAll(async () => {
    for (const userId of createdUserIds) {
      const workspaces = await prisma.workspace.findMany({ where: { ownerId: userId } });
      for (const workspace of workspaces) {
        await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: workspace.id } });
        await prisma.workspaceMembership.deleteMany({ where: { workspaceId: workspace.id } });
        await prisma.workspace.delete({ where: { id: workspace.id } });
      }
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('allows only one pending invitation per workspace and email', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await prisma.workspaceInvitation.create({
      data: invitationData(workspaceId, userId, 'a@mail.ru'),
    });
    await expect(
      prisma.workspaceInvitation.create({ data: invitationData(workspaceId, userId, 'a@mail.ru') }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new pending invitation after the previous one is revoked', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const first = await prisma.workspaceInvitation.create({
      data: invitationData(workspaceId, userId, 'b@mail.ru'),
    });
    await prisma.workspaceInvitation.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await expect(
      prisma.workspaceInvitation.create({ data: invitationData(workspaceId, userId, 'b@mail.ru') }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects an OWNER invitation at the database level', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await expect(
      prisma.workspaceInvitation.create({
        data: { ...invitationData(workspaceId, userId, 'c@mail.ru'), role: 'OWNER' },
      }),
    ).rejects.toThrow(/workspace_invitations_role_check/);
  });

  it('stores lastSelectedAt on memberships', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const selectedAt = new Date('2026-10-25T10:00:00.000Z');
    const membership = await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId, userId, role: 'OWNER', lastSelectedAt: selectedAt },
    });
    expect(membership.lastSelectedAt?.toISOString()).toBe(selectedAt.toISOString());
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/family-schema.integration.test.ts --config vitest.integration.config.ts`
(если имя пакета или конфига другое — посмотреть `apps/api/package.json`, скрипт `test:integration`)
Expected: FAIL — `prisma.workspaceInvitation` не существует (ошибка TypeScript/TypeError).

- [ ] **Step 3: Изменить `prisma/schema.prisma`**

После `enum WorkspaceMembershipRole`:

```prisma
enum WorkspaceInvitationStatus {
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
}
```

В `enum NotificationType` добавить в конец:

```prisma
  MEMBER_JOINED
  MEMBER_LEFT
  MEMBER_REMOVED
```

В `model WorkspaceMembership` после `removedAt`:

```prisma
  lastSelectedAt DateTime? @map("last_selected_at") @db.Timestamptz(3)
```

В `model User` в список связей:

```prisma
  sentInvitations     WorkspaceInvitation[] @relation("InvitationInviter")
  acceptedInvitations WorkspaceInvitation[] @relation("InvitationAcceptor")
```

В `model Workspace` в список связей:

```prisma
  invitations   WorkspaceInvitation[]
```

Новая модель после `WorkspaceMembership`:

```prisma
model WorkspaceInvitation {
  id               String                    @id @db.Uuid
  workspaceId      String                    @map("workspace_id") @db.Uuid
  email            String                    @db.VarChar(320)
  role             WorkspaceMembershipRole
  tokenHash        String                    @unique @map("token_hash") @db.Char(64)
  expiresAt        DateTime                  @map("expires_at") @db.Timestamptz(3)
  status           WorkspaceInvitationStatus @default(PENDING)
  invitedByUserId  String                    @map("invited_by_user_id") @db.Uuid
  acceptedByUserId String?                   @map("accepted_by_user_id") @db.Uuid
  acceptedAt       DateTime?                 @map("accepted_at") @db.Timestamptz(3)
  revokedAt        DateTime?                 @map("revoked_at") @db.Timestamptz(3)
  createdAt        DateTime                  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime                  @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace  Workspace @relation(fields: [workspaceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  invitedBy  User      @relation("InvitationInviter", fields: [invitedByUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  acceptedBy User?     @relation("InvitationAcceptor", fields: [acceptedByUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([workspaceId, status])
  @@map("workspace_invitations")
}
```

- [ ] **Step 4: Сгенерировать миграцию и дописать raw SQL**

Run: `pnpm db:migrate:dev --name family_access --create-only` (локальная БД разработчика), затем переименовать папку в `20261025000000_family_access`, если Prisma дала другую метку времени. В конец `migration.sql` добавить:

```sql
-- One active invitation per workspace and email; revoked/expired/accepted rows stay as history.
CREATE UNIQUE INDEX "workspace_invitations_pending_email_key"
  ON "workspace_invitations" ("workspace_id", "email")
  WHERE "status" = 'PENDING';

-- The workspace creator is the only OWNER; nobody is invited as OWNER.
ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_role_check" CHECK ("role" IN ('EDITOR', 'VIEWER'));
```

Проверить, что `ALTER TYPE "NotificationType" ADD VALUE ...` присутствует и новые значения не используются в той же миграции.

Run: `pnpm db:migrate:dev` и `pnpm db:generate`

- [ ] **Step 5: Тест проходит**

Run: та же команда, что в Step 2.
Expected: PASS, 4 теста.

- [ ] **Step 6: Typecheck и commit**

Run: `pnpm typecheck`
Expected: без ошибок. Если какие-то `switch` по `NotificationType` стали неполными (веб или worker) — добавить ветки с нейтральным заголовком в задаче 7/13, а здесь только убедиться, что typecheck зелёный (при ошибке — добавить `default`-ветку там, где её отсутствие ломает сборку).

```bash
git add prisma/schema.prisma prisma/migrations/20261025000000_family_access apps/api/test/family-schema.integration.test.ts
git commit -m "feat(db): приглашения в семью и выбор пространства"
```

---

### Task 2: Доменные функции приглашения

**Files:**
- Create: `apps/api/src/family/invitation.domain.ts`
- Create: `apps/api/src/family/family.errors.ts`
- Test: `apps/api/src/family/invitation.domain.test.ts`

**Interfaces:**
- Produces:
  - `INVITATION_TTL_MS: number` (7 суток), `MEMBER_LIMIT = 10`, `PENDING_INVITATION_LIMIT = 20`
  - `normalizeEmail(email: string): string`
  - `maskEmail(email: string): string`
  - `isExpired(expiresAt: Date, now: Date): boolean`
  - `buildInviteUrl(webBaseUrl: string, rawToken: string): string`
  - `invitationExpiresAt(now: Date): Date`
  - `ROLE_LABELS: Record<'OWNER' | 'EDITOR' | 'VIEWER', string>`
  - `type InvitableRole = 'EDITOR' | 'VIEWER'`
  - ошибки из `family.errors.ts`: `invitationNotFound()`, `invitationExpired()`, `invitationRevoked()`, `invitationAlreadyAccepted()`, `invitationEmailMismatch()`, `invitationAlreadyPending()`, `alreadyMember()`, `memberLimitReached()`, `invitationLimitReached()`, `cannotChangeCreator()`, `displayNameRequired()`

- [ ] **Step 1: Падающий тест**

```ts
// apps/api/src/family/invitation.domain.test.ts
import { describe, expect, it } from 'vitest';

import {
  INVITATION_TTL_MS,
  buildInviteUrl,
  invitationExpiresAt,
  isExpired,
  maskEmail,
  normalizeEmail,
} from './invitation.domain.js';

describe('invitation domain', () => {
  it('normalizes email to trimmed lower case', () => {
    expect(normalizeEmail('  Alia.S@Mail.RU ')).toBe('alia.s@mail.ru');
  });

  it.each([
    ['alia@mail.ru', 'a***@mail.ru'],
    ['a@mail.ru', 'a***@mail.ru'],
    ['ildar.siraev@gmail.com', 'i***@gmail.com'],
  ])('masks %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('expires seven days after creation', () => {
    const now = new Date('2026-10-25T00:00:00.000Z');
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(invitationExpiresAt(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('treats the exact expiry moment as expired', () => {
    const expiresAt = new Date('2026-11-01T00:00:00.000Z');
    expect(isExpired(expiresAt, new Date('2026-10-31T23:59:59.999Z'))).toBe(false);
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
  });

  it('puts the token into the fragment, never into the query', () => {
    const url = buildInviteUrl('https://harmofin.ru/', 'abc_DEF-123');
    expect(url).toBe('https://harmofin.ru/invite#token=abc_DEF-123');
    expect(new URL(url).search).toBe('');
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run src/family/invitation.domain.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

```ts
// apps/api/src/family/invitation.domain.ts
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEMBER_LIMIT = 10;
export const PENDING_INVITATION_LIMIT = 20;

export type InvitableRole = 'EDITOR' | 'VIEWER';

export const ROLE_LABELS: Record<'OWNER' | 'EDITOR' | 'VIEWER', string> = {
  OWNER: 'Создатель',
  EDITOR: 'Участник',
  VIEWER: 'Наблюдатель',
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Shows only the first character of the local part: enough to recognize, not to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = normalizeEmail(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** The fragment never reaches the server or proxy logs; the page posts the token in a body. */
export function buildInviteUrl(webBaseUrl: string, rawToken: string): string {
  const url = new URL('/invite', webBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}
```

```ts
// apps/api/src/family/family.errors.ts
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const invitationNotFound = () =>
  new NotFoundException({
    code: 'INVITATION_NOT_FOUND',
    detail: 'Приглашение не найдено.',
  });
export const invitationExpired = () =>
  new GoneException({
    code: 'INVITATION_EXPIRED',
    detail: 'Срок приглашения истёк. Попросите отправить новое.',
  });
export const invitationRevoked = () =>
  new GoneException({ code: 'INVITATION_REVOKED', detail: 'Приглашение отозвано.' });
export const invitationAlreadyAccepted = () =>
  new ConflictException({
    code: 'INVITATION_ALREADY_ACCEPTED',
    detail: 'Приглашение уже принято.',
  });
export const invitationEmailMismatch = () =>
  new ForbiddenException({
    code: 'INVITATION_EMAIL_MISMATCH',
    detail: 'Приглашение отправлено на другой email.',
  });
export const invitationAlreadyPending = () =>
  new ConflictException({
    code: 'INVITATION_ALREADY_PENDING',
    detail: 'На этот email уже отправлено приглашение. Отправьте его повторно.',
  });
export const alreadyMember = () =>
  new ConflictException({ code: 'ALREADY_MEMBER', detail: 'Этот человек уже в семье.' });
export const memberLimitReached = () =>
  new ConflictException({
    code: 'MEMBER_LIMIT_REACHED',
    detail: 'В семье может быть не больше 10 участников.',
  });
export const invitationLimitReached = () =>
  new ConflictException({
    code: 'INVITATION_LIMIT_REACHED',
    detail: 'Активных приглашений может быть не больше 20.',
  });
export const cannotChangeCreator = () =>
  new ConflictException({
    code: 'CANNOT_CHANGE_CREATOR',
    detail: 'Роль создателя семьи нельзя изменить или удалить.',
  });
export const displayNameRequired = () =>
  new UnprocessableEntityException({
    code: 'DISPLAY_NAME_REQUIRED',
    detail: 'Укажите ваше имя — его увидят остальные участники.',
  });
```

- [ ] **Step 4: Тест проходит**

Run: та же команда.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/family/invitation.domain.ts apps/api/src/family/invitation.domain.test.ts apps/api/src/family/family.errors.ts
git commit -m "feat(api): доменные правила приглашений в семью"
```

---

### Task 3: Репозиторий семьи, уведомления о доступе, личное пространство

**Files:**
- Create: `apps/api/src/family/family.repository.ts`
- Create: `apps/api/src/family/family-notifications.ts`
- Create: `apps/api/src/family/personal-workspace.ts`
- Modify: `apps/api/src/workspaces/workspace.repository.ts` (переиспользовать `createPersonalWorkspace`)
- Test: покрывается integration-тестами задач 4–6; здесь — `pnpm typecheck` и существующий `apps/api/test/workspace-budget.integration.test.ts`.

**Interfaces:**
- Produces:
  - `type Tx = Prisma.TransactionClient`
  - `class FamilyRepository(prisma: PrismaService)`:
    - `transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`
    - `lockActiveMembership(tx, workspaceId, userId): Promise<{ id: string; role: WorkspaceMembershipRole; workspace: { id: string; name: string; ownerId: string } } | null>` — `SELECT … FOR UPDATE` строки членства, только `isActive = true` и `workspace.status = 'ACTIVE'`
    - `findActiveMembership(workspaceId, userId)` — то же без блокировки, вне транзакции
    - `listMembers(workspaceId): Promise<MemberRow[]>` — `MemberRow = { membershipId; userId; email; displayName; role; joinedAt: Date }`, только активные, сортировка: создатель первым, затем `createdAt asc`
    - `findMemberById(tx, workspaceId, membershipId)` — активное членство этого workspace или `null`
    - `countActiveMembers(tx, workspaceId): Promise<number>`
    - `countPendingInvitations(tx, workspaceId, now): Promise<number>` — `status = 'PENDING' AND expiresAt > now`
    - `findActiveBudgetId(tx, workspaceId): Promise<string | null>` — самый старый `ACTIVE` бюджет
    - `audit(tx, input: { actorUserId: string; workspaceId: string; budgetId: string | null; entityType: string; entityId: string; action: string; newValues?: Prisma.InputJsonValue; requestId?: string })`
  - `createAccessNotification(tx, input: { workspaceId: string; budgetId: string; userId: string; type: 'MEMBER_JOINED' | 'MEMBER_LEFT' | 'MEMBER_REMOVED'; memberName: string; eventKey: string })` в `family-notifications.ts`
  - `resolveUserNotifications(tx, workspaceId: string, userId: string, now: Date): Promise<void>`
  - `createPersonalWorkspace(tx, userId: string, now: Date, requestId?: string): Promise<{ workspace: { id: string; name: string; timezone: string }; budget: { id: string; name: string; primaryCurrency: string } }>` в `personal-workspace.ts`

- [ ] **Step 1: Личное пространство как общая функция**

Перенести тело транзакции из `WorkspaceRepository.createWithFirstBudget` в `personal-workspace.ts`, параметризовав имена:

```ts
// apps/api/src/family/personal-workspace.ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { newBudgetModelData } from '../common/plan-model/new-budget-model.js';

export async function createPersonalWorkspace(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  requestId?: string,
  names: { workspaceName: string; budgetName: string } = {
    workspaceName: 'Мой бюджет',
    budgetName: 'Мой бюджет',
  },
) {
  const workspace = await tx.workspace.create({
    data: { id: createUuidV7(now), ownerId: userId, name: names.workspaceName },
    select: { id: true, name: true, timezone: true },
  });
  await tx.workspaceMembership.create({
    data: {
      id: createUuidV7(now),
      workspaceId: workspace.id,
      userId,
      role: 'OWNER',
      lastSelectedAt: now,
    },
  });
  const budget = await tx.budget.create({
    data: {
      id: createUuidV7(now),
      workspaceId: workspace.id,
      name: names.budgetName,
      ...newBudgetModelData(now),
    },
    select: { id: true, name: true, primaryCurrency: true },
  });
  await tx.auditEvent.create({
    data: {
      id: createUuidV7(now),
      actorUserId: userId,
      workspaceId: workspace.id,
      budgetId: budget.id,
      entityType: 'workspace',
      entityId: workspace.id,
      action: 'CREATED',
      source: 'API',
      requestId: requestId ?? null,
    },
  });
  return { workspace, budget };
}
```

`WorkspaceRepository.createWithFirstBudget` вызывает её внутри своей `$transaction` с `names = input` и возвращает `{ ...workspace, role: 'OWNER', budget }`. Проверить, что `newBudgetModelData()` без аргумента и с `now` дают одинаковый результат для текущего времени (посмотреть сигнатуру в `common/plan-model/new-budget-model.ts`). Новый workspace сразу становится выбранным (`lastSelectedAt: now`) — так «Создать личный бюджет» в переключателе открывает его.

- [ ] **Step 2: Уведомления о доступе**

```ts
// apps/api/src/family/family-notifications.ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

type AccessType = 'MEMBER_JOINED' | 'MEMBER_LEFT' | 'MEMBER_REMOVED';

const COPY: Record<AccessType, (name: string) => { title: string; body: string }> = {
  MEMBER_JOINED: (name) => ({
    title: `${name} присоединился к семье`,
    body: 'Новый участник видит бюджет семьи.',
  }),
  MEMBER_LEFT: (name) => ({
    title: `${name} вышел из семьи`,
    body: 'Участник больше не видит бюджет семьи.',
  }),
  MEMBER_REMOVED: (name) => ({
    title: `${name} удалён из семьи`,
    body: 'Участник больше не видит бюджет семьи.',
  }),
};

export async function createAccessNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    budgetId: string;
    userId: string;
    type: AccessType;
    memberName: string;
    eventKey: string;
  },
): Promise<void> {
  const copy = COPY[input.type](input.memberName);
  await tx.notification.createMany({
    data: {
      id: createUuidV7(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      notificationType: input.type,
      relatedEntityType: 'workspace_membership',
      title: copy.title,
      body: copy.body,
      actionPath: '/app/settings/family',
      notificationKey: `access:${input.type}:${input.eventKey}`,
    },
    skipDuplicates: true,
  });
}

/** A member who lost access must not keep open reminders of this family. */
export async function resolveUserNotifications(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.notification.updateMany({
    where: { workspaceId, userId, resolvedAt: null },
    data: { resolvedAt: now },
  });
}
```

`eventKey` — id события (для приглашения — `invitation.id`, для выхода и удаления — `${membershipId}:${now.toISOString()}`), чтобы повторное вступление после выхода создавало новое уведомление.

- [ ] **Step 3: Репозиторий**

```ts
// apps/api/src/family/family.repository.ts
import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type Tx = Prisma.TransactionClient;

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceMembershipRole;
  joinedAt: Date;
}

export class FamilyRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async lockActiveMembership(tx: Tx, workspaceId: string, userId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT m.id FROM workspace_memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ${workspaceId}::uuid AND m.user_id = ${userId}::uuid
        AND m.is_active = true AND w.status = 'ACTIVE'
      FOR UPDATE OF m
    `;
    if (locked.length === 0) return null;
    return tx.workspaceMembership.findFirst({
      where: { id: locked[0]!.id, workspaceId },
      select: {
        id: true,
        role: true,
        workspace: { select: { id: true, name: true, ownerId: true } },
      },
    });
  }

  findActiveMembership(workspaceId: string, userId: string) {
    return this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        role: true,
        workspace: { select: { id: true, name: true, ownerId: true } },
      },
    });
  }

  async listMembers(workspaceId: string): Promise<MemberRow[]> {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((row) => ({
        membershipId: row.id,
        userId: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        role: row.role,
        joinedAt: row.createdAt,
      }))
      .sort((left, right) => Number(right.role === 'OWNER') - Number(left.role === 'OWNER'));
  }

  findMemberById(tx: Tx, workspaceId: string, membershipId: string) {
    return tx.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, isActive: true },
      select: {
        id: true,
        role: true,
        userId: true,
        user: { select: { email: true, displayName: true } },
      },
    });
  }

  countActiveMembers(tx: Tx, workspaceId: string): Promise<number> {
    return tx.workspaceMembership.count({ where: { workspaceId, isActive: true } });
  }

  countPendingInvitations(tx: Tx, workspaceId: string, now: Date): Promise<number> {
    return tx.workspaceInvitation.count({
      where: { workspaceId, status: 'PENDING', expiresAt: { gt: now } },
    });
  }

  async findActiveBudgetId(tx: Tx, workspaceId: string): Promise<string | null> {
    const budget = await tx.budget.findFirst({
      where: { workspaceId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return budget?.id ?? null;
  }

  async audit(
    tx: Tx,
    input: {
      actorUserId: string;
      workspaceId: string;
      budgetId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      newValues?: Prisma.InputJsonValue;
      requestId?: string | undefined;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        budgetId: input.budgetId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        ...(input.newValues === undefined ? {} : { newValues: input.newValues }),
        source: 'API',
        requestId: input.requestId ?? null,
      },
    });
  }
}
```

`audit.newValues` никогда не содержит токен или email приглашённого целиком — только роль, статус и id.

- [ ] **Step 4: Проверка**

Run: `pnpm typecheck` и `pnpm --filter @harmofin/api exec vitest run test/workspace-budget.integration.test.ts --config vitest.integration.config.ts`
Expected: без ошибок, существующие тесты workspace проходят.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/family/family.repository.ts apps/api/src/family/family-notifications.ts apps/api/src/family/personal-workspace.ts apps/api/src/workspaces/workspace.repository.ts
git commit -m "feat(api): репозиторий семьи и личное пространство"
```

---

### Task 4: API участников и выбор пространства

**Files:**
- Create: `apps/api/src/family/family.schemas.ts`
- Create: `apps/api/src/family/family.dto.ts`
- Create: `apps/api/src/family/members.application.service.ts`
- Create: `apps/api/src/family/family.controller.ts`
- Create: `apps/api/src/family/family.module.ts`
- Modify: `apps/api/src/app.module.ts` (подключить `FamilyModule.register()`)
- Test: `apps/api/test/family-members.integration.test.ts`

**Interfaces:**
- Consumes: `FamilyRepository`, `createAccessNotification`, `resolveUserNotifications`, `createPersonalWorkspace`, ошибки из `family.errors.ts`, `forbidden()`/`resourceNotFound()` из `common/reference-data/reference-data.errors.ts`.
- Produces:
  - `MembersApplicationService.list(userId, workspaceId): Promise<MemberResponse[]>`
  - `.changeRole(userId, workspaceId, membershipId, role: InvitableRole, requestId?)`
  - `.remove(userId, workspaceId, membershipId, requestId?)`
  - `.leave(userId, workspaceId, requestId?)`
  - `.select(userId, workspaceId)`
  - `MemberResponse = { membershipId: string; userId: string; email: string; displayName: string | null; role: 'OWNER' | 'EDITOR' | 'VIEWER'; isCreator: boolean; joinedAt: string }`
  - эндпоинты: `GET/PATCH/DELETE workspaces/:workspaceId/members[/:membershipId]`, `POST workspaces/:workspaceId/leave`, `POST workspaces/:workspaceId/select`

- [ ] **Step 1: Падающий integration-тест**

Файл строится по образцу `apps/api/test/workspace-budget.integration.test.ts` (тот же `createApiApp(loadApiConfig({...}))`, хелперы `register`, cleanup в `afterAll` — плюс удаление `workspaceInvitation` и `notification` по `workspaceId` до удаления членств). Чтобы добавить второго пользователя в семью до задачи 5, тест создаёт членство напрямую через `prisma.workspaceMembership.create`.

```ts
// фрагменты apps/api/test/family-members.integration.test.ts
it('lists members with the creator first and hides other families', async () => {
  await addMember(ownerWorkspaceId, alia.user.id, 'EDITOR');
  const response = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/members`, alia);
  expect(response.statusCode).toBe(200);
  const members = response.json<Array<{ userId: string; isCreator: boolean; role: string }>>();
  expect(members[0]).toMatchObject({ userId: owner.user.id, isCreator: true, role: 'OWNER' });
  expect(members.map((member) => member.userId)).toContain(alia.user.id);

  const foreign = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/members`, stranger);
  expect(foreign.statusCode).toBe(404);
});

it('lets only the creator change roles and never the creator role', async () => {
  const aliaMembership = await membershipOf(ownerWorkspaceId, alia.user.id);
  const byEditor = await inject(
    'PATCH',
    `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
    alia,
    { role: 'VIEWER' },
  );
  expect(byEditor.statusCode).toBe(403);

  const byOwner = await inject(
    'PATCH',
    `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
    owner,
    { role: 'VIEWER' },
  );
  expect(byOwner.statusCode).toBe(200);
  expect(byOwner.json()).toMatchObject({ role: 'VIEWER' });

  const ownerMembership = await membershipOf(ownerWorkspaceId, owner.user.id);
  const creator = await inject(
    'PATCH',
    `/api/v1/workspaces/${ownerWorkspaceId}/members/${ownerMembership}`,
    owner,
    { role: 'EDITOR' },
  );
  expect(creator.statusCode).toBe(409);
  expect(creator.json()).toMatchObject({ code: 'CANNOT_CHANGE_CREATOR' });
});

it('removes a member: access ends, notifications resolve, creator is notified', async () => {
  const aliaMembership = await membershipOf(ownerWorkspaceId, alia.user.id);
  await seedNotification(ownerWorkspaceId, ownerBudgetId, alia.user.id);
  const removed = await inject(
    'DELETE',
    `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
    owner,
  );
  expect(removed.statusCode).toBe(204);

  const budgetRead = await inject('GET', `/api/v1/budgets/${ownerBudgetId}`, alia);
  expect([403, 404]).toContain(budgetRead.statusCode);
  const journal = await inject('GET', `/api/v2/budgets/${ownerBudgetId}/journal`, alia);
  expect([403, 404]).toContain(journal.statusCode);

  expect(
    await prisma.notification.count({
      where: { workspaceId: ownerWorkspaceId, userId: alia.user.id, resolvedAt: null },
    }),
  ).toBe(0);
  expect(
    await prisma.notification.count({
      where: { userId: owner.user.id, notificationType: 'MEMBER_REMOVED' },
    }),
  ).toBe(1);
  expect(
    await prisma.auditEvent.count({
      where: { workspaceId: ownerWorkspaceId, entityType: 'workspace_membership', action: 'REMOVED' },
    }),
  ).toBe(1);
});

it('gives a member without other workspaces a personal one after leaving', async () => {
  const invitedOnly = await registerWithoutWorkspace(); // user + membership in owner family only
  const left = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/leave`, invitedOnly);
  expect(left.statusCode).toBe(204);
  const me = await inject('GET', '/api/v1/me', invitedOnly);
  const workspaces = me.json<{ workspaces: Array<{ id: string; isCreator: boolean }> }>().workspaces;
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]).toMatchObject({ isCreator: true });
  expect(workspaces[0]!.id).not.toBe(ownerWorkspaceId);
});

it('does not let the creator leave', async () => {
  const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/leave`, owner);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'CANNOT_CHANGE_CREATOR' });
});

it('selects an accessible workspace and rejects a foreign one', async () => {
  await addMember(ownerWorkspaceId, bob.user.id, 'VIEWER');
  const selected = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/select`, bob);
  expect(selected.statusCode).toBe(204);
  const foreign = await inject('POST', `/api/v1/workspaces/${strangerWorkspaceId}/select`, bob);
  expect(foreign.statusCode).toBe(404);
});
```

Хелпер `inject(method, url, actor, payload?)` ставит `origin`, cookie `harmofin_session` и `x-csrf-token` (имя заголовка — как в существующих тестах с `ownerCsrf`). `registerWithoutWorkspace` создаёт пользователя через `/auth/register`, затем архивирует его личный workspace (`status: 'ARCHIVED'`) и добавляет членство в семью владельца — так он остаётся без активных собственных пространств. (Тест `me.isCreator` зависит от задачи 6; до неё проверять через `prisma.workspaceMembership.findMany({ where: { userId, isActive: true, role: 'OWNER' } })` и заменить на проверку `me` в задаче 6.)

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/family-members.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL — 404 на новых маршрутах.

- [ ] **Step 3: Схемы и DTO**

```ts
// apps/api/src/family/family.schemas.ts
import { z } from 'zod';

export const invitableRoleSchema = z.enum(['EDITOR', 'VIEWER']);
export const changeRoleSchema = z.object({ role: invitableRoleSchema }).strict();
export const createInvitationSchema = z
  .object({ email: z.string().trim().email().max(320), role: invitableRoleSchema })
  .strict();
export const invitationTokenSchema = z.object({ token: z.string().min(16).max(128) }).strict();
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(16).max(128),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const updateProfileSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();

export type ChangeRoleInput = z.output<typeof changeRoleSchema>;
export type CreateInvitationInput = z.output<typeof createInvitationSchema>;
export type InvitationTokenInput = z.output<typeof invitationTokenSchema>;
export type AcceptInvitationInput = z.output<typeof acceptInvitationSchema>;
export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
```

`family.dto.ts` — классы `MemberResponse`, `ChangeRoleRequest`, `InvitationResponse`, `CreateInvitationRequest`, `CreatedInvitationResponse` (= `InvitationResponse` + `inviteUrl: string`), `InvitationTokenRequest`, `InvitationPreviewResponse`, `AcceptInvitationRequest`, `AcceptedInvitationResponse`, `UpdateProfileRequest` с `@ApiProperty` по образцу `workspaces/workspace.dto.ts`. Поля — ровно как в типах этой задачи и задачи 5.

- [ ] **Step 4: Сервис участников**

```ts
// apps/api/src/family/members.application.service.ts
import { Injectable } from '@nestjs/common';

import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cannotChangeCreator } from './family.errors.js';
import { createAccessNotification, resolveUserNotifications } from './family-notifications.js';
import { FamilyRepository, type MemberRow, type Tx } from './family.repository.js';
import type { InvitableRole } from './invitation.domain.js';
import { createPersonalWorkspace } from './personal-workspace.js';

export interface MemberResponse {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  isCreator: boolean;
  joinedAt: string;
}

function toResponse(row: MemberRow, ownerId: string): MemberResponse {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isCreator: row.userId === ownerId,
    joinedAt: row.joinedAt.toISOString(),
  };
}

@Injectable()
export class MembersApplicationService {
  constructor(private readonly repository: FamilyRepository) {}

  async list(userId: string, workspaceId: string): Promise<MemberResponse[]> {
    const membership = await this.repository.findActiveMembership(workspaceId, userId);
    if (!membership) throw resourceNotFound();
    const rows = await this.repository.listMembers(workspaceId);
    return rows.map((row) => toResponse(row, membership.workspace.ownerId));
  }

  async changeRole(
    userId: string,
    workspaceId: string,
    membershipId: string,
    role: InvitableRole,
    requestId?: string,
  ): Promise<MemberResponse> {
    return this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const target = await this.repository.findMemberById(tx, workspaceId, membershipId);
      if (!target) throw resourceNotFound();
      if (target.userId === actor.workspace.ownerId) throw cannotChangeCreator();
      await tx.workspaceMembership.updateMany({
        where: { id: target.id, workspaceId, isActive: true },
        data: { role },
      });
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_membership',
        entityId: target.id,
        action: 'ROLE_CHANGED',
        newValues: { from: target.role, to: role },
        requestId,
      });
      const rows = await tx.workspaceMembership.findFirstOrThrow({
        where: { id: target.id, workspaceId },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
      return toResponse(
        {
          membershipId: rows.id,
          userId: rows.user.id,
          email: rows.user.email,
          displayName: rows.user.displayName,
          role: rows.role,
          joinedAt: rows.createdAt,
        },
        actor.workspace.ownerId,
      );
    });
  }

  async remove(userId: string, workspaceId: string, membershipId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const target = await this.repository.findMemberById(tx, workspaceId, membershipId);
      if (!target) throw resourceNotFound();
      if (target.userId === actor.workspace.ownerId) throw cannotChangeCreator();
      await this.deactivate(tx, {
        workspaceId,
        ownerId: actor.workspace.ownerId,
        membershipId: target.id,
        memberUserId: target.userId,
        memberName: target.user.displayName ?? target.user.email,
        actorUserId: userId,
        action: 'REMOVED',
        requestId,
      });
    });
  }

  async leave(userId: string, workspaceId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
      if (!membership) throw resourceNotFound();
      if (membership.workspace.ownerId === userId) throw cannotChangeCreator();
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, displayName: true },
      });
      await this.deactivate(tx, {
        workspaceId,
        ownerId: membership.workspace.ownerId,
        membershipId: membership.id,
        memberUserId: userId,
        memberName: user.displayName ?? user.email,
        actorUserId: userId,
        action: 'LEFT',
        requestId,
      });
    });
  }

  async select(userId: string, workspaceId: string): Promise<void> {
    const result = await this.repository.transaction((tx) =>
      tx.workspaceMembership.updateMany({
        where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
        data: { lastSelectedAt: new Date() },
      }),
    );
    if (result.count !== 1) throw resourceNotFound();
  }

  private async requireCreator(tx: Tx, workspaceId: string, userId: string) {
    const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
    if (!membership) throw resourceNotFound();
    if (membership.role !== 'OWNER' || membership.workspace.ownerId !== userId) throw forbidden();
    return membership;
  }

  private async deactivate(
    tx: Tx,
    input: {
      workspaceId: string;
      ownerId: string;
      membershipId: string;
      memberUserId: string;
      memberName: string;
      actorUserId: string;
      action: 'REMOVED' | 'LEFT';
      requestId?: string | undefined;
    },
  ): Promise<void> {
    const now = new Date();
    await tx.workspaceMembership.updateMany({
      where: { id: input.membershipId, workspaceId: input.workspaceId, isActive: true },
      data: { isActive: false, removedAt: now, lastSelectedAt: null },
    });
    await resolveUserNotifications(tx, input.workspaceId, input.memberUserId, now);
    const budgetId = await this.repository.findActiveBudgetId(tx, input.workspaceId);
    await this.repository.audit(tx, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      budgetId,
      entityType: 'workspace_membership',
      entityId: input.membershipId,
      action: input.action,
      requestId: input.requestId,
    });
    if (budgetId) {
      await createAccessNotification(tx, {
        workspaceId: input.workspaceId,
        budgetId,
        userId: input.ownerId,
        type: input.action === 'REMOVED' ? 'MEMBER_REMOVED' : 'MEMBER_LEFT',
        memberName: input.memberName,
        eventKey: `${input.membershipId}:${now.toISOString()}`,
      });
    }
    const remaining = await tx.workspaceMembership.count({
      where: { userId: input.memberUserId, isActive: true, workspace: { status: 'ACTIVE' } },
    });
    if (remaining === 0) await createPersonalWorkspace(tx, input.memberUserId, now, input.requestId);
  }
}
```

- [ ] **Step 5: Контроллер и модуль**

`family.controller.ts`: `@ApiTags('family')`, `@Controller('workspaces/:workspaceId')`, `@UseGuards(SessionAuthGuard)`, `@ApiCookieAuth('session')`. Маршруты:

| Декоратор | Метод сервиса | Ответ |
|---|---|---|
| `@Get('members')` | `members.list` | 200 `[MemberResponse]`; 401, 404 |
| `@Patch('members/:membershipId')` + `CsrfGuard`, `ZodValidationPipe(changeRoleSchema)` | `members.changeRole` | 200 `MemberResponse`; 400, 401, 403, 404, 409 |
| `@Delete('members/:membershipId')` + `CsrfGuard`, `@HttpCode(204)` | `members.remove` | 204; 401, 403, 404, 409 |
| `@Post('leave')` + `CsrfGuard`, `@HttpCode(204)` | `members.leave` | 204; 401, 404, 409 |
| `@Post('select')` + `CsrfGuard`, `@HttpCode(204)` | `members.select` | 204; 401, 404 |

`workspaceId` и `membershipId` валидируются `ParseUUIDPipe` (или `z.string().uuid()` через `ZodValidationPipe` — как в `budget.controller.ts`). `contextOf(request)` — копия из `workspace.controller.ts`. Каждый маршрут — с `@ApiResponse({ status, type: ProblemDetailsResponse })` на все коды ошибок из таблицы.

`family.module.ts` — `static register(): DynamicModule` по образцу `workspace.module.ts`: провайдеры `FamilyRepository` (factory от `PrismaService`), `MembersApplicationService`. Подключить в `app.module.ts` рядом с `WorkspaceModule.register()`.

- [ ] **Step 6: Тесты проходят**

Run: команда Step 2, затем `pnpm --filter @harmofin/api exec vitest run test/v2-openapi.integration.test.ts --config vitest.integration.config.ts`
Expected: PASS; если OpenAPI-тест сверяет список путей со снапшотом — обновить снапшот новыми путями.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/family apps/api/src/app.module.ts apps/api/test/family-members.integration.test.ts
git commit -m "feat(api): участники семьи, выход и выбор пространства"
```

---

### Task 5: Приглашения — создание, повтор, отзыв, письмо

**Files:**
- Create: `apps/api/src/family/invitations.application.service.ts`
- Modify: `apps/api/src/family/family.controller.ts`, `apps/api/src/family/family.module.ts`
- Modify: `apps/api/src/auth/email-sender.ts`, `apps/api/src/auth/smtp-email.sender.ts`, `apps/api/src/auth/smtp-email.sender.test.ts`, все фейки `EmailSender` в тестах (`grep -rn "sendPasswordRecovery" apps/api`)
- Modify: `apps/api/src/auth/auth.module.ts` — экспортировать `TokenService` и `EMAIL_SENDER`, если ещё не экспортированы
- Modify: `apps/api/src/auth/auth-rate-limit.guard.ts`, `apps/api/src/auth/auth-rate-limit.guard.test.ts`
- Test: `apps/api/test/family-invitations.integration.test.ts`

**Interfaces:**
- Consumes: `TokenService.createRawToken()`, `TokenService.digest()`, `EMAIL_SENDER`, `ApiConfig.mail.webBaseUrl`, домен и ошибки задачи 2, `FamilyRepository`.
- Produces:
  - `EmailSender.sendFamilyInvitation(input: { recipient: string; inviteUrl: string; inviterName: string; workspaceName: string; roleLabel: string }): Promise<void>`
  - `InvitationsApplicationService.create(userId, workspaceId, input: CreateInvitationInput, requestId?): Promise<CreatedInvitationResponse>`
  - `.list(userId, workspaceId): Promise<InvitationResponse[]>`
  - `.resend(userId, workspaceId, invitationId, requestId?): Promise<CreatedInvitationResponse>`
  - `.revoke(userId, workspaceId, invitationId, requestId?): Promise<void>`
  - `InvitationResponse = { id: string; email: string; role: 'EDITOR' | 'VIEWER'; status: 'PENDING' | 'EXPIRED'; expiresAt: string; createdAt: string }`
  - `CreatedInvitationResponse = InvitationResponse & { inviteUrl: string }`

- [ ] **Step 1: Падающие тесты**

```ts
// фрагменты apps/api/test/family-invitations.integration.test.ts
it('creates an invitation, mails a fragment link and stores only the digest', async () => {
  const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
    email: '  Alia@Harmofin.TEST ',
    role: 'EDITOR',
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ id: string; email: string; inviteUrl: string; status: string }>();
  expect(body).toMatchObject({ email: 'alia@harmofin.test', status: 'PENDING' });
  const url = new URL(body.inviteUrl);
  expect(url.pathname).toBe('/invite');
  expect(url.search).toBe('');
  const rawToken = new URLSearchParams(url.hash.slice(1)).get('token')!;

  const stored = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: body.id } });
  expect(stored.tokenHash).not.toContain(rawToken);
  const audit = await prisma.auditEvent.findMany({ where: { entityId: body.id } });
  expect(JSON.stringify(audit)).not.toContain(rawToken);

  const mail = await latestMailpitMessage('alia@harmofin.test');
  expect(mail.Text).toContain(`/invite#token=${rawToken}`);
  expect(mail.Text).not.toContain('?token=');
});

it('rejects a second pending invitation for the same email', async () => {
  const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
    email: 'alia@harmofin.test',
    role: 'VIEWER',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'INVITATION_ALREADY_PENDING' });
});

it('rejects an invitation for an existing member', async () => {
  const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
    email: ownerEmail,
    role: 'EDITOR',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'ALREADY_MEMBER' });
});

it('resend rotates the token so the old link stops working', async () => {
  const [invitation] = await listInvitations(owner);
  const before = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
  const resent = await inject(
    'POST',
    `/api/v1/workspaces/${ownerWorkspaceId}/invitations/${invitation!.id}/resend`,
    owner,
  );
  expect(resent.statusCode).toBe(200);
  const after = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
  expect(after.tokenHash).not.toBe(before.tokenHash);
  expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
});

it('lists invitations without tokens and only to the creator', async () => {
  const list = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner);
  expect(list.statusCode).toBe(200);
  expect(JSON.stringify(list.json())).not.toMatch(/token|inviteUrl/i);
  await addMember(ownerWorkspaceId, editor.user.id, 'EDITOR');
  const byEditor = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, editor);
  expect(byEditor.statusCode).toBe(403);
});

it('cannot revoke an invitation through another workspace', async () => {
  const [invitation] = await listInvitations(owner);
  const response = await inject(
    'DELETE',
    `/api/v1/workspaces/${strangerWorkspaceId}/invitations/${invitation!.id}`,
    stranger,
  );
  expect(response.statusCode).toBe(404);
  const still = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
  expect(still.status).toBe('PENDING');
});

it('enforces the pending invitation limit', async () => {
  await seedPendingInvitations(ownerWorkspaceId, owner.user.id, 20);
  const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
    email: 'one-more@harmofin.test',
    role: 'EDITOR',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'INVITATION_LIMIT_REACHED' });
});
```

Хелпер `latestMailpitMessage(recipient)` — `GET http://127.0.0.1:8025/api/v1/search?query=to:${recipient}`, затем `GET /api/v1/message/{ID}`; если в репозитории уже есть хелпер Mailpit (`grep -rn "8025" apps/api/test e2e`) — использовать его. Лимит участников (`MEMBER_LIMIT_REACHED`) проверяется в задаче 6 на принятии; здесь — на создании: при 10 активных участниках создание тоже даёт `MEMBER_LIMIT_REACHED`.

В `auth-rate-limit.guard.test.ts` добавить кейсы: `/api/v1/invitations/preview` и `/api/v1/invitations/accept` ограничиваются `recoveryMax`; `POST /api/v1/workspaces/<uuid>/invitations` — `loginMax`; `GET` того же пути не ограничивается.

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/family-invitations.integration.test.ts --config vitest.integration.config.ts` и `pnpm --filter @harmofin/api exec vitest run src/auth/auth-rate-limit.guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Письмо**

В `email-sender.ts` добавить метод в интерфейс `EmailSender`:

```ts
  sendFamilyInvitation(input: {
    recipient: string;
    inviteUrl: string;
    inviterName: string;
    workspaceName: string;
    roleLabel: string;
  }): Promise<void>;
```

В `smtp-email.sender.ts` — реализация по образцу `sendPasswordRecovery`:

```ts
  async sendFamilyInvitation(input: {
    recipient: string;
    inviteUrl: string;
    inviterName: string;
    workspaceName: string;
    roleLabel: string;
  }): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: input.recipient,
      subject: `${input.inviterName} приглашает вас в HarmoFin`,
      text: [
        `${input.inviterName} приглашает вас в семью «${input.workspaceName}» в HarmoFin.`,
        `Роль: ${input.roleLabel}.`,
        '',
        `Принять приглашение: ${input.inviteUrl}`,
        '',
        'Ссылка действует 7 дней. Если вы не ждали приглашения, просто проигнорируйте письмо.',
      ].join('\n'),
    });
  }
```

(Имена `this.transport`/`this.from` — как в существующем классе.) Добавить тест в `smtp-email.sender.test.ts` по образцу теста восстановления. Добавить метод во все фейки `EmailSender`.

- [ ] **Step 4: Сервис приглашений**

```ts
// apps/api/src/family/invitations.application.service.ts
import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceInvitationStatus } from '@prisma/client';

import type { EmailSender } from '../auth/email-sender.js';
import { EMAIL_SENDER } from '../auth/email-sender.js';
import { TokenService } from '../auth/token.service.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import {
  alreadyMember,
  displayNameRequired,
  invitationAlreadyPending,
  invitationLimitReached,
  memberLimitReached,
} from './family.errors.js';
import { FamilyRepository, type Tx } from './family.repository.js';
import {
  MEMBER_LIMIT,
  PENDING_INVITATION_LIMIT,
  ROLE_LABELS,
  buildInviteUrl,
  invitationExpiresAt,
  isExpired,
  normalizeEmail,
  type InvitableRole,
} from './invitation.domain.js';

export interface InvitationResponse {
  id: string;
  email: string;
  role: InvitableRole;
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}
export type CreatedInvitationResponse = InvitationResponse & { inviteUrl: string };

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: WorkspaceInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
};

function toResponse(row: InvitationRow, now: Date): InvitationResponse {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InvitableRole,
    status: row.status === 'PENDING' && !isExpired(row.expiresAt, now) ? 'PENDING' : 'EXPIRED',
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

@Injectable()
export class InvitationsApplicationService {
  constructor(
    private readonly repository: FamilyRepository,
    private readonly tokens: TokenService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'mail'>,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    input: { email: string; role: InvitableRole },
    requestId?: string,
  ): Promise<CreatedInvitationResponse> {
    const email = normalizeEmail(input.email);
    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    const result = await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const inviter = await this.requireInviterName(tx, userId);
      await this.expireStale(tx, workspaceId, now);
      const existingMember = await tx.workspaceMembership.findFirst({
        where: { workspaceId, isActive: true, user: { email } },
        select: { id: true },
      });
      if (existingMember) throw alreadyMember();
      if ((await this.repository.countActiveMembers(tx, workspaceId)) >= MEMBER_LIMIT)
        throw memberLimitReached();
      if ((await this.repository.countPendingInvitations(tx, workspaceId, now)) >= PENDING_INVITATION_LIMIT)
        throw invitationLimitReached();
      let row: InvitationRow;
      try {
        row = await tx.workspaceInvitation.create({
          data: {
            id: createUuidV7(now),
            workspaceId,
            email,
            role: input.role,
            tokenHash: this.tokens.digest(rawToken),
            expiresAt: invitationExpiresAt(now),
            invitedByUserId: userId,
          },
          select: invitationSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw invitationAlreadyPending();
        throw error;
      }
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: row.id,
        action: 'CREATED',
        newValues: { role: input.role },
        requestId,
      });
      return { row, inviterName: inviter, workspaceName: actor.workspace.name };
    });
    return this.deliver(result.row, rawToken, result.inviterName, result.workspaceName, now);
  }

  async list(userId: string, workspaceId: string): Promise<InvitationResponse[]> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      await this.requireCreator(tx, workspaceId, userId);
      await this.expireStale(tx, workspaceId, now);
      const rows = await tx.workspaceInvitation.findMany({
        where: { workspaceId, status: 'PENDING' },
        select: invitationSelect,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => toResponse(row, now));
    });
  }

  async resend(
    userId: string,
    workspaceId: string,
    invitationId: string,
    requestId?: string,
  ): Promise<CreatedInvitationResponse> {
    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    const result = await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const inviter = await this.requireInviterName(tx, userId);
      const updated = await tx.workspaceInvitation.updateMany({
        where: { id: invitationId, workspaceId, status: { in: ['PENDING', 'EXPIRED'] } },
        data: {
          status: 'PENDING',
          tokenHash: this.tokens.digest(rawToken),
          expiresAt: invitationExpiresAt(now),
        },
      });
      if (updated.count !== 1) throw resourceNotFound();
      const row = await tx.workspaceInvitation.findFirstOrThrow({
        where: { id: invitationId, workspaceId },
        select: invitationSelect,
      });
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: row.id,
        action: 'RESENT',
        requestId,
      });
      return { row, inviterName: inviter, workspaceName: actor.workspace.name };
    });
    return this.deliver(result.row, rawToken, result.inviterName, result.workspaceName, now);
  }

  async revoke(userId: string, workspaceId: string, invitationId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      await this.requireCreator(tx, workspaceId, userId);
      const now = new Date();
      const updated = await tx.workspaceInvitation.updateMany({
        where: { id: invitationId, workspaceId, status: { in: ['PENDING', 'EXPIRED'] } },
        data: { status: 'REVOKED', revokedAt: now },
      });
      if (updated.count !== 1) throw resourceNotFound();
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: invitationId,
        action: 'REVOKED',
        requestId,
      });
    });
  }

  private async deliver(
    row: InvitationRow,
    rawToken: string,
    inviterName: string,
    workspaceName: string,
    now: Date,
  ): Promise<CreatedInvitationResponse> {
    const inviteUrl = buildInviteUrl(this.config.mail.webBaseUrl, rawToken);
    // Mail goes out after commit: a failed send still leaves the copyable link to the creator.
    await this.email
      .sendFamilyInvitation({
        recipient: row.email,
        inviteUrl,
        inviterName,
        workspaceName,
        roleLabel: ROLE_LABELS[row.role as InvitableRole],
      })
      .catch(() => undefined);
    return { ...toResponse(row, now), inviteUrl };
  }

  private async expireStale(tx: Tx, workspaceId: string, now: Date): Promise<void> {
    await tx.workspaceInvitation.updateMany({
      where: { workspaceId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
  }

  private async requireCreator(tx: Tx, workspaceId: string, userId: string) {
    const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
    if (!membership) throw resourceNotFound();
    if (membership.role !== 'OWNER' || membership.workspace.ownerId !== userId) throw forbidden();
    return membership;
  }

  private async requireInviterName(tx: Tx, userId: string): Promise<string> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    if (!user.displayName) throw displayNameRequired();
    return user.displayName;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
```

Ошибка отправки письма глотается, но логируется: заменить `.catch(() => undefined)` на `.catch((error) => this.logger.warn({ err: error }, 'family invitation email failed'))`, взяв логгер так же, как его берёт `AuthApplicationService` при отправке письма восстановления (посмотреть `auth.application.service.ts`, строки около `sendPasswordRecovery`). В лог не попадают `inviteUrl` и токен.

- [ ] **Step 5: Маршруты и rate limit**

В `family.controller.ts`:

| Декоратор | Метод | Ответ |
|---|---|---|
| `@Get('invitations')` | `invitations.list` | 200 `[InvitationResponse]`; 401, 403, 404 |
| `@Post('invitations')` + `CsrfGuard`, `AuthRateLimitGuard`, `ZodValidationPipe(createInvitationSchema)` | `invitations.create` | 201 `CreatedInvitationResponse`; 400, 401, 403, 404, 409, 422, 429 |
| `@Post('invitations/:invitationId/resend')` + `CsrfGuard`, `AuthRateLimitGuard`, `@HttpCode(200)` | `invitations.resend` | 200 `CreatedInvitationResponse`; 401, 403, 404, 422, 429 |
| `@Delete('invitations/:invitationId')` + `CsrfGuard`, `@HttpCode(204)` | `invitations.revoke` | 204; 401, 403, 404 |

В `AuthRateLimitGuard.maximumFor`:

```ts
    if (url.startsWith('/api/v1/invitations/preview')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/invitations/accept')) return this.config.rateLimit.recoveryMax;
    if (/^\/api\/v1\/workspaces\/[^/]+\/invitations(\/[^/]+\/resend)?$/.test(url) && method === 'POST')
      return this.config.rateLimit.loginMax;
```

`maximumFor` получает `request.method` вторым параметром. `AuthRateLimitGuard` должен быть доступен в `FamilyModule` (провайдер с `API_CONFIG` — как в `auth.module.ts`).

`family.module.ts`: добавить провайдеры `InvitationsApplicationService` (зависимости `FamilyRepository`, `TokenService`, `EMAIL_SENDER`, `API_CONFIG`) и `AuthRateLimitGuard`; импортировать то, что экспортирует `AuthModule`.

- [ ] **Step 6: Тесты проходят**

Run: команды Step 2 + `pnpm --filter @harmofin/api exec vitest run src/auth/smtp-email.sender.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/family apps/api/src/auth apps/api/test/family-invitations.integration.test.ts
git commit -m "feat(api): приглашения в семью с письмом и ссылкой"
```

---

### Task 6: Preview, принятие, регистрация по приглашению, `me`, `PATCH /me`

**Files:**
- Create: `apps/api/src/family/invitation-acceptance.ts`
- Create: `apps/api/src/family/invitation-public.controller.ts`
- Modify: `apps/api/src/family/invitations.application.service.ts` (+ `preview`, `accept`)
- Modify: `apps/api/src/family/family.controller.ts` → маршрут `accept` в отдельном контроллере без префикса workspace (`@Controller('invitations')` с `SessionAuthGuard`) — положить в `invitation-public.controller.ts` вторым классом `InvitationAcceptController`
- Modify: `apps/api/src/auth/auth.schemas.ts`, `auth.application.service.ts`, `auth.controller.ts`, `auth.dto.ts`, `auth.repository.ts` (если `findUserById` не возвращает `displayName`)
- Test: `apps/api/test/family-accept.integration.test.ts`, дополнить `apps/api/test/auth.integration.test.ts`

**Interfaces:**
- Consumes: `TokenService.digest`, `FamilyRepository`, `createAccessNotification`, ошибки задачи 2.
- Produces:
  - `acceptInvitationInTx(tx: Tx, input: { tokenHash: string; userId: string; userEmail: string; now: Date; requestId?: string }): Promise<{ workspaceId: string; workspaceName: string; budget: { id: string; name: string; primaryCurrency: string } }>`
  - `InvitationsApplicationService.preview(rawToken): Promise<InvitationPreviewResponse>` где `InvitationPreviewResponse = { workspaceName: string; inviterName: string; role: 'EDITOR' | 'VIEWER'; maskedEmail: string; expiresAt: string }`
  - `.accept(userId, input: AcceptInvitationInput, requestId?): Promise<AcceptedInvitationResponse>` где `AcceptedInvitationResponse = { workspaceId: string; budgetId: string }`
  - `registerSchema` + `invitationToken?: string`
  - `GET /me` → `workspaces[i].isCreator: boolean`, `activeWorkspaceId: string | null`
  - `PATCH /me` `{ displayName }` → `{ user: { id, email, displayName } }`
  - `AuthApplicationService.findDefaultMembership` сортирует `lastSelectedAt desc nulls last, createdAt asc`

- [ ] **Step 1: Падающие тесты**

```ts
// фрагменты apps/api/test/family-accept.integration.test.ts
it('previews without a session and masks the email', async () => {
  const { rawToken } = await createInvitation(owner, 'alia-preview@harmofin.test', 'EDITOR');
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/invitations/preview',
    headers: { origin },
    payload: { token: rawToken },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    workspaceName: expect.any(String),
    inviterName: 'Ильдар',
    role: 'EDITOR',
    maskedEmail: 'a***@harmofin.test',
  });
});

it('answers 404 for an unknown token without details', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/invitations/preview',
    headers: { origin },
    payload: { token: 'x'.repeat(43) },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
});

it('registers by invitation without a personal workspace', async () => {
  const { rawToken } = await createInvitation(owner, 'alia-new@harmofin.test', 'EDITOR');
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      email: 'alia-new@harmofin.test',
      password,
      invitationToken: rawToken,
      consents: currentConsents,
    },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ user: { id: string }; workspace: { id: string } }>();
  expect(body.workspace.id).toBe(ownerWorkspaceId);
  const owned = await prisma.workspace.count({ where: { ownerId: body.user.id } });
  expect(owned).toBe(0);
});

it('rejects registration by invitation with another email', async () => {
  const { rawToken } = await createInvitation(owner, 'invited@harmofin.test', 'EDITOR');
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: 'intruder@harmofin.test', password, invitationToken: rawToken, consents: currentConsents },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });
  expect(await prisma.user.count({ where: { email: 'intruder@harmofin.test' } })).toBe(0);
});

it('accepts for a signed-in user, requires a name and notifies the creator', async () => {
  const bob = await register('bob-accept@harmofin.test'); // no displayName
  const { rawToken } = await createInvitation(owner, 'bob-accept@harmofin.test', 'VIEWER');
  const withoutName = await inject('POST', '/api/v1/invitations/accept', bob, { token: rawToken });
  expect(withoutName.statusCode).toBe(422);
  expect(withoutName.json()).toMatchObject({ code: 'DISPLAY_NAME_REQUIRED' });

  const accepted = await inject('POST', '/api/v1/invitations/accept', bob, {
    token: rawToken,
    displayName: 'Боб',
  });
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json()).toMatchObject({ workspaceId: ownerWorkspaceId });
  expect(
    await prisma.notification.count({
      where: { userId: owner.user.id, notificationType: 'MEMBER_JOINED' },
    }),
  ).toBe(1);

  const again = await inject('POST', '/api/v1/invitations/accept', bob, { token: rawToken });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ code: 'INVITATION_ALREADY_ACCEPTED' });
});

it('creates exactly one membership under concurrent accepts', async () => {
  const carol = await register('carol@harmofin.test');
  await setDisplayName(carol, 'Кэрол');
  const { rawToken } = await createInvitation(owner, 'carol@harmofin.test', 'EDITOR');
  const results = await Promise.all([
    inject('POST', '/api/v1/invitations/accept', carol, { token: rawToken }),
    inject('POST', '/api/v1/invitations/accept', carol, { token: rawToken }),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  expect(
    await prisma.workspaceMembership.count({
      where: { workspaceId: ownerWorkspaceId, user: { email: 'carol@harmofin.test' }, isActive: true },
    }),
  ).toBe(1);
});

it('rejects expired and revoked invitations', async () => {
  const expired = await createInvitation(owner, 'late@harmofin.test', 'EDITOR');
  await prisma.workspaceInvitation.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const late = await register('late@harmofin.test');
  await setDisplayName(late, 'Поздний');
  const lateAccept = await inject('POST', '/api/v1/invitations/accept', late, { token: expired.rawToken });
  expect(lateAccept.statusCode).toBe(410);
  expect(lateAccept.json()).toMatchObject({ code: 'INVITATION_EXPIRED' });
});

it('reactivates a removed member with the new role', async () => {
  const dave = await register('dave@harmofin.test');
  await setDisplayName(dave, 'Дэйв');
  const first = await createInvitation(owner, 'dave@harmofin.test', 'EDITOR');
  await inject('POST', '/api/v1/invitations/accept', dave, { token: first.rawToken });
  const membershipId = (
    await prisma.workspaceMembership.findFirstOrThrow({
      where: { workspaceId: ownerWorkspaceId, userId: dave.user.id },
    })
  ).id;
  await inject('DELETE', `/api/v1/workspaces/${ownerWorkspaceId}/members/${membershipId}`, owner);
  const second = await createInvitation(owner, 'dave@harmofin.test', 'VIEWER');
  const accepted = await inject('POST', '/api/v1/invitations/accept', dave, { token: second.rawToken });
  expect(accepted.statusCode).toBe(200);
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { workspaceId: ownerWorkspaceId, userId: dave.user.id },
  });
  expect(membership).toMatchObject({ isActive: true, role: 'VIEWER', removedAt: null });
});

it('returns memberships with isCreator and the selected workspace in me', async () => {
  await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/select`, bob);
  const me = await inject('GET', '/api/v1/me', bob);
  const body = me.json<{ activeWorkspaceId: string; workspaces: Array<{ id: string; isCreator: boolean }> }>();
  expect(body.activeWorkspaceId).toBe(ownerWorkspaceId);
  expect(body.workspaces.find((item) => item.id === ownerWorkspaceId)?.isCreator).toBe(false);
});

it('logs in to the last selected workspace', async () => {
  const login = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: 'bob-accept@harmofin.test', password },
  });
  expect(login.json<{ workspace: { id: string } }>().workspace.id).toBe(ownerWorkspaceId);
});
```

`currentConsents` — как в существующих тестах регистрации (`grep -n "consents" apps/api/test/auth.integration.test.ts`). `setDisplayName` вызывает новый `PATCH /api/v1/me`. `createInvitation(actor, email, role)` вызывает `POST /api/v1/workspaces/${ownerWorkspaceId}/invitations` и возвращает `{ id, rawToken }`, где `rawToken` берётся из фрагмента `inviteUrl`. Создатель (`owner`) в `beforeAll` получает имя «Ильдар» через `setDisplayName`.

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/family-accept.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL.

- [ ] **Step 3: Общая функция принятия**

```ts
// apps/api/src/family/invitation-acceptance.ts
import { createAccessNotification } from './family-notifications.js';
import {
  alreadyMember,
  invitationAlreadyAccepted,
  invitationEmailMismatch,
  invitationExpired,
  invitationNotFound,
  invitationRevoked,
  memberLimitReached,
} from './family.errors.js';
import type { Tx } from './family.repository.js';
import { MEMBER_LIMIT, isExpired, normalizeEmail } from './invitation.domain.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

type LockedInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: 'EDITOR' | 'VIEWER';
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
};

export async function lockInvitationByTokenHash(tx: Tx, tokenHash: string) {
  const rows = await tx.$queryRaw<LockedInvitation[]>`
    SELECT i.id, i.workspace_id AS "workspaceId", i.email, i.role::text AS role,
           i.status::text AS status, i.expires_at AS "expiresAt"
    FROM workspace_invitations i
    JOIN workspaces w ON w.id = i.workspace_id AND w.status = 'ACTIVE'
    WHERE i.token_hash = ${tokenHash}
    FOR UPDATE OF i
  `;
  return rows[0] ?? null;
}

/** Validates state and email, then creates or reactivates the membership. Caller owns the tx. */
export async function acceptInvitationInTx(
  tx: Tx,
  input: { tokenHash: string; userId: string; userEmail: string; now: Date; requestId?: string | undefined },
) {
  const invitation = await lockInvitationByTokenHash(tx, input.tokenHash);
  if (!invitation) throw invitationNotFound();
  if (invitation.status === 'ACCEPTED') throw invitationAlreadyAccepted();
  if (invitation.status === 'REVOKED') throw invitationRevoked();
  if (invitation.status === 'EXPIRED' || isExpired(invitation.expiresAt, input.now)) {
    await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    throw invitationExpired();
  }
  if (normalizeEmail(input.userEmail) !== invitation.email) throw invitationEmailMismatch();

  const existing = await tx.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: input.userId } },
    select: { id: true, isActive: true },
  });
  if (existing?.isActive) throw alreadyMember();
  const activeCount = await tx.workspaceMembership.count({
    where: { workspaceId: invitation.workspaceId, isActive: true },
  });
  if (activeCount >= MEMBER_LIMIT) throw memberLimitReached();

  const membershipId = existing?.id ?? createUuidV7(input.now);
  if (existing) {
    await tx.workspaceMembership.update({
      where: { id: existing.id },
      data: { isActive: true, removedAt: null, role: invitation.role, lastSelectedAt: input.now },
    });
  } else {
    await tx.workspaceMembership.create({
      data: {
        id: membershipId,
        workspaceId: invitation.workspaceId,
        userId: input.userId,
        role: invitation.role,
        lastSelectedAt: input.now,
      },
    });
  }
  await tx.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { status: 'ACCEPTED', acceptedAt: input.now, acceptedByUserId: input.userId },
  });

  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: invitation.workspaceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      budgets: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, primaryCurrency: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });
  const budget = workspace.budgets[0];
  if (!budget) throw invitationNotFound();
  const member = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { displayName: true, email: true },
  });
  await tx.auditEvent.create({
    data: {
      id: createUuidV7(input.now),
      actorUserId: input.userId,
      workspaceId: workspace.id,
      budgetId: budget.id,
      entityType: 'workspace_invitation',
      entityId: invitation.id,
      action: 'ACCEPTED',
      newValues: { role: invitation.role, membershipId },
      source: 'API',
      requestId: input.requestId ?? null,
    },
  });
  await createAccessNotification(tx, {
    workspaceId: workspace.id,
    budgetId: budget.id,
    userId: workspace.ownerId,
    type: 'MEMBER_JOINED',
    memberName: member.displayName ?? member.email,
    eventKey: invitation.id,
  });
  return { workspaceId: workspace.id, workspaceName: workspace.name, budget };
}
```

Для пользователя, у которого личный workspace вновь активируется после повторного приглашения, порядок проверок не меняется. `lastSelectedAt: now` делает семью активной сразу после принятия.

- [ ] **Step 4: `preview` и `accept` в сервисе**

```ts
  async preview(rawToken: string): Promise<InvitationPreviewResponse> {
    const now = new Date();
    const row = await this.repository.transaction((tx) =>
      tx.workspaceInvitation.findFirst({
        where: { tokenHash: this.tokens.digest(rawToken), workspace: { status: 'ACTIVE' } },
        select: {
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          workspace: { select: { name: true } },
          invitedBy: { select: { displayName: true } },
        },
      }),
    );
    if (!row) throw invitationNotFound();
    if (row.status === 'ACCEPTED') throw invitationAlreadyAccepted();
    if (row.status === 'REVOKED') throw invitationRevoked();
    if (row.status === 'EXPIRED' || isExpired(row.expiresAt, now)) throw invitationExpired();
    return {
      workspaceName: row.workspace.name,
      inviterName: row.invitedBy.displayName ?? 'Создатель семьи',
      role: row.role as InvitableRole,
      maskedEmail: maskEmail(row.email),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async accept(
    userId: string,
    input: { token: string; displayName?: string | undefined },
    requestId?: string,
  ): Promise<{ workspaceId: string; budgetId: string }> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, displayName: true },
      });
      const displayName = input.displayName ?? user.displayName;
      if (!displayName) throw displayNameRequired();
      if (input.displayName && input.displayName !== user.displayName) {
        await tx.user.update({ where: { id: userId }, data: { displayName: input.displayName } });
      }
      const accepted = await acceptInvitationInTx(tx, {
        tokenHash: this.tokens.digest(input.token),
        userId,
        userEmail: user.email,
        now,
        requestId,
      });
      return { workspaceId: accepted.workspaceId, budgetId: accepted.budget.id };
    });
  }
```

(импортировать `maskEmail`, `invitationNotFound`, `invitationAlreadyAccepted`, `invitationRevoked`, `invitationExpired`, `acceptInvitationInTx`.)

- [ ] **Step 5: Контроллеры**

`invitation-public.controller.ts`:
- `InvitationPreviewController` — `@ApiTags('family')`, `@Controller('invitations')`, **без** `SessionAuthGuard` и `CsrfGuard`; `@Post('preview')`, `@HttpCode(200)`, `@UseGuards(AuthRateLimitGuard)`, `ZodValidationPipe(invitationTokenSchema)`; ответы 200 `InvitationPreviewResponse`, 400, 404, 409, 410, 429.
- `InvitationAcceptController` — `@Controller('invitations')`, `@UseGuards(SessionAuthGuard)`; `@Post('accept')`, `@HttpCode(200)`, `@UseGuards(CsrfGuard, AuthRateLimitGuard)`, `ZodValidationPipe(acceptInvitationSchema)`; ответы 200 `AcceptedInvitationResponse`, 400, 401, 403, 404, 409, 410, 422, 429.

Оба контроллера добавить в `FamilyModule`. Проверить, что глобальный `OriginGuard` пропускает `preview` при правильном `Origin` (как `auth/recovery/request`).

- [ ] **Step 6: Регистрация по приглашению**

`auth.schemas.ts`: в `registerSchema` добавить `invitationToken: z.string().min(16).max(128).optional()`.

`AuthApplicationService.register`: если `input.invitationToken` задан — после создания пользователя **не** создавать workspace/budget/membership, а вызвать

```ts
const accepted = await acceptInvitationInTx(tx, {
  tokenHash: this.tokenService.digest(input.invitationToken),
  userId: user.id,
  userEmail: user.email,
  now,
  requestId: requestMeta.requestId,
});
workspace = { id: accepted.workspaceId, name: accepted.workspaceName };
budget = accepted.budget;
```

Ветку без токена оставить как есть (вынести создание личного пространства в `createPersonalWorkspace(tx, user.id, now, requestMeta.requestId, { workspaceName: input.workspaceName ?? 'Мой бюджет', budgetName: input.budgetName ?? 'Семейный бюджет' })`). `AuditEvent` `REGISTERED` пишется с `workspaceId`/`budgetId` из выбранной ветки. Любая ошибка принятия откатывает всю транзакцию — пользователь не создаётся. Имя (`displayName`) при регистрации по приглашению запрашивается позже на странице `/invite` через `PATCH /me` — сервер его не требует при регистрации.

- [ ] **Step 7: `me`, профиль, пространство по умолчанию**

`findDefaultMembership`:

```ts
      orderBy: [{ lastSelectedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
```

`me`: в `select` членства добавить `lastSelectedAt: true`, `createdAt: true`, `workspace.ownerId`. Ответ:

```ts
    const ordered = [...memberships].sort(compareDefault); // lastSelectedAt desc nulls last, createdAt asc
    return {
      user,
      activeWorkspaceId: ordered[0]?.workspace.id ?? null,
      workspaces: memberships.map(({ role, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        role,
        isCreator: workspace.ownerId === userId,
        budgets: workspace.budgets,
      })),
      pendingConsents: pendingConsents(accepted),
    };
```

`compareDefault` — локальная функция с тем же порядком, что `orderBy`. Обновить DTO ответа `me` в `auth.dto.ts` (`isCreator`, `activeWorkspaceId`).

`PATCH /me` в `auth.controller.ts`: `SessionAuthGuard` + `CsrfGuard`, `ZodValidationPipe(updateProfileSchema)` (схему импортировать из `family/family.schemas.ts` или положить в `auth.schemas.ts` — положить в `auth.schemas.ts`, чтобы auth не зависел от family), метод сервиса `updateProfile(userId, { displayName })` → `tx.user.update` + `AuditEvent` `entityType: 'user', action: 'PROFILE_UPDATED'` без значений имени в `oldValues`. Ответ `{ user: { id, email, displayName } }`.

- [ ] **Step 8: Тесты проходят**

Run: команда Step 2, затем `pnpm --filter @harmofin/api exec vitest run test/auth.integration.test.ts test/family-members.integration.test.ts test/v2-openapi.integration.test.ts --config vitest.integration.config.ts`
Expected: PASS. В `family-members.integration.test.ts` заменить временную проверку личного пространства на проверку `me.workspaces[0].isCreator`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/family apps/api/src/auth apps/api/test/family-accept.integration.test.ts apps/api/test/family-members.integration.test.ts apps/api/test/auth.integration.test.ts
git commit -m "feat(api): принятие приглашения и регистрация по ссылке"
```

---

### Task 7: Плановые уведомления всем создателям и участникам

**Files:**
- Modify: `apps/worker/src/notification.handler.ts`
- Test: `apps/api/test/v2-notifications.integration.test.ts` (или тест worker рядом — посмотреть, где сейчас тестируется `NotificationRuleHandler`: `grep -rn "NotificationRuleHandler" apps --include=*.test.ts`)

**Interfaces:**
- Consumes: активные членства с ролью `OWNER | EDITOR`.
- Produces: уведомления `PLAN_TODAY`/`PLAN_OVERDUE` на каждого получателя, ключ `occurrence:{id}:{type}` уникален в паре `(budgetId, userId)`.

- [ ] **Step 1: Падающий тест**

Добавить в существующий тест уведомлений worker кейс: в бюджете создатель, `EDITOR` и `VIEWER`; одна просроченная occurrence. После `execute(now, budgetId)`:

```ts
expect(
  await prisma.notification.findMany({
    where: { budgetId, notificationType: 'PLAN_OVERDUE', resolvedAt: null },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  }),
).toEqual([{ userId: ownerId }, { userId: editorId }].sort((a, b) => a.userId.localeCompare(b.userId)));
```

И второй кейс: после оплаты occurrence оба уведомления закрываются (`resolvedAt` не null у обоих).

- [ ] **Step 2: Запустить — падает**

Run: соответствующий `vitest run …` (integration-конфиг).
Expected: FAIL — уведомление только у создателя.

- [ ] **Step 3: Реализация**

В `execute` заменить `workspace: { select: { ownerId: true } }` на

```ts
        workspace: {
          select: {
            memberships: {
              where: { isActive: true, role: { in: ['OWNER', 'EDITOR'] } },
              select: { userId: true },
            },
          },
        },
```

`ActiveBudget.workspace` → `{ memberships: Array<{ userId: string }> }`. В `evaluateBudget`: `const recipientIds = budget.workspace.memberships.map((m) => m.userId);`. Цикл создания: для каждой occurrence и каждого `userId` из `recipientIds` вызвать `createOccurrenceNotification(tx, budget, userId, type, occurrence)`; набор `active` хранит ключ без пользователя (как сейчас). Поиск `unresolved` — `userId: { in: recipientIds }`; аудит закрытия — с `notification.userId` (добавить `userId: true` в `select`). Уведомления пользователей, которые больше не получатели (удалены или стали `VIEWER`), закрываются отдельным `updateMany`:

```ts
  await tx.notification.updateMany({
    where: {
      budgetId: budget.id,
      resolvedAt: null,
      notificationType: { in: ['PLAN_TODAY', 'PLAN_OVERDUE'] },
      userId: { notIn: recipientIds },
    },
    data: { resolvedAt: new Date() },
  });
```

Обновить комментарий над `evaluateBudget`: получатели — активные `OWNER` и `EDITOR`.

- [ ] **Step 4: Тест проходит**

Run: та же команда + весь набор тестов worker (`pnpm --filter @harmofin/worker test`, если есть).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/notification.handler.ts <путь к тесту>
git commit -m "feat(worker): плановые уведомления всем участникам семьи"
```

---

### Task 8: Авторство в журнале и фильтр по автору

**Files:**
- Modify: `apps/api/src/v2-journal/journal.schemas.ts`, `journal.repository.ts`, `journal.application.service.ts`, `journal.dto.ts`
- Modify: репозиторий с `validateJournalReferences` (найти: `grep -rn "validateJournalReferences" apps/api/src`)
- Modify: `apps/api/src/v2-transfers/direct-transfer.repository.ts` (`transferRowSelect` + `createdByUserId`, если его нет) и маппер `toTransferJournalItem`
- Test: `apps/api/test/v2-journal.integration.test.ts`

**Interfaces:**
- Produces:
  - `AuthorRef = { userId: string; displayName: string | null; isActiveMember: boolean }`
  - элементы журнала (оба вида: `TRANSACTION` и `TRANSFER`) получают `createdBy: AuthorRef`
  - фильтр `createdByUserId?: uuid`; чужой или несуществующий пользователь → 404 `RESOURCE_NOT_FOUND` до выборки

- [ ] **Step 1: Падающий тест**

В `v2-journal.integration.test.ts` добавить: создатель и `EDITOR` (членство через Prisma, `displayName: 'Алия'`) в одном бюджете; каждый создаёт по расходу через API.

```ts
it('returns the author of every journal item and filters by author', async () => {
  const all = await inject('GET', `/api/v2/budgets/${budgetId}/journal`, owner);
  const items = all.json<{ items: Array<{ createdBy: { userId: string; displayName: string | null; isActiveMember: boolean } }> }>().items;
  expect(items.map((item) => item.createdBy.userId)).toEqual(
    expect.arrayContaining([owner.user.id, alia.user.id]),
  );
  expect(items.find((item) => item.createdBy.userId === alia.user.id)?.createdBy).toEqual({
    userId: alia.user.id,
    displayName: 'Алия',
    isActiveMember: true,
  });

  const filtered = await inject(
    'GET',
    `/api/v2/budgets/${budgetId}/journal?createdByUserId=${alia.user.id}`,
    owner,
  );
  expect(
    filtered.json<{ items: Array<{ createdBy: { userId: string } }> }>().items.every(
      (item) => item.createdBy.userId === alia.user.id,
    ),
  ).toBe(true);
});

it('marks the author of a removed member as inactive', async () => {
  await prisma.workspaceMembership.updateMany({
    where: { workspaceId, userId: alia.user.id },
    data: { isActive: false, removedAt: new Date() },
  });
  const all = await inject('GET', `/api/v2/budgets/${budgetId}/journal`, owner);
  const aliaItem = all
    .json<{ items: Array<{ createdBy: { userId: string; isActiveMember: boolean } }> }>()
    .items.find((item) => item.createdBy.userId === alia.user.id);
  expect(aliaItem?.createdBy.isActiveMember).toBe(false);
});

it('answers 404 for an author outside the workspace', async () => {
  const response = await inject(
    'GET',
    `/api/v2/budgets/${budgetId}/journal?createdByUserId=${stranger.user.id}`,
    owner,
  );
  expect(response.statusCode).toBe(404);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/v2-journal.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

- `journal.schemas.ts`: `createdByUserId: uuid.optional()`.
- `FeedFilter`: `createdByUserId?: string | undefined`; `transactionFeedSelect` + `createdByUserId: true`; в where транзакций и переводов: `...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {})`. В `transferRowSelect` добавить `createdByUserId: true`, если поля нет.
- `validateJournalReferences`: если задан `createdByUserId` — существует членство (любое, активное или нет) этого пользователя в workspace бюджета: `workspaceMembership.findFirst({ where: { userId, workspace: { budgets: { some: { id: budgetId } } } } })`.
- Новый метод репозитория `findAuthors(budgetId: string, userIds: string[]): Promise<Map<string, AuthorRef>>`:

```ts
  async findAuthors(budgetId: string, userIds: string[]) {
    if (userIds.length === 0) return new Map<string, AuthorRef>();
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { userId: { in: userIds }, workspace: { budgets: { some: { id: budgetId } } } },
      select: { userId: true, isActive: true, user: { select: { displayName: true } } },
    });
    return new Map(
      rows.map((row) => [
        row.userId,
        { userId: row.userId, displayName: row.user.displayName, isActiveMember: row.isActive },
      ]),
    );
  }
```

Автор без членства (исторические данные) → `{ userId, displayName: null, isActiveMember: false }`.
- `journal.application.service.ts`: после выборки собрать уникальные `createdByUserId` обоих списков, вызвать `findAuthors`, добавить `createdBy` в каждый элемент `left` и `right`.
- `journal.dto.ts`: класс `AuthorRefResponse` (`userId`, `displayName` nullable, `isActiveMember`); поле `createdBy` в `TransactionFeedItemResponse` и в DTO перевода в журнале; `@ApiQuery` для `createdByUserId` в контроллере.

- [ ] **Step 4: Тест проходит**

Run: команда Step 2 + `test/v2-openapi.integration.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/v2-journal apps/api/src/v2-transfers apps/api/test/v2-journal.integration.test.ts
git commit -m "feat(api): автор операции в журнале и фильтр по автору"
```

---

### Task 9: Удаление аккаунта участника

**Files:**
- Modify: `apps/api/src/account-deletion/account-deletion.application.service.ts`, `account-deletion.repository.ts`
- Test: `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Consumes: `resolveUserNotifications`, `createAccessNotification`, `FamilyRepository.findActiveBudgetId` (или прямой запрос в репозитории удаления).
- Produces: при удалении аккаунта участника его открытые уведомления в чужих семьях закрыты, создатель каждой семьи получает `MEMBER_LEFT`, текст ошибки `ACCOUNT_DELETION_HAS_MEMBERS` — «В вашей семье есть другие участники. Сначала удалите их на странице «Семья».».

- [ ] **Step 1: Падающий тест**

В `account-deletion.integration.test.ts`: участник `EDITOR` в семье создателя с открытым уведомлением удаляет аккаунт.

```ts
expect(
  await prisma.notification.count({ where: { userId: memberId, workspaceId: familyId, resolvedAt: null } }),
).toBe(0);
expect(
  await prisma.notification.count({ where: { userId: creatorId, notificationType: 'MEMBER_LEFT' } }),
).toBe(1);
```

И проверка текста `ACCOUNT_DELETION_HAS_MEMBERS` для создателя с участником.

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/api exec vitest run test/account-deletion.integration.test.ts --config vitest.integration.config.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`deactivateForeignMemberships` возвращает дополнительно `workspaceId` каждого деактивированного членства (`select: { id: true, workspaceId: true, workspace: { select: { ownerId: true } } }`). В сервисе после деактивации для каждого такого членства: `resolveUserNotifications(tx, workspaceId, userId, now)`; найти активный бюджет; `createAccessNotification(tx, { workspaceId, budgetId, userId: ownerId, type: 'MEMBER_LEFT', memberName: user.displayName ?? user.email, eventKey: `${membershipId}:${now.toISOString()}` })`. Восстановление аккаунта (`restoreScope`) членства уже реактивирует — не менять. Обновить `detail` в `hasMembers()`.

- [ ] **Step 4: Тест проходит**

Run: команда Step 2 + `pnpm --filter @harmofin/api exec vitest run src/account-deletion`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/account-deletion apps/api/test/account-deletion.integration.test.ts
git commit -m "feat(api): удаление аккаунта участника уведомляет создателя семьи"
```

---

### Task 10: Активное пространство и переключатель (web)

**Files:**
- Create: `apps/web/app/composables/useActiveWorkspace.ts`, `useActiveWorkspace.test.ts`
- Create: `apps/web/app/components/app/AppWorkspaceSwitcher.vue`, `AppWorkspaceSwitcher.test.ts`
- Modify: `apps/web/app/composables/useAuth.ts` (тип `MeResponse`, `selectWorkspace`, `createPersonalWorkspace`, `updateProfile`)
- Modify: все места с `workspaces[0]` (список: `grep -rn "workspaces\[0\]" apps/web/app --include=*.ts --include=*.vue`, сейчас 16 мест в `useFundingEntry.ts`, `useOperationReferenceData.ts`, `pages/app/accounts.vue`, `analytics.vue`, `categories.vue`, `envelopes/index.vue`, `envelopes/rules.vue`, `index.vue`, `notifications.vue`, `operations.vue`, `plans.vue`, `settings/general.vue`, `settings/index.vue`) и их тесты-фикстуры
- Modify: `apps/web/app/components/app/AppSidebar.vue`, `AppHeader.vue` (или `AppMobileMenu.vue` — где показывается название бюджета на мобильном)

**Interfaces:**
- Produces:
  - `type WorkspaceMembership = { id: string; name: string; role: 'OWNER' | 'EDITOR' | 'VIEWER'; isCreator: boolean; budgets: BudgetSummary[] }`
  - `MeResponse` + `activeWorkspaceId: string | null`, `workspaces: WorkspaceMembership[]`
  - `useActiveWorkspace(): { workspace: ComputedRef<WorkspaceMembership | null>; budget: ComputedRef<BudgetSummary | null>; budgetId: ComputedRef<string | undefined>; role: ComputedRef<'OWNER' | 'EDITOR' | 'VIEWER' | null>; isCreator: ComputedRef<boolean>; workspaces: ComputedRef<WorkspaceMembership[]> }`
  - `useAuth().selectWorkspace(workspaceId: string): Promise<void>` — `POST /api/v1/workspaces/:id/select`, затем `loadMe()`
  - `useAuth().createPersonalWorkspace(): Promise<void>` — `POST /api/v1/workspaces` `{ workspaceName: 'Мой бюджет', budgetName: 'Мой бюджет' }`, затем `loadMe()`
  - `useAuth().updateProfile(displayName: string): Promise<void>` — `PATCH /api/v1/me`, обновляет `currentUser`

- [ ] **Step 1: Падающий тест composable**

```ts
// apps/web/app/composables/useActiveWorkspace.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const currentData = ref<unknown>(null);
vi.mock('./useAuth.js', () => ({ useAuth: () => ({ currentData }) }));

import { useActiveWorkspace } from './useActiveWorkspace.js';

const budget = (id: string) => ({ id, name: id, primaryCurrency: 'RUB', planModelVersion: 2 as const });

describe('useActiveWorkspace', () => {
  it('picks the workspace named by activeWorkspaceId, not the first one', () => {
    currentData.value = {
      activeWorkspaceId: 'family',
      workspaces: [
        { id: 'personal', name: 'Мой бюджет', role: 'OWNER', isCreator: true, budgets: [budget('b1')] },
        { id: 'family', name: 'Сираевы', role: 'EDITOR', isCreator: false, budgets: [budget('b2')] },
      ],
    };
    const active = useActiveWorkspace();
    expect(active.workspace.value?.id).toBe('family');
    expect(active.budgetId.value).toBe('b2');
    expect(active.role.value).toBe('EDITOR');
    expect(active.isCreator.value).toBe(false);
  });

  it('falls back to the first workspace when the active id is unknown', () => {
    currentData.value = {
      activeWorkspaceId: null,
      workspaces: [{ id: 'personal', name: 'Мой бюджет', role: 'OWNER', isCreator: true, budgets: [budget('b1')] }],
    };
    expect(useActiveWorkspace().budgetId.value).toBe('b1');
  });

  it('is empty before me is loaded', () => {
    currentData.value = null;
    const active = useActiveWorkspace();
    expect(active.workspace.value).toBeNull();
    expect(active.role.value).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useActiveWorkspace.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация composable**

```ts
// apps/web/app/composables/useActiveWorkspace.ts
import { computed } from 'vue';

import { useAuth, type BudgetSummary, type WorkspaceMembership } from './useAuth.js';

export function useActiveWorkspace() {
  const { currentData } = useAuth();
  const workspaces = computed<WorkspaceMembership[]>(() => currentData.value?.workspaces ?? []);
  const workspace = computed<WorkspaceMembership | null>(() => {
    const list = workspaces.value;
    const activeId = currentData.value?.activeWorkspaceId;
    return list.find((item) => item.id === activeId) ?? list[0] ?? null;
  });
  const budget = computed<BudgetSummary | null>(() => workspace.value?.budgets[0] ?? null);
  return {
    workspaces,
    workspace,
    budget,
    budgetId: computed(() => budget.value?.id),
    role: computed(() => workspace.value?.role ?? null),
    isCreator: computed(() => workspace.value?.isCreator ?? false),
  };
}
```

В `useAuth.ts` экспортировать `WorkspaceMembership`, расширить `MeResponse`, добавить `selectWorkspace`, `createPersonalWorkspace`, `updateProfile`.

- [ ] **Step 4: Заменить `workspaces[0]`**

В каждом из мест — `const { budgetId } = useActiveWorkspace();` (или `budget`, `workspace`, `role`). `analytics.vue`: `isOwner` → `computed(() => role.value === 'OWNER')`. В тестах страниц, где фикстура `me` собирается вручную, добавить `activeWorkspaceId` и `isCreator`. После замены `grep -rn "workspaces\[0\]" apps/web/app` не находит ничего, кроме `useActiveWorkspace.ts`.

Смена пространства: `selectWorkspace` после `loadMe()` делает `await navigateTo('/app')` — дашборд монтируется заново с новым `budgetId`. Кеши справочников (`useOperationReferenceData`, `useBudgetReferenceData`) обязаны сбрасываться при смене `budgetId`: добавить по тесту в каждый composable («после смены budgetId запрашивает данные нового бюджета») и исправить, если тест падает.

- [ ] **Step 5: Переключатель**

```vue
<!-- apps/web/app/components/app/AppWorkspaceSwitcher.vue -->
<script setup lang="ts">
import { useId } from 'vue';
import { Check, Plus } from '@lucide/vue';

import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { useAuth } from '../../composables/useAuth.js';
import UiActionMenu from '../ui/ActionMenu.vue';

defineOptions({ name: 'AppWorkspaceSwitcher' });

const { workspaces, workspace } = useActiveWorkspace();
const { selectWorkspace, createPersonalWorkspace } = useAuth();
const listId = useId();
const hasOwnWorkspace = () => workspaces.value.some((item) => item.isCreator);
</script>

<template>
  <div class="workspace-switcher">
    <span class="workspace-switcher__name">{{ workspace?.name ?? 'Бюджет' }}</span>
    <UiActionMenu
      v-if="workspaces.length > 1 || !hasOwnWorkspace()"
      label="Сменить пространство"
      tooltip="Сменить пространство"
      tooltip-placement="bottom"
      align="start"
      :list-id="listId"
      trigger-test-id="workspace-switcher"
    >
      <button
        v-for="item in workspaces"
        :key="item.id"
        type="button"
        role="menuitem"
        :aria-current="item.id === workspace?.id ? 'true' : undefined"
        :data-testid="`workspace-option-${item.id}`"
        @click="selectWorkspace(item.id)"
      >
        <Check v-if="item.id === workspace?.id" :size="16" aria-hidden="true" />
        <span>{{ item.name }}</span>
        <span v-if="item.id === workspace?.id" class="visually-hidden">(текущее)</span>
      </button>
      <button
        v-if="!hasOwnWorkspace()"
        type="button"
        role="menuitem"
        data-testid="workspace-create-personal"
        @click="createPersonalWorkspace()"
      >
        <Plus :size="16" aria-hidden="true" />
        <span>Создать личный бюджет</span>
      </button>
    </UiActionMenu>
  </div>
</template>
```

Стили — токены `--hf-*`, имя `font-weight: 600`, без цвета для состояния; класс `visually-hidden` — проверить, как он называется в проекте (`grep -rn "visually-hidden\|sr-only" apps/web/app/assets`). Пункт «Создать личный бюджет» показывается только тем, у кого нет собственного пространства (иначе создавались бы лишние бюджеты; несколько бюджетов у одного создателя — вне v1). Подключить в `AppSidebar.vue` над навигацией и в мобильную шапку.

Тест `AppWorkspaceSwitcher.test.ts`: одно собственное пространство — меню не рендерится, только название; два — меню с отметкой текущего; клик по пункту вызывает `selectWorkspace(id)`; у участника без своего пространства есть «Создать личный бюджет».

- [ ] **Step 6: Тесты проходят**

Run: `pnpm --filter @harmofin/web exec vitest run` и `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): активное пространство и переключатель семьи"
```

---

### Task 11: Права в интерфейсе по роли

**Files:**
- Create: `apps/web/app/composables/usePermissions.ts`, `usePermissions.test.ts`
- Modify: страницы и компоненты с действиями, которые сервер разрешает только `OWNER` или только `OWNER | EDITOR`

**Interfaces:**
- Consumes: `useActiveWorkspace().role`.
- Produces: `usePermissions(): { canManage: ComputedRef<boolean>; canWrite: ComputedRef<boolean> }` — `canManage = role === 'OWNER'`, `canWrite = role === 'OWNER' || role === 'EDITOR'`.

- [ ] **Step 1: Составить список ограничений**

Run: `grep -rn "canManage\|role !== 'OWNER'\|WRITE_ROLES\|allowEditor\|forbidden()" apps/api/src --include=*.ts | grep -v "\.test\."`
Записать в описание задачи для review таблицу «эндпоинт → разрешённые роли» по результатам (ожидаемо: управление счетами, категориями, конвертами, планами, правилами наполнения, шаблоном, циклом, настройками бюджета, окно распределения (preview/confirm), журнал со статусом `DELETED` — `OWNER`; операции, переводы, запись платежа/дохода по плану — `OWNER | EDITOR`).

- [ ] **Step 2: Падающий тест composable и страниц**

```ts
// apps/web/app/composables/usePermissions.test.ts
import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const role = ref<'OWNER' | 'EDITOR' | 'VIEWER' | null>(null);
vi.mock('./useActiveWorkspace.js', () => ({ useActiveWorkspace: () => ({ role: computed(() => role.value) }) }));

import { usePermissions } from './usePermissions.js';

describe('usePermissions', () => {
  it.each([
    ['OWNER', true, true],
    ['EDITOR', false, true],
    ['VIEWER', false, false],
    [null, false, false],
  ] as const)('%s → manage %s, write %s', (value, manage, write) => {
    role.value = value;
    const permissions = usePermissions();
    expect(permissions.canManage.value).toBe(manage);
    expect(permissions.canWrite.value).toBe(write);
  });
});
```

В тестах страниц `accounts`, `categories`, `envelopes/index`, `plans`, `settings/index`, `operations` и `AppAddMenu`/`AppBottomNav` добавить кейсы: для `VIEWER` нет кнопок создания и «+»; для `EDITOR` нет кнопок управления (создать счёт, архивировать, правила, шаблон, цикл), но есть добавление операции.

- [ ] **Step 3: Запустить — падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/usePermissions.test.ts app/pages app/components/app`
Expected: FAIL.

- [ ] **Step 4: Реализация**

```ts
// apps/web/app/composables/usePermissions.ts
import { computed } from 'vue';

import { useActiveWorkspace } from './useActiveWorkspace.js';

/** UI hint only: the server checks every action again. */
export function usePermissions() {
  const { role } = useActiveWorkspace();
  return {
    canManage: computed(() => role.value === 'OWNER'),
    canWrite: computed(() => role.value === 'OWNER' || role.value === 'EDITOR'),
  };
}
```

Обернуть действия по таблице из Step 1 в `v-if="canManage"` / `v-if="canWrite"`. Для `VIEWER` на дашборде и в журнале — без кнопок записи. Скрытие — только подсказка; серверные проверки не меняются.

- [ ] **Step 5: Тесты проходят**

Run: `pnpm --filter @harmofin/web exec vitest run` и `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): действия в интерфейсе по роли участника"
```

---

### Task 12: Страница «Семья» и диалог приглашения

**Files:**
- Create: `apps/web/app/composables/useFamily.ts`, `useFamily.test.ts`
- Create: `apps/web/app/components/family/FamilyMembersCard.vue`, `FamilyInvitationsCard.vue`, `FamilyInviteDialog.vue`, `FamilyProfileNameCard.vue` + тесты `*.test.ts`
- Create: `apps/web/app/pages/app/settings/family.vue`, `family.test.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue` (карточка «Семья» со ссылкой)

**Interfaces:**
- Consumes: `useActiveWorkspace()`, `useAuth().updateProfile`, `useApiClient()`.
- Produces: `useFamily(workspaceId: Ref<string | undefined>)`:
  - `members: Ref<Member[]>`, `invitations: Ref<Invitation[]>`, `loading: Ref<boolean>`, `error: Ref<string | null>`
  - `load(): Promise<void>` — участники всем, приглашения только при `isCreator`
  - `invite(email: string, role: 'EDITOR' | 'VIEWER'): Promise<CreatedInvitation>`
  - `resend(id: string): Promise<CreatedInvitation>`
  - `revoke(id: string): Promise<void>`
  - `changeRole(membershipId: string, role: 'EDITOR' | 'VIEWER'): Promise<void>`
  - `removeMember(membershipId: string): Promise<void>`
  - `leave(): Promise<void>` — после успеха `loadMe()` и `navigateTo('/app')`
  - типы `Member`, `Invitation`, `CreatedInvitation = Invitation & { inviteUrl: string }` — поля как в ответах API задач 4–5

- [ ] **Step 1: Падающие тесты**

`useFamily.test.ts` — с фейковым `useApiClient` проверить URL и методы каждого вызова, что `invite` возвращает `inviteUrl`, а `load` не запрашивает приглашения у не-создателя.

`family.test.ts` (страница) — кейсы:
- создатель без имени видит `FamilyProfileNameCard` («Укажите ваше имя — его увидят участники»), кнопка «Пригласить» неактивна;
- создатель с именем: список участников («Создатель» у себя, роли текстом), карточка приглашений, кнопка «Пригласить»;
- у строки участника — `UiActionMenu` с `aria-label="Действия: Алия"` и пунктами «Сделать наблюдателем»/«Сделать участником», «Удалить из семьи» (с `UiConfirmDialog`);
- у строки создателя меню нет;
- `EDITOR`: только чтение и кнопка «Выйти из семьи» с подтверждением;
- после отправки приглашения диалог показывает «Письмо отправлено», поле со ссылкой (readonly), кнопку «Копировать» и подпись «Ссылка показывается один раз»; toast не показывается;
- ошибка `INVITATION_ALREADY_PENDING` выводится у поля email, `ALREADY_MEMBER` — тоже у поля;
- после закрытия диалога фокус на «Пригласить».

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useFamily.test.ts app/components/family app/pages/app/settings/family.test.ts`
Expected: FAIL.

- [ ] **Step 3: Composable**

```ts
// apps/web/app/composables/useFamily.ts
import { ref, type Ref } from 'vue';
import { navigateTo } from '#imports';

import { useApiClient } from './useApiClient.js';
import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';

export type FamilyRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: FamilyRole;
  isCreator: boolean;
  joinedAt: string;
};
export type Invitation = {
  id: string;
  email: string;
  role: 'EDITOR' | 'VIEWER';
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
};
export type CreatedInvitation = Invitation & { inviteUrl: string };

export function useFamily(workspaceId: Ref<string | undefined>) {
  const api = useApiClient();
  const auth = useAuth();
  const { isCreator } = useActiveWorkspace();
  const members = ref<Member[]>([]);
  const invitations = ref<Invitation[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const base = () => `/api/v1/workspaces/${encodeURIComponent(workspaceId.value ?? '')}`;

  async function load(): Promise<void> {
    if (!workspaceId.value) return;
    loading.value = true;
    error.value = null;
    try {
      members.value = await api.request<Member[]>(`${base()}/members`);
      invitations.value = isCreator.value
        ? await api.request<Invitation[]>(`${base()}/invitations`)
        : [];
    } catch {
      error.value = 'Не удалось загрузить участников. Попробуйте обновить страницу.';
    } finally {
      loading.value = false;
    }
  }

  async function invite(email: string, role: 'EDITOR' | 'VIEWER'): Promise<CreatedInvitation> {
    const created = await api.request<CreatedInvitation>(`${base()}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
    await load();
    return created;
  }

  async function resend(id: string): Promise<CreatedInvitation> {
    const created = await api.request<CreatedInvitation>(
      `${base()}/invitations/${encodeURIComponent(id)}/resend`,
      { method: 'POST' },
    );
    await load();
    return created;
  }

  async function revoke(id: string): Promise<void> {
    await api.request(`${base()}/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function changeRole(membershipId: string, role: 'EDITOR' | 'VIEWER'): Promise<void> {
    await api.request(`${base()}/members/${encodeURIComponent(membershipId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function removeMember(membershipId: string): Promise<void> {
    await api.request(`${base()}/members/${encodeURIComponent(membershipId)}`, {
      method: 'DELETE',
    });
    await load();
  }

  async function leave(): Promise<void> {
    await api.request(`${base()}/leave`, { method: 'POST' });
    await auth.loadMe();
    await navigateTo('/app');
  }

  return { members, invitations, loading, error, load, invite, resend, revoke, changeRole, removeMember, leave };
}
```

- [ ] **Step 4: Компоненты и страница**

- `FamilyProfileNameCard.vue` — `UiCard` с `UiInput` «Ваше имя» (`name="displayName"`, `maxlength=120`, ошибка у поля) и `UiButton` «Сохранить» → `useAuth().updateProfile`.
- `FamilyMembersCard.vue` — props `members: Member[]`, `canManage: boolean`; emits `changeRole(membershipId, role)`, `remove(member)`. Строка: аватар-инициалы (первая буква `displayName ?? email`, `aria-hidden`), имя, email второй строкой, роль текстом (`ROLE_LABELS` на клиенте: «Создатель», «Участник», «Наблюдатель»). `UiActionMenu` (`:label="`Действия: ${name}`"`, `useId()` для `list-id`) только при `canManage && !member.isCreator`.
- `FamilyInvitationsCard.vue` — props `invitations`, emits `resend(id)`, `revoke(id)`. Строка: email, роль, «действует до {дата ru-RU}» или «истекло», `UiActionMenu` с «Отправить повторно», «Отозвать». Пустое состояние — «Приглашений нет».
- `FamilyInviteDialog.vue` — `UiModal` (`size` по умолчанию, `title="Пригласить в семью"`), поле email (`type="email"`, `autocomplete="email"`), `UiButtonGroup` `label="Роль"` с вариантами `EDITOR` «Участник» / `VIEWER` «Наблюдатель», пояснение: «Участник записывает операции и распределяет деньги. Наблюдатель только смотрит.». Состояние «отправлено»: `UiStatus tone="success"` «Письмо отправлено на {email}», readonly `UiInput` со ссылкой, `UiButton` «Копировать» (`navigator.clipboard.writeText`, затем текст кнопки «Скопировано»), подпись «Ссылка показывается один раз. Её можно отправить в мессенджер.». Ошибки API с кодами `INVITATION_ALREADY_PENDING`, `ALREADY_MEMBER`, `MEMBER_LIMIT_REACHED`, `INVITATION_LIMIT_REACHED`, `VALIDATION_FAILED` — у поля email (`detail` из ответа). Тот же диалог в режиме «повтор» открывается из `resend` с готовой ссылкой.
- `pages/app/settings/family.vue` — `ReferencePageLayout` с заголовком «Семья», `definePageMeta({ middleware: 'auth' })` как у соседних страниц настроек; `useFamily(computed(() => workspace.value?.id))`; основная кнопка «Пригласить» (`UiButton`, ref для возврата фокуса) только у создателя; у `EDITOR`/`VIEWER` — `UiButton variant="secondary"` «Выйти из семьи» с `UiConfirmDialog` («Вы потеряете доступ к бюджету семьи. Ваши операции останутся в истории.»).
- `settings/index.vue` — новая карточка «Семья» перед «Аккаунт»: строка-ссылка `NuxtLink to="/app/settings/family"` «Участники и приглашения» / «Управлять →».

- [ ] **Step 5: Тесты проходят**

Run: команда Step 2 + `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings` + `pnpm typecheck` + `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): страница «Семья» и приглашение участников"
```

---

### Task 13: Страница `/invite`, регистрация и вход по приглашению

**Files:**
- Create: `apps/web/app/composables/useInvitation.ts`, `useInvitation.test.ts`
- Create: `apps/web/app/pages/invite.vue`, `invite.test.ts`
- Modify: `apps/web/app/composables/useApiClient.ts` (CSRF-исключение `/api/v1/invitations/preview`), `useApiClient.test.ts`
- Modify: `apps/web/app/composables/useAuth.ts` (`register` принимает `invitationToken`)
- Modify: `apps/web/app/pages/register.vue`, `register.test.ts`, `apps/web/app/pages/login.vue` (+ тест, если есть)
- Modify: страница уведомлений / маппинг типов уведомлений (иконка и подпись для `MEMBER_JOINED`, `MEMBER_LEFT`, `MEMBER_REMOVED`; `grep -rn "PLAN_OVERDUE" apps/web/app`)

**Interfaces:**
- Produces:
  - `useInvitation()`: `readTokenFromHash(hash: string): string | null`, `preview(token): Promise<InvitationPreview>`, `accept(token, displayName?): Promise<{ workspaceId: string; budgetId: string }>`
  - `InvitationPreview = { workspaceName: string; inviterName: string; role: 'EDITOR' | 'VIEWER'; maskedEmail: string; expiresAt: string }`
  - токен между страницами передаётся через `sessionStorage['harmofin-invite-token']` (не `localStorage`, не URL-параметр); удаляется после принятия или ошибки «истекло/отозвано/принято»

- [ ] **Step 1: Падающие тесты**

`useInvitation.test.ts`: `readTokenFromHash('#token=abc-DEF_1')` → `'abc-DEF_1'`; пустой или чужой хеш → `null`; `preview` шлёт `POST /api/v1/invitations/preview` с токеном в теле и без CSRF.

`invite.test.ts` — состояния страницы:
- загрузка → «Проверяем приглашение…»;
- не вошёл: «Ильдар приглашает вас в семью „Сираевы“ как участника», кнопки «Создать аккаунт» (`/register?invite=1`) и «Войти» (`/login?invite=1`);
- вошёл, без имени: поле «Ваше имя» и «Принять»; вошёл с именем: только «Принять»; после принятия — `selectWorkspace` не нужен (сервер уже выбрал), `loadMe()` и переход на `/app`;
- `INVITATION_EXPIRED` → «Приглашение истекло — попросите отправить новое»; `INVITATION_REVOKED` → «Приглашение отозвано»; `INVITATION_EMAIL_MISMATCH` → «Приглашение отправлено на {maskedEmail}. Войдите под этим адресом.» + кнопка «Выйти»; `ALREADY_MEMBER` → «Вы уже в этой семье» + ссылка на `/app`; `INVITATION_NOT_FOUND` → «Ссылка недействительна»;
- после чтения токена хеш удаляется из адресной строки (`history.replaceState`).

`register.test.ts`: при `?invite=1` и токене в `sessionStorage` — поле email заблокировано не нужно (email не знаем целиком), но отправка включает `invitationToken`; поля названий бюджета скрыты; после успешной регистрации — переход на `/invite` для ввода имени. `useApiClient.test.ts`: `/api/v1/invitations/preview` без CSRF.

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useInvitation.test.ts app/pages/invite.test.ts app/pages/register.test.ts app/composables/useApiClient.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

```ts
// apps/web/app/composables/useInvitation.ts
import { useApiClient } from './useApiClient.js';

export type InvitationPreview = {
  workspaceName: string;
  inviterName: string;
  role: 'EDITOR' | 'VIEWER';
  maskedEmail: string;
  expiresAt: string;
};

export const INVITE_TOKEN_KEY = 'harmofin-invite-token';

export function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]{16,128}$/.test(token) ? token : null;
}

export function useInvitation() {
  const api = useApiClient();
  return {
    readTokenFromHash,
    preview: (token: string) =>
      api.request<InvitationPreview>('/api/v1/invitations/preview', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    accept: (token: string, displayName?: string) =>
      api.request<{ workspaceId: string; budgetId: string }>('/api/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify(displayName ? { token, displayName } : { token }),
      }),
  };
}
```

`useApiClient.requiresCsrf`: добавить `path !== '/api/v1/invitations/preview'`.

`pages/invite.vue` — публичная страница (без `middleware: 'auth'`); в `onMounted`: токен из `location.hash` → `sessionStorage`, `history.replaceState(null, '', '/invite')`; если хеша нет — токен из `sessionStorage`. Затем `preview`; параллельно `useAuth().loadMe()` в `try/catch` для определения, вошёл ли пользователь (ошибка = не вошёл). Разметка — `UiCard` по центру, как на `login.vue`. Роль в тексте: `EDITOR` → «участника», `VIEWER` → «наблюдателя». Ошибки — `role="alert"`.

`login.vue`: при `?invite=1` после успешного входа — `navigateTo('/invite')` вместо `/app`. `register.vue`: при `?invite=1` и токене в `sessionStorage` — скрыть поля названий, передать `invitationToken`; после успеха удалить токен из `sessionStorage` (приглашение уже принято сервером в транзакции регистрации) и перейти на `/invite?welcome=1`. Состояние `welcome` страницы `/invite`: заголовок «Вы в семье „{workspace.name}“», поле «Как вас зовут?» и кнопка «Продолжить» → `useAuth().updateProfile(name)` → `/app`. Добавить этот кейс в `invite.test.ts`. Ошибку `INVITATION_EMAIL_MISMATCH` при регистрации показать у поля email: «Приглашение отправлено на другой адрес».

Уведомления: подписи/иконки для трёх новых типов (`UserPlus`, `UserMinus`, `UserX` из `@lucide/vue`, `aria-hidden`).

- [ ] **Step 4: Тесты проходят**

Run: команда Step 2 + `pnpm --filter @harmofin/web exec vitest run` + `pnpm typecheck` + `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): принятие приглашения по ссылке"
```

---

### Task 14: Автор в журнале (web)

**Files:**
- Modify: тип `TransactionJournalV2Item` и тип элемента перевода на вебе (найти: `grep -rn "type TransactionJournalV2Item\|interface TransactionJournalV2Item" apps/web/app`)
- Modify: `apps/web/app/components/operations/OperationRow.vue`, `TransferRow.vue`, `OperationDialog.vue`, `TransferDialog.vue`, `OperationsToolbar.vue`, `apps/web/app/composables/useOperationFilters.ts`, `apps/web/app/pages/app/operations.vue` + соответствующие `*.test.ts`

**Interfaces:**
- Consumes: `createdBy: { userId: string; displayName: string | null; isActiveMember: boolean }` из API задачи 8; `useFamily().members` (или список участников, загружаемый страницей операций).
- Produces: `authorLabel(createdBy): string` в `apps/web/app/components/operations/author-label.ts` — `displayName ?? 'Участник'`, плюс « (вышел)» при `!isActiveMember`; фильтр `createdByUserId` в `OperationFilters`.

- [ ] **Step 1: Падающие тесты**

```ts
// apps/web/app/components/operations/author-label.test.ts
import { describe, expect, it } from 'vitest';

import { authorLabel } from './author-label.js';

describe('authorLabel', () => {
  it('shows the display name', () => {
    expect(authorLabel({ userId: 'u', displayName: 'Алия', isActiveMember: true })).toBe('Алия');
  });
  it('marks a former member with gender-neutral text', () => {
    expect(authorLabel({ userId: 'u', displayName: 'Алия', isActiveMember: false })).toBe('Алия (не в семье)');
  });
  it('falls back when the name is empty', () => {
    expect(authorLabel({ userId: 'u', displayName: null, isActiveMember: true })).toBe('Участник');
  });
});
```

Род пользователя неизвестен, поэтому все подписи нейтральные: «(не в семье)», «Автор: …».

`OperationRow.test.ts`/`TransferRow.test.ts`: при `showAuthor=true` в метаданных строки есть текст автора; при `false` — нет. `OperationDialog.test.ts`: строка «Автор: Алия». `OperationsToolbar.test.ts`: чип «Автор» с вариантами участников, скрыт при одном участнике. `operations.test.ts`: выбор автора добавляет `createdByUserId` в запрос журнала.

- [ ] **Step 2: Запустить — падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/operations app/pages/app/operations.test.ts app/composables/useOperationFilters.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

```ts
// apps/web/app/components/operations/author-label.ts
export type AuthorRef = { userId: string; displayName: string | null; isActiveMember: boolean };

export function authorLabel(author: AuthorRef): string {
  const name = author.displayName ?? 'Участник';
  return author.isActiveMember ? name : `${name} (не в семье)`;
}
```

- `OperationRow.vue`/`TransferRow.vue`: новый prop `showAuthor: boolean`; в строке метаданных (рядом со счётом) — `<span class="operation-row__author">{{ authorLabel(transaction.createdBy) }}</span>`, цвет `--hf-color-text-muted`, без иконки.
- `OperationDialog.vue`/`TransferDialog.vue`: строка «Автор» в блоке деталей.
- `operations.vue`: загрузить участников (`GET members` через `useFamily`) один раз; `showAuthor = members.length > 1`; список вариантов для чипа — `{ value: userId, label: displayName ?? email }`.
- `useOperationFilters.ts`: ключ `createdByUserId` (сериализация в query страницы — как у `accountId`).
- `OperationsToolbar.vue`: чип `{ key: 'createdByUserId', label: 'Автор', options: props.authors }`; при пустом `authors` чип скрыт (FilterBar уже скрывает чип без вариантов — передавать `[]` при одном участнике).

- [ ] **Step 4: Тесты проходят**

Run: команда Step 2 + `pnpm --filter @harmofin/web exec vitest run` + `pnpm typecheck` + `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): автор операции в журнале и фильтр по автору"
```

---

### Task 15: E2E-сценарий, документация, финальная проверка

**Files:**
- Create: `e2e/family-access.spec.ts`
- Modify: `apps/web/app/pages/app/help.vue` (раздел «Семья», если в справке есть разделы по функциям — проверить содержимое)
- Modify: `README.md` — только если в нём перечислены функции продукта (новых команд нет)

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: E2E-спека (выполняется в CI, локально не запускать)**

Сценарий по образцу `e2e/auth.spec.ts` и `e2e/account-deletion.spec.ts` (взять оттуда хелперы регистрации, согласий и `env.ts`):

```ts
// e2e/family-access.spec.ts
import { expect, test } from '@playwright/test';

test('creator invites a family member who records an expense', async ({ browser }) => {
  const creator = await browser.newContext();
  const creatorPage = await creator.newPage();
  // 1. Register the creator (helper from auth.spec.ts), set name on /app/settings/family.
  // 2. Click «Пригласить», fill a unique email, keep role «Участник», submit.
  // 3. Read the link from the readonly field in the dialog.
  const inviteUrl = await creatorPage.getByLabel('Ссылка-приглашение').inputValue();

  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await memberPage.goto(inviteUrl);
  await expect(memberPage.getByText(/приглашает вас в семью/)).toBeVisible();
  await memberPage.getByRole('link', { name: 'Создать аккаунт' }).click();
  // 4. Register with the invited email, accept consents, enter name «Алия», click «Принять».
  await expect(memberPage).toHaveURL(/\/app$/);
  // 5. Add an expense through the quick entry dialog.

  await creatorPage.goto('/app/operations');
  await expect(creatorPage.getByText('Алия')).toBeVisible();
  await creator.close();
  await member.close();
});
```

Комментарии-шаги заменить реальными вызовами хелперов из существующих спек (названия хелперов взять оттуда; не изобретать новые API). Поле со ссылкой в `FamilyInviteDialog` должно иметь доступное имя «Ссылка-приглашение».

- [ ] **Step 2: Полная проверка**

Run по очереди:
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm build`

Expected: всё зелёное. Упавшую несвязанную проверку — зафиксировать в отчёте, не чинить без отдельной задачи.

- [ ] **Step 3: Просмотр диффа**

Run: `git diff origin/main...HEAD --stat` и выборочно `git diff origin/main...HEAD -- apps/api/src/family prisma`
Проверить: нет токенов в логах и audit; каждый запрос семьи фильтрует `workspaceId`; нет `workspaces[0]` в вебе; `identity/logo_description.png` не тронут.

- [ ] **Step 4: Commit**

```bash
git add e2e/family-access.spec.ts apps/web/app/pages/app/help.vue
git commit -m "test(e2e): приглашение участника семьи"
```

## Review по задачам

| Задачи | Обязательные review |
|---|---|
| 1 | backend (миграция), security, QA, final |
| 2–6 | API, security, backend, QA, final |
| 7 | backend, security, QA, final |
| 8 | API, security, QA, final |
| 9 | backend, security, QA, final |
| 10–14 | UI/UX, security (10, 13), QA, final |
| 15 | QA, final |

Финансовые расчёты на этапе A не меняются, financial review не требуется. Если writer при реализации затрагивает финансовые сервисы (кроме чтения автора), задача получает financial review.
