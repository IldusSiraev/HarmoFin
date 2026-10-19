# Юридические документы и согласие на обработку ПД — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Опубликовать политику обработки ПД, пользовательское соглашение и отдельное согласие на обработку ПД, фиксировать согласие на сервере и не пускать в приложение без согласия на текущие редакции.

**Architecture:** API — модуль `apps/api/src/legal/` (константа текущих версий, чистые функции проверки, `GET /legal/documents`, `POST /me/consents`), необязательное поле `consents` в регистрации и `pendingConsents` в `/me`; таблица `user_consents`. Worker — очистка аккаунта удаляет согласия. Web — страницы `/privacy`, `/terms`, `/consent` с реквизитами оператора из runtime-конфига, галочки на регистрации, экран `/accept-terms` и редирект в auth-middleware, ссылки и карточки на лендинге.

**Tech Stack:** NestJS/Fastify, Prisma 6.19, PostgreSQL 18, Zod, Vitest, Nuxt 4/Vue 3.5, `@vue/test-utils`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-18-legal-documents-design.md](../specs/2026-10-18-legal-documents-design.md)

## Global Constraints

- Изменения `/api/v1` только аддитивные; `consents` в регистрации необязательное.
- Типы документов: `TERMS`, `PRIVACY_POLICY`, `PD_CONSENT`. Текущая версия всех трёх: `2026-10-18`, дата вступления в силу `2026-10-18`.
- Ошибка несовпадения версий: `422 LEGAL_CONSENT_VERSION_MISMATCH`, текст «Документы обновились. Обновите страницу и примите актуальные редакции.».
- Записи `user_consents` не изменяются; повторное принятие идемпотентно.
- Реквизиты оператора — только из `NUXT_PUBLIC_LEGAL_*`, в production обязательны.
- Резервные копии — не более 30 дней; окно удаления аккаунта — 30 дней.
- Галочки согласия по умолчанию не отмечены; согласие на обработку ПД — отдельная галочка, не объединённая с соглашением.
- Тексты на русском; идентификаторы в коде на английском.
- Local Playwright не запускать. Перед каждым коммитом проверять `git branch --show-current` = `feat/legal-documents`.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261018000200_user_consents/migration.sql` | enum и таблица |
| `apps/worker/src/account-purge.ts` (+ coverage test, integration test) | удаление согласий при очистке |
| `apps/api/src/legal/legal-documents.ts` (+ test) | текущие версии, проверка набора согласий, расчёт pending |
| `apps/api/src/legal/legal.schemas.ts`, `legal.dto.ts` | Zod и OpenAPI |
| `apps/api/src/legal/legal-consent.repository.ts` | запись и чтение согласий |
| `apps/api/src/legal/legal-consent.application.service.ts` (+ test) | правила `POST /me/consents` |
| `apps/api/src/legal/legal.controller.ts`, `legal.module.ts` | HTTP и DI |
| `apps/api/src/auth/*` | `consents` в регистрации, `pendingConsents` в `/me` |
| `apps/api/test/legal.integration.test.ts` | реальная БД |
| `openapi.json` | контракт |
| `apps/web/config/env.ts`, `apps/web/nuxt.config.ts` | `runtimeConfig.public.legal` |
| `apps/web/app/composables/useLegal.ts` (+ test) | реквизиты, версии документов, валидность |
| `apps/web/app/components/legal/*` | тексты документов и оболочка страницы |
| `apps/web/app/pages/privacy.vue`, `terms.vue`, `consent.vue` (+ tests) | публичные страницы |
| `apps/web/app/components/legal/legal-texts.test.ts` | хеши текстов |
| `apps/web/app/components/auth/ConsentCheckboxes.vue` (+ test) | две галочки |
| `apps/web/app/pages/register.vue`, `accept-terms.vue`, `middleware/auth.ts`, `composables/useAuth.ts` (+ tests) | регистрация и барьер |
| `apps/web/app/components/landing/LandingFooter.vue`, `apps/web/app/data/landing.ts` (+ tests) | лендинг |
| `e2e/*.spec.ts`, `e2e/legal-consent.spec.ts` | CI-сценарии |
| `infra/compose/production.yml`, `.env.example`, `infra/env/*.example` | переменные реквизитов |
| `docs/runbooks/public-launch-legal.md`, `docs/runbooks/account-data-request.md`, функциональная спека | документация |

---

### Task 1: Таблица `user_consents` и её очистка

**Files:**
- Modify: `prisma/schema.prisma` (новый enum после `enum NotificationType`, модель после `model AccountDeletion`, relation в `model User`)
- Create: `prisma/migrations/20261018000200_user_consents/migration.sql`
- Modify: `apps/worker/src/account-purge.ts:41-42` и блок user-level deletes (~строка 132)
- Test: `apps/worker/src/account-purge.coverage.test.ts` (без изменений — должен оставаться зелёным), `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Produces: Prisma `prisma.userConsent` (`id, userId, document: LegalDocumentType, version, acceptedAt`), enum `LegalDocumentType { TERMS, PRIVACY_POLICY, PD_CONSENT }`; `USER_OWNED_TABLES` включает `'user_consents'`.

- [ ] **Step 1: Prisma-схема**

После `enum NotificationType { ... }`:

```prisma
enum LegalDocumentType {
  TERMS
  PRIVACY_POLICY
  PD_CONSENT
}
```

В `model User` после `notifications        Notification[]`:

```prisma
  consents             UserConsent[]
```

После `model AccountDeletion { ... }`:

```prisma
// Append-only proof of consent (152-FZ art. 9 part 3): a new document version adds rows, never edits them.
model UserConsent {
  id         String            @id @db.Uuid
  userId     String            @map("user_id") @db.Uuid
  document   LegalDocumentType
  version    String            @db.VarChar(32)
  acceptedAt DateTime          @map("accepted_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([userId, document, version])
  @@map("user_consents")
}
```

- [ ] **Step 2: Миграция `prisma/migrations/20261018000200_user_consents/migration.sql`**

```sql
-- Additive only: consent proof for legal documents.
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY_POLICY', 'PD_CONSENT');

CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document" "LegalDocumentType" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_consents_user_id_document_version_key" ON "user_consents"("user_id", "document", "version");

ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Применить и проверить совпадение**

Run: `pnpm infra:up && pnpm db:migrate && pnpm db:generate`
Run: `pnpm --filter @harmofin/api exec prisma migrate diff --from-schema-datasource ../../prisma/schema.prisma --to-schema-datamodel ../../prisma/schema.prisma --exit-code`
Expected: `No difference detected.`

- [ ] **Step 4: Падающий coverage-тест**

Run: `pnpm --filter @harmofin/worker exec vitest run src/account-purge.coverage.test.ts`
Expected: FAIL в «classifies every model with a relation to User» с `UserConsent -> user_consents`.

- [ ] **Step 5: Очистка удаляет согласия**

В `apps/worker/src/account-purge.ts`:

```ts
/** Deleted directly by the user's own id (their own sessions/tokens/memberships/consents). */
export const USER_OWNED_TABLES = [
  'sessions',
  'recovery_tokens',
  'workspace_memberships',
  'user_consents',
] as const;
```

После `DELETE FROM "workspace_memberships" WHERE "user_id" = ...`:

```ts
  await tx.$executeRaw`DELETE FROM "user_consents" WHERE "user_id" = ${userId}::uuid`;
```

Run: `pnpm --filter @harmofin/worker exec vitest run && pnpm --filter @harmofin/worker typecheck`
Expected: PASS.

- [ ] **Step 6: Integration-проверка очистки**

В `apps/api/test/account-deletion.integration.test.ts`, в тесте `purges every row of the owned scope and anonymizes the user, leaving others intact`, перед `requestDeletion(target, …)` добавить:

```ts
    await prisma.userConsent.create({
      data: {
        id: randomUUID(),
        userId: target.userId,
        document: 'PD_CONSENT',
        version: '2026-10-18',
        acceptedAt: new Date(),
      },
    });
```

После `execute`:

```ts
    expect(await prisma.userConsent.count({ where: { userId: target.userId } })).toBe(0);
```

В `afterAll` перед удалением строки `users` для каждого пользователя:

```ts
      await prisma.userConsent.deleteMany({ where: { userId } });
```

Run: `pnpm --filter @harmofin/api exec node --env-file-if-exists=../../.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/account-deletion.integration.test.ts`
Expected: 11 passed.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261018000200_user_consents apps/worker/src/account-purge.ts apps/api/test/account-deletion.integration.test.ts
git commit -m "feat(db): таблица user_consents и её очистка при удалении аккаунта"
```

---

### Task 2: API согласий

**Files:**
- Create: `apps/api/src/legal/legal-documents.ts`, `legal-documents.test.ts`
- Create: `apps/api/src/legal/legal.schemas.ts`, `legal.dto.ts`
- Create: `apps/api/src/legal/legal-consent.repository.ts`
- Create: `apps/api/src/legal/legal-consent.application.service.ts`, `legal-consent.application.service.test.ts`
- Create: `apps/api/src/legal/legal.controller.ts`, `legal.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/auth/auth.schemas.ts`, `auth.dto.ts`, `auth.application.service.ts` (`register`, `me`)
- Test: `apps/api/test/legal.integration.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: `prisma.userConsent`, `LegalDocumentType` (Task 1).
- Produces:
  - `CURRENT_LEGAL_DOCUMENTS: ReadonlyArray<{ document: LegalDocumentType; version: string; effectiveOn: string }>`
  - `assertCurrentConsents(consents: ConsentInput[]): void` — бросает `UnprocessableEntityException` `LEGAL_CONSENT_VERSION_MISMATCH`
  - `pendingConsents(accepted: ConsentInput[], current = CURRENT_LEGAL_DOCUMENTS): ConsentInput[]`
  - `type ConsentInput = { document: LegalDocumentType; version: string }`
  - HTTP: `GET /api/v1/legal/documents` → `200 LegalDocumentResponse[]`; `POST /api/v1/me/consents` → `204`; `POST /api/v1/auth/register` принимает `consents?: ConsentInput[]`; `GET /api/v1/me` возвращает `pendingConsents: ConsentInput[]`.

- [ ] **Step 1: Падающий тест чистых функций `apps/api/src/legal/legal-documents.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_DOCUMENTS,
  assertCurrentConsents,
  pendingConsents,
} from './legal-documents.js';

const current = CURRENT_LEGAL_DOCUMENTS.map(({ document, version }) => ({ document, version }));

describe('legal documents', () => {
  it('pins the current versions so a change is a deliberate, reviewed edit', () => {
    expect(CURRENT_LEGAL_DOCUMENTS).toEqual([
      { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
    ]);
  });

  it('accepts exactly the current set in any order', () => {
    expect(() => assertCurrentConsents([...current].reverse())).not.toThrow();
  });

  it.each([
    ['a missing document', current.slice(0, 2)],
    ['an outdated version', [{ document: 'TERMS', version: '2020-01-01' }, ...current.slice(1)]],
    ['a duplicate document', [current[0]!, current[0]!, current[1]!]],
    ['an extra entry', [...current, current[0]!]],
  ])('rejects %s', (_label, consents) => {
    expect(() => assertCurrentConsents(consents as never)).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'LEGAL_CONSENT_VERSION_MISMATCH' }),
      }),
    );
  });

  it('lists current documents without an accepted current version', () => {
    expect(pendingConsents([])).toEqual(current);
    expect(pendingConsents(current)).toEqual([]);
    expect(
      pendingConsents([
        { document: 'TERMS', version: '2020-01-01' },
        { document: 'PRIVACY_POLICY', version: '2026-10-18' },
        { document: 'PD_CONSENT', version: '2026-10-18' },
      ]),
    ).toEqual([{ document: 'TERMS', version: '2026-10-18' }]);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/legal`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: `apps/api/src/legal/legal-documents.ts`**

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import type { LegalDocumentType } from '@prisma/client';

export type ConsentInput = { document: LegalDocumentType; version: string };

/**
 * Single source of truth for the current legal document editions. Bump a version together with
 * the text in apps/web/app/components/legal and its hash (docs/runbooks/public-launch-legal.md).
 */
export const CURRENT_LEGAL_DOCUMENTS: ReadonlyArray<{
  document: LegalDocumentType;
  version: string;
  effectiveOn: string;
}> = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

/** The consent set must name every current document exactly once at its current version. */
export function assertCurrentConsents(consents: ConsentInput[]): void {
  const matches =
    consents.length === CURRENT_LEGAL_DOCUMENTS.length &&
    new Set(consents.map((consent) => consent.document)).size === consents.length &&
    CURRENT_LEGAL_DOCUMENTS.every((current) =>
      consents.some(
        (consent) => consent.document === current.document && consent.version === current.version,
      ),
    );
  if (!matches)
    throw new UnprocessableEntityException({
      code: 'LEGAL_CONSENT_VERSION_MISMATCH',
      detail: 'Документы обновились. Обновите страницу и примите актуальные редакции.',
    });
}

export function pendingConsents(
  accepted: ConsentInput[],
  current = CURRENT_LEGAL_DOCUMENTS,
): ConsentInput[] {
  return current
    .filter(
      (doc) =>
        !accepted.some((row) => row.document === doc.document && row.version === doc.version),
    )
    .map(({ document, version }) => ({ document, version }));
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/legal`
Expected: PASS.

- [ ] **Step 3: Схемы и DTO**

`apps/api/src/legal/legal.schemas.ts`:

```ts
import { z } from 'zod';

export const consentInputSchema = z
  .object({
    document: z.enum(['TERMS', 'PRIVACY_POLICY', 'PD_CONSENT']),
    version: z.string().min(1).max(32),
  })
  .strict();

export const consentListSchema = z.array(consentInputSchema).min(1).max(10);

export const acceptConsentsSchema = z.object({ consents: consentListSchema }).strict();

export type AcceptConsentsInput = z.output<typeof acceptConsentsSchema>;
```

`apps/api/src/legal/legal.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

const DOCUMENT_TYPES = ['TERMS', 'PRIVACY_POLICY', 'PD_CONSENT'];

export class ConsentItem {
  @ApiProperty({ type: String, enum: DOCUMENT_TYPES })
  document!: string;

  @ApiProperty({ type: String, example: '2026-10-18', maxLength: 32 })
  version!: string;
}

export class LegalDocumentResponse extends ConsentItem {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-18' })
  effectiveOn!: string;
}

export class AcceptConsentsRequest {
  @ApiProperty({ type: [ConsentItem] })
  consents!: ConsentItem[];
}
```

В `apps/api/src/auth/auth.schemas.ts` импорт `import { consentListSchema } from '../legal/legal.schemas.js';` и в `registerSchema` поле:

```ts
    consents: consentListSchema.optional(),
```

В `apps/api/src/auth/auth.dto.ts` импорт `import { ConsentItem } from '../legal/legal.dto.js';`; в `RegisterRequest`:

```ts
  @ApiPropertyOptional({
    type: [ConsentItem],
    description: 'Принятые редакции документов; без поля пользователь примет их после входа.',
  })
  consents?: ConsentItem[];
```

В `MeResponse`:

```ts
  @ApiProperty({
    type: [ConsentItem],
    description: 'Текущие документы, которые пользователь ещё не принял.',
  })
  pendingConsents!: ConsentItem[];
```

- [ ] **Step 4: Repository `apps/api/src/legal/legal-consent.repository.ts`**

```ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ConsentInput } from './legal-documents.js';

type Tx = Prisma.TransactionClient;

export class LegalConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  /** Idempotent: an already accepted version is skipped by the unique index. */
  async recordConsents(tx: Tx, userId: string, consents: ConsentInput[], now: Date): Promise<void> {
    await tx.userConsent.createMany({
      data: consents.map((consent) => ({
        id: createUuidV7(now),
        userId,
        document: consent.document,
        version: consent.version,
        acceptedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  findAccepted(tx: Tx, userId: string): Promise<ConsentInput[]> {
    return tx.userConsent.findMany({ where: { userId }, select: { document: true, version: true } });
  }

  async audit(tx: Tx, userId: string, consents: ConsentInput[], requestId?: string): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: 'auth',
        entityId: userId,
        action: 'LEGAL_CONSENT_ACCEPTED',
        newValues: { consents },
        source: 'API',
        requestId: requestId ?? null,
      },
    });
  }
}
```

- [ ] **Step 5: Падающий тест сервиса `apps/api/src/legal/legal-consent.application.service.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import { CURRENT_LEGAL_DOCUMENTS } from './legal-documents.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');
const current = CURRENT_LEGAL_DOCUMENTS.map(({ document, version }) => ({ document, version }));

function setup() {
  const tx = {};
  const repository = {
    transaction: vi.fn((callback: (t: unknown) => unknown) => callback(tx)),
    recordConsents: vi.fn().mockResolvedValue(undefined),
    findAccepted: vi.fn().mockResolvedValue([]),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  const service = new LegalConsentApplicationService(repository as never, () => NOW);
  return { service, repository, tx };
}

describe('LegalConsentApplicationService', () => {
  it('records the current set and audits it in one transaction', async () => {
    const { service, repository, tx } = setup();

    await service.accept('u1', { consents: current }, { requestId: 'r1' });

    expect(repository.recordConsents).toHaveBeenCalledWith(tx, 'u1', current, NOW);
    expect(repository.audit).toHaveBeenCalledWith(tx, 'u1', current, 'r1');
  });

  it('rejects an outdated set before touching the database', async () => {
    const { service, repository } = setup();

    await expect(
      service.accept('u1', { consents: [{ document: 'TERMS', version: '2020-01-01' }] }, {}),
    ).rejects.toMatchObject({ response: { code: 'LEGAL_CONSENT_VERSION_MISMATCH' } });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('lists the documents the user still has to accept', async () => {
    const { service, repository } = setup();
    repository.findAccepted.mockResolvedValue([{ document: 'TERMS', version: '2026-10-18' }]);

    await expect(service.pendingFor('u1')).resolves.toEqual(current.slice(1));
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/legal`
Expected: FAIL — сервис не найден.

- [ ] **Step 6: Сервис `apps/api/src/legal/legal-consent.application.service.ts`**

```ts
import {
  CURRENT_LEGAL_DOCUMENTS,
  assertCurrentConsents,
  pendingConsents,
  type ConsentInput,
} from './legal-documents.js';
import type { LegalConsentRepository } from './legal-consent.repository.js';
import type { AcceptConsentsInput } from './legal.schemas.js';

export class LegalConsentApplicationService {
  constructor(
    private readonly repository: LegalConsentRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  currentDocuments() {
    return CURRENT_LEGAL_DOCUMENTS.map((doc) => ({ ...doc }));
  }

  async accept(
    userId: string,
    input: AcceptConsentsInput,
    meta: { requestId?: string },
  ): Promise<void> {
    assertCurrentConsents(input.consents);
    const now = this.clock();
    await this.repository.transaction(async (tx) => {
      await this.repository.recordConsents(tx, userId, input.consents, now);
      await this.repository.audit(tx, userId, input.consents, meta.requestId);
    });
  }

  pendingFor(userId: string): Promise<ConsentInput[]> {
    return this.repository.transaction(async (tx) =>
      pendingConsents(await this.repository.findAccepted(tx, userId)),
    );
  }
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/legal`
Expected: PASS.

- [ ] **Step 7: Controller и module**

`apps/api/src/legal/legal.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';
import { AcceptConsentsRequest, LegalDocumentResponse } from './legal.dto.js';
import { acceptConsentsSchema, type AcceptConsentsInput } from './legal.schemas.js';

@ApiTags('legal')
@Controller()
export class LegalController {
  constructor(
    @Inject(LegalConsentApplicationService)
    private readonly service: LegalConsentApplicationService,
  ) {}

  @Get('legal/documents')
  @ApiOkResponse({ type: [LegalDocumentResponse] })
  documents(): LegalDocumentResponse[] {
    return this.service.currentDocuments();
  }

  @Post('me/consents')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiBody({ type: AcceptConsentsRequest })
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async accept(
    @Body(new ZodValidationPipe(acceptConsentsSchema)) input: AcceptConsentsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.accept(requiredContext(request).userId, input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
}
```

`apps/api/src/legal/legal.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';
import { LegalConsentRepository } from './legal-consent.repository.js';
import { LegalController } from './legal.controller.js';

@Module({})
export class LegalModule {
  static register(): DynamicModule {
    return {
      module: LegalModule,
      controllers: [LegalController],
      providers: [
        {
          provide: LegalConsentApplicationService,
          useFactory: (prisma: PrismaService) =>
            new LegalConsentApplicationService(new LegalConsentRepository(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

`apps/api/src/app.module.ts`: импорт `import { LegalModule } from './legal/legal.module.js';` и `LegalModule.register(),` сразу после `AccountDeletionModule.register(config),`.

- [ ] **Step 8: Регистрация и `/me` в `auth.application.service.ts`**

Импорт:

```ts
import { assertCurrentConsents, pendingConsents } from '../legal/legal-documents.js';
```

В `register`, первой строкой метода:

```ts
    if (input.consents) assertCurrentConsents(input.consents);
```

В транзакции `register` после `tx.auditEvent.create({ … action: 'REGISTERED' … })`:

```ts
      if (input.consents) {
        await tx.userConsent.createMany({
          data: input.consents.map((consent) => ({
            id: createUuidV7(now),
            userId: user.id,
            document: consent.document,
            version: consent.version,
            acceptedAt: now,
          })),
        });
      }
```

В `me()` расширить тип возврата полем `pendingConsents: Array<{ document: LegalDocumentType; version: string }>` (импорт типа `LegalDocumentType` из `@prisma/client`) и заменить тело транзакции:

```ts
    const { memberships, accepted } = await this.repository.transaction(async (tx) => ({
      memberships: await tx.workspaceMembership.findMany({
        where: { userId, isActive: true, workspace: { status: 'ACTIVE' } },
        select: {
          role: true,
          workspace: {
            select: {
              id: true,
              name: true,
              budgets: {
                where: { status: 'ACTIVE' },
                select: { id: true, name: true, primaryCurrency: true, planModelVersion: true },
              },
            },
          },
        },
      }),
      accepted: await tx.userConsent.findMany({
        where: { userId },
        select: { document: true, version: true },
      }),
    }));
    return {
      user,
      workspaces: memberships.map(({ role, workspace }) => ({ ...workspace, role })),
      pendingConsents: pendingConsents(accepted),
    };
```

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api exec vitest run src/auth src/legal`
Expected: PASS (если существующие unit-тесты `me` сверяют форму ответа — добавить в ожидание `pendingConsents`).

- [ ] **Step 9: Интеграционный тест `apps/api/test/legal.integration.test.ts`**

```ts
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { purgeUserData } from '../../worker/src/account-purge.js';
import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const current = [
  { document: 'TERMS', version: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18' },
];

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUserIds: string[] = [];

type Session = { userId: string; cookie: string; csrfToken: string };

async function register(consents?: unknown): Promise<{ status: number; session?: Session }> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      email: `legal-${randomUUID()}@harmofin.test`,
      password,
      ...(consents ? { consents } : {}),
    },
  });
  if (response.statusCode !== 201) return { status: response.statusCode };
  const body = response.json<{ user: { id: string }; csrfToken: string }>();
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const cookie = decodeURIComponent(/harmofin_session=([^;]+)/.exec(setCookie)?.[1] ?? '');
  createdUserIds.push(body.user.id);
  return { status: 201, session: { userId: body.user.id, cookie, csrfToken: body.csrfToken } };
}

function me(session: Session) {
  return server.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: `harmofin_session=${encodeURIComponent(session.cookie)}` },
  });
}

function accept(session: Session, consents: unknown, withCsrf = true) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/me/consents',
    headers: {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(session.cookie)}`,
      ...(withCsrf ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    payload: { consents },
  });
}

describe('legal consents', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await prisma.$transaction((tx) => purgeUserData(tx, userId), { timeout: 60_000 });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the legal endpoints and new fields in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }>();
    expect(document.paths['/api/v1/legal/documents']).toMatchObject({ get: expect.any(Object) });
    expect(document.paths['/api/v1/me/consents']).toMatchObject({ post: expect.any(Object) });
    expect(document.components.schemas.RegisterRequest?.properties).toHaveProperty('consents');
    expect(document.components.schemas.MeResponse?.properties).toHaveProperty('pendingConsents');
  });

  it('serves the current document versions without a session', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/legal/documents' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(current.map((doc) => ({ ...doc, effectiveOn: '2026-10-18' })));
  });

  it('records consents given at registration in the same transaction', async () => {
    const { status, session } = await register(current);
    expect(status).toBe(201);
    expect(await prisma.userConsent.count({ where: { userId: session!.userId } })).toBe(3);
    expect((await me(session!)).json()).toMatchObject({ pendingConsents: [] });
  });

  it('rejects an outdated consent set at registration and creates no user', async () => {
    const before = await prisma.user.count();
    const { status } = await register([{ document: 'TERMS', version: '2020-01-01' }]);
    expect(status).toBe(422);
    expect(await prisma.user.count()).toBe(before);
  });

  it('lets a user without consents accept them later, idempotently', async () => {
    const { session } = await register();
    expect((await me(session!)).json<{ pendingConsents: unknown[] }>().pendingConsents).toEqual(
      current,
    );

    expect((await accept(session!, current, false)).statusCode).toBe(403);
    expect((await accept(session!, [current[0]])).statusCode).toBe(422);
    expect((await accept(session!, current)).statusCode).toBe(204);
    expect((await accept(session!, current)).statusCode).toBe(204);

    expect(await prisma.userConsent.count({ where: { userId: session!.userId } })).toBe(3);
    expect((await me(session!)).json()).toMatchObject({ pendingConsents: [] });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: session!.userId, action: 'LEGAL_CONSENT_ACCEPTED' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('@');
  });

  it('keeps one user consents invisible to another', async () => {
    const { session: first } = await register(current);
    const { session: second } = await register();
    expect((await me(second!)).json<{ pendingConsents: unknown[] }>().pendingConsents).toHaveLength(3);
    expect((await me(first!)).json()).toMatchObject({ pendingConsents: [] });
  });
});
```

Run: `pnpm --filter @harmofin/api exec node --env-file-if-exists=../../.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/legal.integration.test.ts test/auth.integration.test.ts`
Expected: PASS.

- [ ] **Step 10: OpenAPI**

Run: `pnpm --filter @harmofin/api build && node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && node scripts/openapi/check.mjs`
Expected: только добавления в `git diff --stat openapi.json`; проверка breaking changes без ошибок.

- [ ] **Step 11: Проверки и коммит**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint && pnpm --filter @harmofin/api exec vitest run`

```bash
git add apps/api/src/legal apps/api/src/app.module.ts apps/api/src/auth apps/api/test/legal.integration.test.ts openapi.json
git commit -m "feat(api): версии юридических документов и фиксация согласия"
```

---

### Task 3: Страницы документов и реквизиты оператора

**Files:**
- Modify: `apps/web/nuxt.config.ts` (`runtimeConfig.public`)
- Create: `apps/web/app/composables/useLegal.ts`, `useLegal.test.ts`
- Create: `apps/web/app/components/legal/LegalDocumentPage.vue`
- Create: `apps/web/app/components/legal/PrivacyPolicyText.vue`, `TermsText.vue`, `PdConsentText.vue`
- Create: `apps/web/app/components/legal/legal-texts.test.ts`
- Create: `apps/web/app/pages/privacy.vue`, `terms.vue`, `consent.vue`, `legal-pages.test.ts`
- Modify: `infra/compose/production.yml` (сервис `web`, блок `environment`), `.env.example`, `infra/env/staging.example`

**Interfaces:**
- Consumes: `GET /api/v1/legal/documents` (Task 2).
- Produces:
  - `useLegal(): { operator: ComputedRef<LegalOperator>; operatorComplete: ComputedRef<boolean>; loadDocuments(): Promise<LegalDocument[]> }`
  - `type LegalOperator = { name: string; inn: string; email: string; hostingProvider: string; emailProvider: string }`
  - `type LegalDocument = { document: 'TERMS' | 'PRIVACY_POLICY' | 'PD_CONSENT'; version: string; effectiveOn: string }`
  - Компонент `LegalDocumentPage` (props `title: string`, `document: LegalDocument['document']`; default slot `{ operator }`).
  - Маршруты `/privacy`, `/terms`, `/consent`.

- [ ] **Step 1: Runtime-конфиг**

В `apps/web/nuxt.config.ts`:

```ts
  runtimeConfig: {
    public: {
      apiUrl: config.apiUrl,
      // Filled at runtime from NUXT_PUBLIC_LEGAL_*; required in production compose.
      legal: {
        operatorName: '',
        operatorInn: '',
        operatorEmail: '',
        hostingProvider: '',
        emailProvider: '',
      },
    },
  },
```

В `infra/compose/production.yml`, сервис `web`, `environment:` после `NUXT_PUBLIC_API_URL`:

```yaml
      NUXT_PUBLIC_LEGAL_OPERATOR_NAME: ${NUXT_PUBLIC_LEGAL_OPERATOR_NAME:?NUXT_PUBLIC_LEGAL_OPERATOR_NAME is required}
      NUXT_PUBLIC_LEGAL_OPERATOR_INN: ${NUXT_PUBLIC_LEGAL_OPERATOR_INN:?NUXT_PUBLIC_LEGAL_OPERATOR_INN is required}
      NUXT_PUBLIC_LEGAL_OPERATOR_EMAIL: ${NUXT_PUBLIC_LEGAL_OPERATOR_EMAIL:?NUXT_PUBLIC_LEGAL_OPERATOR_EMAIL is required}
      NUXT_PUBLIC_LEGAL_HOSTING_PROVIDER: ${NUXT_PUBLIC_LEGAL_HOSTING_PROVIDER:?NUXT_PUBLIC_LEGAL_HOSTING_PROVIDER is required}
      NUXT_PUBLIC_LEGAL_EMAIL_PROVIDER: ${NUXT_PUBLIC_LEGAL_EMAIL_PROVIDER:?NUXT_PUBLIC_LEGAL_EMAIL_PROVIDER is required}
```

В `.env.example` и `infra/env/staging.example` добавить блок:

```bash
# Реквизиты оператора ПД для /privacy, /terms, /consent. В production обязательны.
NUXT_PUBLIC_LEGAL_OPERATOR_NAME=
NUXT_PUBLIC_LEGAL_OPERATOR_INN=
NUXT_PUBLIC_LEGAL_OPERATOR_EMAIL=
NUXT_PUBLIC_LEGAL_HOSTING_PROVIDER=
NUXT_PUBLIC_LEGAL_EMAIL_PROVIDER=
```

Если `infra/scripts/workflow.production.test.mjs` или smoke-тесты сверяют список обязательных переменных — добавить новые туда же и прогнать `node --test infra/scripts/workflow.production.test.mjs`.

- [ ] **Step 2: Падающий тест `apps/web/app/composables/useLegal.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  legal: {
    operatorName: 'Иванов Иван Иванович',
    operatorInn: '123456789012',
    operatorEmail: 'privacy@harmofin.example',
    hostingProvider: 'Хостинг',
    emailProvider: 'Почта',
  },
}));
const request = vi.hoisted(() => vi.fn());

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: runtime }) }));
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useLegal } from './useLegal.js';

describe('useLegal', () => {
  it('exposes the operator and treats a 12-digit INN with all fields as complete', () => {
    const { operator, operatorComplete } = useLegal();
    expect(operator.value.name).toBe('Иванов Иван Иванович');
    expect(operatorComplete.value).toBe(true);
  });

  it('flags missing or malformed requisites', () => {
    runtime.legal.operatorInn = '1234';
    expect(useLegal().operatorComplete.value).toBe(false);
    runtime.legal.operatorInn = '123456789012';
    runtime.legal.operatorEmail = '';
    expect(useLegal().operatorComplete.value).toBe(false);
  });

  it('loads current document versions from the API', async () => {
    request.mockResolvedValue([{ document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' }]);
    await expect(useLegal().loadDocuments()).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/api/v1/legal/documents');
  });
});
```

Если в тестовом окружении `#imports` уже замокан алиасом (`apps/web/app/test/nuxt-imports.ts`), использовать тот же способ, что и в существующих тестах composables.

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useLegal.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: `apps/web/app/composables/useLegal.ts`**

```ts
import { computed } from 'vue';
import { useRuntimeConfig } from '#imports';

import { useApiClient } from './useApiClient.js';

export type LegalOperator = {
  name: string;
  inn: string;
  email: string;
  hostingProvider: string;
  emailProvider: string;
};

export type LegalDocument = {
  document: 'TERMS' | 'PRIVACY_POLICY' | 'PD_CONSENT';
  version: string;
  effectiveOn: string;
};

export function useLegal() {
  const config = useRuntimeConfig().public.legal as {
    operatorName: string;
    operatorInn: string;
    operatorEmail: string;
    hostingProvider: string;
    emailProvider: string;
  };
  const api = useApiClient();

  const operator = computed<LegalOperator>(() => ({
    name: config.operatorName.trim(),
    inn: config.operatorInn.trim(),
    email: config.operatorEmail.trim(),
    hostingProvider: config.hostingProvider.trim(),
    emailProvider: config.emailProvider.trim(),
  }));

  const operatorComplete = computed(
    () =>
      operator.value.name.length > 0 &&
      /^\d{12}$/.test(operator.value.inn) &&
      operator.value.email.includes('@') &&
      operator.value.hostingProvider.length > 0 &&
      operator.value.emailProvider.length > 0,
  );

  function loadDocuments(): Promise<LegalDocument[]> {
    return api.request<LegalDocument[]>('/api/v1/legal/documents');
  }

  return { operator, operatorComplete, loadDocuments };
}
```

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useLegal.test.ts`
Expected: PASS.

- [ ] **Step 4: Оболочка страницы `apps/web/app/components/legal/LegalDocumentPage.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useHead } from '#imports';

import { useLegal, type LegalDocument } from '../../composables/useLegal.js';

const props = defineProps<{ title: string; document: LegalDocument['document'] }>();

const { operator, operatorComplete, loadDocuments } = useLegal();
const edition = ref<LegalDocument | null>(null);
const loadFailed = ref(false);

const editionLabel = computed(() => {
  if (!edition.value) return loadFailed.value ? 'Редакция: не удалось загрузить' : 'Редакция: загрузка…';
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(
    new Date(`${edition.value.effectiveOn}T00:00:00Z`),
  );
  return `Редакция ${edition.value.version}, действует с ${date}`;
});

useHead(() => ({
  title: `${props.title} — HarmoFin`,
  meta: operatorComplete.value ? [] : [{ name: 'robots', content: 'noindex' }],
}));

onMounted(async () => {
  try {
    edition.value = (await loadDocuments()).find((doc) => doc.document === props.document) ?? null;
    if (!edition.value) loadFailed.value = true;
  } catch {
    loadFailed.value = true;
  }
});
</script>

<template>
  <main class="legal-page">
    <NuxtLink class="legal-page__home" to="/">HarmoFin</NuxtLink>
    <p v-if="!operatorComplete" class="legal-page__warning" role="alert">
      Реквизиты оператора не заполнены. Документ показан как черновик.
    </p>
    <h1 class="legal-page__title">{{ title }}</h1>
    <p class="legal-page__edition">{{ editionLabel }}</p>
    <article class="legal-page__body">
      <slot :operator="operator" />
    </article>
  </main>
</template>

<style scoped>
.legal-page {
  max-width: 46rem;
  margin: 0 auto;
  padding: var(--hf-space-8) var(--hf-space-4) var(--hf-space-12);
  color: var(--hf-color-text);
  line-height: 1.6;
}

.legal-page__home {
  display: inline-block;
  margin-bottom: var(--hf-space-6);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
}

.legal-page__warning {
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-left: 4px solid var(--hf-color-action-danger);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
}

.legal-page__title {
  margin: 0 0 var(--hf-space-2);
}

.legal-page__edition {
  margin: 0 0 var(--hf-space-8);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.legal-page__body :deep(h2) {
  margin: var(--hf-space-8) 0 var(--hf-space-3);
  font-size: 1.15rem;
}

.legal-page__body :deep(ul) {
  padding-left: var(--hf-space-5);
}
</style>
```

- [ ] **Step 5: Тексты документов**

Каждый компонент принимает prop `operator: LegalOperator` и не содержит другой логики. Пустые реквизиты выводятся как есть (страница уже показывает предупреждение).

`apps/web/app/components/legal/PrivacyPolicyText.vue`:

```vue
<script setup lang="ts">
import type { LegalOperator } from '../../composables/useLegal.js';

defineProps<{ operator: LegalOperator }>();
</script>

<template>
  <section>
    <h2>1. Оператор</h2>
    <p>
      Оператор персональных данных — {{ operator.name }}, ИНН {{ operator.inn }}, применяющий
      специальный налоговый режим «Налог на профессиональный доход» (далее — Оператор). Адрес
      электронной почты для обращений по вопросам персональных данных:
      <a :href="`mailto:${operator.email}`">{{ operator.email }}</a>.
    </p>
    <p>
      Настоящая Политика определяет порядок обработки и защиты персональных данных пользователей
      сервиса HarmoFin (далее — Сервис) и опубликована во исполнение части 2 статьи 18.1
      Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных» (далее — Закон).
    </p>

    <h2>2. Термины</h2>
    <p>
      Термины «персональные данные», «обработка персональных данных», «оператор», «уничтожение
      персональных данных» и другие используются в значениях, установленных статьёй 3 Закона.
      Пользователь — физическое лицо, зарегистрировавшее аккаунт в Сервисе.
    </p>

    <h2>3. Чьи данные обрабатываются</h2>
    <p>Оператор обрабатывает персональные данные пользователей Сервиса.</p>

    <h2>4. Какие данные обрабатываются</h2>
    <ul>
      <li>адрес электронной почты;</li>
      <li>отображаемое имя, если пользователь его указал;</li>
      <li>хеш пароля — сам пароль не хранится и Оператору неизвестен;</li>
      <li>
        данные сессий: время входа и последней активности, срок действия сессии, строка
        идентификации браузера (User-Agent);
      </li>
      <li>
        финансовые записи, которые пользователь вводит сам: счета, конверты, категории, операции,
        переводы, плановые платежи, комментарии, а также журнал изменений этих записей;
      </li>
      <li>сведения о принятии документов: какой документ, его редакция и дата принятия;</li>
      <li>служебные сведения о запросе и отмене удаления аккаунта.</li>
    </ul>
    <p>
      Сервис не запрашивает и не хранит реквизиты банковских карт, логины и пароли от
      интернет-банков, паспортные данные. Специальные категории персональных данных и
      биометрические персональные данные не обрабатываются.
    </p>

    <h2>5. Цели и правовые основания</h2>
    <ul>
      <li>
        регистрация пользователя и предоставление Сервиса по Пользовательскому соглашению —
        на основании согласия пользователя (пункт 1 части 1 статьи 6 Закона) и для исполнения
        соглашения, стороной которого является пользователь (пункт 5 части 1 статьи 6 Закона);
      </li>
      <li>обеспечение безопасности аккаунта и защита от несанкционированного доступа;</li>
      <li>
        направление служебных писем: восстановление пароля, подтверждение запроса на удаление
        аккаунта;
      </li>
      <li>выполнение обязанностей Оператора, установленных законодательством Российской Федерации.</li>
    </ul>
    <p>Рекламные рассылки не направляются.</p>

    <h2>6. Действия с данными</h2>
    <p>
      Обработка автоматизированная и включает сбор, запись, систематизацию, накопление, хранение,
      уточнение (обновление, изменение), извлечение, использование, блокирование, удаление и
      уничтожение. Персональные данные не распространяются и не передаются третьим лицам, за
      исключением лиц, указанных в разделе 8, и случаев, прямо предусмотренных законодательством
      Российской Федерации.
    </p>

    <h2>7. Где хранятся данные</h2>
    <p>
      Базы данных, содержащие персональные данные, находятся на территории Российской Федерации.
      Трансграничная передача персональных данных не осуществляется.
    </p>

    <h2>8. Кто помогает обрабатывать данные</h2>
    <ul>
      <li>{{ operator.hostingProvider }} — размещение сервера Сервиса;</li>
      <li>{{ operator.emailProvider }} — доставка служебных писем.</li>
    </ul>
    <p>
      Эти лица находятся в Российской Федерации, действуют по договору с Оператором и обязаны
      соблюдать конфиденциальность и безопасность персональных данных.
    </p>

    <h2>9. Сроки обработки и хранения</h2>
    <p>
      Персональные данные обрабатываются, пока аккаунт активен. После запроса на удаление
      аккаунта вход закрывается сразу, а данные уничтожаются безвозвратно через 30 дней. Резервные
      копии хранятся не более 30 дней, поэтому не позднее чем через 60 дней после запроса данных
      не остаётся ни в основной базе, ни в копиях. После удаления сохраняется только запись без
      персональных данных о факте и дате удаления.
    </p>

    <h2>10. Файлы cookie</h2>
    <p>
      Сервис использует одну технически необходимую cookie для поддержания входа в аккаунт. Без неё
      вход невозможен. Аналитические и рекламные cookie не используются.
    </p>

    <h2>11. Как данные защищены</h2>
    <ul>
      <li>пароли хранятся только в виде криптографического хеша Argon2id;</li>
      <li>вход выполняется через защищённую серверную сессию;</li>
      <li>данные одного бюджета недоступны другим пользователям;</li>
      <li>доступ к серверу ограничен;</li>
      <li>изменения финансовых записей фиксируются в журнале.</li>
    </ul>

    <h2>12. Права пользователя</h2>
    <p>Пользователь вправе:</p>
    <ul>
      <li>получить сведения об обработке своих персональных данных (статья 14 Закона);</li>
      <li>
        потребовать уточнения, блокирования или уничтожения данных, если они неполные, устаревшие,
        неточные, незаконно полученные или не нужны для заявленной цели;
      </li>
      <li>отозвать согласие на обработку персональных данных;</li>
      <li>
        обжаловать действия Оператора в Федеральную службу по надзору в сфере связи,
        информационных технологий и массовых коммуникаций (Роскомнадзор) или в суд.
      </li>
    </ul>
    <p>
      В интерфейсе Сервиса пользователь сам может изменить пароль, выгрузить операции в файл CSV и
      удалить аккаунт.
    </p>

    <h2>13. Как обратиться к Оператору</h2>
    <p>
      Запрос направляется на адрес <a :href="`mailto:${operator.email}`">{{ operator.email }}</a> с
      адреса, указанного при регистрации. Оператор отвечает в течение 10 рабочих дней с момента
      получения запроса. Срок может быть продлён не более чем на 5 рабочих дней, о чём Оператор
      сообщает с указанием причин.
    </p>

    <h2>14. Отзыв согласия</h2>
    <p>
      Согласие отзывается удалением аккаунта в настройках Сервиса или письмом Оператору. После
      отзыва Оператор прекращает обработку и уничтожает персональные данные в срок не более 30
      дней, если иное не предусмотрено законом.
    </p>

    <h2>15. Утечки</h2>
    <p>
      При неправомерной передаче или утечке персональных данных Оператор уведомляет Роскомнадзор в
      сроки, установленные частью 3.1 статьи 21 Закона, и сообщает затронутым пользователям.
    </p>

    <h2>16. Изменение Политики</h2>
    <p>
      Новая редакция Политики публикуется на этой странице с указанием даты вступления в силу. При
      изменении Политики пользователь подтверждает новую редакцию при следующем входе в Сервис.
    </p>
  </section>
</template>
```

`apps/web/app/components/legal/TermsText.vue`:

```vue
<script setup lang="ts">
import type { LegalOperator } from '../../composables/useLegal.js';

defineProps<{ operator: LegalOperator }>();
</script>

<template>
  <section>
    <h2>1. Стороны и предмет</h2>
    <p>
      Настоящее Соглашение заключается между {{ operator.name }}, ИНН {{ operator.inn }},
      применяющим специальный налоговый режим «Налог на профессиональный доход» (далее —
      Оператор), и пользователем сервиса HarmoFin (далее — Сервис). Оператор предоставляет
      пользователю доступ к Сервису для учёта личного и семейного бюджета.
    </p>

    <h2>2. Принятие Соглашения</h2>
    <p>
      Регистрация в Сервисе с отметкой о принятии Соглашения означает полное и безоговорочное
      согласие пользователя с ним. Если пользователь не согласен с Соглашением, он не должен
      использовать Сервис.
    </p>

    <h2>3. Возраст</h2>
    <p>Сервис предназначен для лиц, достигших 18 лет.</p>

    <h2>4. Стоимость</h2>
    <p>
      Сервис предоставляется бесплатно. О введении платных функций Оператор сообщает заранее.
      Платные функции не подключаются без отдельного согласия пользователя.
    </p>

    <h2>5. Что такое Сервис</h2>
    <p>
      HarmoFin — инструмент учёта. Сервис не даёт финансовых, инвестиционных, налоговых или
      юридических рекомендаций. Все расчёты основаны только на данных, которые ввёл пользователь.
      Сервис не подключается к банкам, не получает доступ к банковским счетам и не совершает
      платежей.
    </p>

    <h2>6. Аккаунт</h2>
    <ul>
      <li>пользователь отвечает за сохранность своего пароля и за действия в своём аккаунте;</li>
      <li>пользователь сам вводит данные и отвечает за их достоверность;</li>
      <li>
        запрещено использовать Сервис в противоправных целях, пытаться получить доступ к чужим
        данным или нарушать работу Сервиса.
      </li>
    </ul>

    <h2>7. Данные пользователя</h2>
    <p>
      Финансовые данные, которые пользователь вводит в Сервис, принадлежат пользователю. В
      интерфейсе доступны выгрузка операций в файл CSV и удаление аккаунта. Порядок обработки и
      удаления персональных данных описан в
      <NuxtLink to="/privacy">Политике обработки персональных данных</NuxtLink>.
    </p>

    <h2>8. Доступность Сервиса</h2>
    <p>
      Сервис предоставляется «как есть». Оператор стремится обеспечить его работу без перерывов,
      но возможны технические работы и сбои. Оператор делает резервные копии, но рекомендует
      пользователю периодически выгружать свои данные.
    </p>

    <h2>9. Ответственность</h2>
    <p>
      Оператор не отвечает за решения, которые пользователь принял на основе данных Сервиса, и за
      последствия ошибок во введённых пользователем данных. Ограничение ответственности действует в
      пределах, допускаемых законодательством Российской Федерации, и не распространяется на случаи
      умысла или грубой неосторожности Оператора.
    </p>

    <h2>10. Прекращение использования</h2>
    <p>
      Пользователь может в любой момент удалить аккаунт в настройках Сервиса. Оператор вправе
      заблокировать аккаунт при нарушении Соглашения, уведомив пользователя по электронной почте.
    </p>

    <h2>11. Изменение Соглашения</h2>
    <p>
      Новая редакция Соглашения публикуется на этой странице с указанием даты вступления в силу.
      Пользователь подтверждает новую редакцию при следующем входе. Без подтверждения работа в
      Сервисе невозможна, но удаление аккаунта остаётся доступным.
    </p>

    <h2>12. Применимое право и споры</h2>
    <p>
      К Соглашению применяется право Российской Федерации. Споры решаются путём переговоров через
      электронную почту Оператора, а при недостижении согласия — в суде по правилам подсудности,
      установленным законодательством Российской Федерации.
    </p>

    <h2>13. Контакты</h2>
    <p>
      Электронная почта Оператора: <a :href="`mailto:${operator.email}`">{{ operator.email }}</a>.
    </p>
  </section>
</template>
```

`apps/web/app/components/legal/PdConsentText.vue`:

```vue
<script setup lang="ts">
import type { LegalOperator } from '../../composables/useLegal.js';

defineProps<{ operator: LegalOperator }>();
</script>

<template>
  <section>
    <p>
      Отмечая в интерфейсе сервиса HarmoFin поле «Даю согласие на обработку персональных данных»,
      я, пользователь, указавший при регистрации адрес электронной почты, свободно, своей волей и в
      своём интересе даю согласие на обработку моих персональных данных на следующих условиях
      (статья 9 Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных»).
    </p>

    <h2>1. Оператор</h2>
    <p>
      {{ operator.name }}, ИНН {{ operator.inn }}, применяющий специальный налоговый режим «Налог
      на профессиональный доход». Электронная почта:
      <a :href="`mailto:${operator.email}`">{{ operator.email }}</a>.
    </p>

    <h2>2. Цели обработки</h2>
    <p>
      Регистрация и предоставление сервиса HarmoFin по Пользовательскому соглашению, обеспечение
      безопасности аккаунта, направление служебных писем.
    </p>

    <h2>3. Перечень персональных данных</h2>
    <p>
      Адрес электронной почты; отображаемое имя, если я его укажу; хеш пароля; данные сессий (время
      входа и последней активности, строка идентификации браузера); финансовые записи, которые я
      ввожу сам, и журнал их изменений; сведения о принятии документов; служебные сведения о
      запросе и отмене удаления аккаунта.
    </p>

    <h2>4. Действия и способ обработки</h2>
    <p>
      Сбор, запись, систематизация, накопление, хранение, уточнение (обновление, изменение),
      извлечение, использование, блокирование, удаление, уничтожение. Обработка автоматизированная.
    </p>

    <h2>5. Лица, которым поручена обработка</h2>
    <p>
      {{ operator.hostingProvider }} (размещение сервера) и {{ operator.emailProvider }} (доставка
      служебных писем). Данные хранятся на территории Российской Федерации и за её пределы не
      передаются.
    </p>

    <h2>6. Срок действия согласия</h2>
    <p>Согласие действует до удаления аккаунта или отзыва согласия.</p>

    <h2>7. Отзыв согласия</h2>
    <p>
      Я могу отозвать согласие, удалив аккаунт в настройках сервиса или направив письмо Оператору
      на адрес <a :href="`mailto:${operator.email}`">{{ operator.email }}</a>. После отзыва
      Оператор прекращает обработку и уничтожает мои персональные данные в срок не более 30 дней,
      если иное не предусмотрено законом.
    </p>
  </section>
</template>
```

- [ ] **Step 6: Страницы**

`apps/web/app/pages/privacy.vue`:

```vue
<script setup lang="ts">
import LegalDocumentPage from '../components/legal/LegalDocumentPage.vue';
import PrivacyPolicyText from '../components/legal/PrivacyPolicyText.vue';

defineOptions({ name: 'PrivacyPage' });
</script>

<template>
  <LegalDocumentPage title="Политика обработки персональных данных" document="PRIVACY_POLICY">
    <template #default="{ operator }">
      <PrivacyPolicyText :operator="operator" />
    </template>
  </LegalDocumentPage>
</template>
```

`apps/web/app/pages/terms.vue` — то же с `TermsText`, `title="Пользовательское соглашение"`, `document="TERMS"`, `defineOptions({ name: 'TermsPage' })`.

`apps/web/app/pages/consent.vue` — то же с `PdConsentText`, `title="Согласие на обработку персональных данных"`, `document="PD_CONSENT"`, `defineOptions({ name: 'ConsentPage' })`.

- [ ] **Step 7: Тест страниц `apps/web/app/pages/legal-pages.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ complete: true }));
const operator = {
  name: 'Иванов Иван Иванович',
  inn: '123456789012',
  email: 'privacy@harmofin.example',
  hostingProvider: 'Хостинг-провайдер',
  emailProvider: 'Почтовый сервис',
};

vi.mock('#imports', () => ({ useHead: vi.fn() }));
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({
    operator: computed(() => operator),
    operatorComplete: computed(() => state.complete),
    loadDocuments: vi.fn().mockResolvedValue([
      { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
    ]),
  }),
}));

import ConsentPage from './consent.vue';
import PrivacyPage from './privacy.vue';
import TermsPage from './terms.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('legal pages', () => {
  it.each([
    [PrivacyPage, 'Политика обработки персональных данных'],
    [TermsPage, 'Пользовательское соглашение'],
    [ConsentPage, 'Согласие на обработку персональных данных'],
  ])('renders the title, the edition and the operator requisites', async (page, title) => {
    state.complete = true;
    const wrapper = mount(page, { global: { stubs } });
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe(title);
    expect(wrapper.text()).toContain('Редакция 2026-10-18, действует с 18.10.2026');
    expect(wrapper.text()).toContain('Иванов Иван Иванович');
    expect(wrapper.text()).toContain('123456789012');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('warns when the operator requisites are incomplete', async () => {
    state.complete = false;
    const wrapper = mount(PrivacyPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Реквизиты оператора не заполнены');
  });

  it('names the hosting and email providers in the policy', async () => {
    state.complete = true;
    const wrapper = mount(PrivacyPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Хостинг-провайдер');
    expect(wrapper.text()).toContain('Почтовый сервис');
    expect(wrapper.text()).toContain('не более 30 дней');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/legal-pages.test.ts`
Expected: PASS.

- [ ] **Step 8: Тест хешей текстов `apps/web/app/components/legal/legal-texts.test.ts`**

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * A legal text may change only together with a new edition. When this test fails: bump the version
 * in apps/api/src/legal/legal-documents.ts (and its pinned test), then record the new version and
 * hash here. Procedure: docs/runbooks/public-launch-legal.md, step 11.
 */
const EDITIONS = {
  'PrivacyPolicyText.vue': { version: '2026-10-18', sha256: 'RECORD_ON_FIRST_RUN' },
  'TermsText.vue': { version: '2026-10-18', sha256: 'RECORD_ON_FIRST_RUN' },
  'PdConsentText.vue': { version: '2026-10-18', sha256: 'RECORD_ON_FIRST_RUN' },
} as const;

function templateHash(file: string): string {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? '';
  return createHash('sha256').update(template.replace(/\s+/g, ' ').trim()).digest('hex');
}

describe('legal texts', () => {
  it.each(Object.entries(EDITIONS))('%s matches its recorded edition', (file, edition) => {
    expect(templateHash(file)).toBe(edition.sha256);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/legal/legal-texts.test.ts`
Expected: FAIL с фактическими хешами в сообщении `expected '<hex>' to be 'RECORD_ON_FIRST_RUN'`. Заменить `RECORD_ON_FIRST_RUN` на эти три значения (тексты из Step 5 — первая редакция), перезапустить.
Expected: PASS. В коммите не должно остаться строки `RECORD_ON_FIRST_RUN`.

- [ ] **Step 9: Проверки и коммит**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint && pnpm --filter @harmofin/web exec vitest run app/composables/useLegal.test.ts app/pages/legal-pages.test.ts app/components/legal`

```bash
git add apps/web/nuxt.config.ts apps/web/app/composables/useLegal.ts apps/web/app/composables/useLegal.test.ts apps/web/app/components/legal apps/web/app/pages/privacy.vue apps/web/app/pages/terms.vue apps/web/app/pages/consent.vue apps/web/app/pages/legal-pages.test.ts infra/compose/production.yml .env.example infra/env/staging.example
git commit -m "feat(web): политика, соглашение и согласие на обработку ПД"
```

---

### Task 4: Галочки на регистрации, экран принятия и барьер

**Files:**
- Modify: `apps/web/app/composables/useAuth.ts` (тип `MeResponse`, `register`, новый `acceptConsents`)
- Create: `apps/web/app/components/auth/ConsentCheckboxes.vue`, `ConsentCheckboxes.test.ts`
- Modify: `apps/web/app/pages/register.vue`
- Create: `apps/web/app/pages/accept-terms.vue`, `accept-terms.test.ts`
- Modify: `apps/web/app/middleware/auth.ts`
- Test: `apps/web/app/middleware/auth.test.ts` (create, если нет), существующие тесты регистрации

**Interfaces:**
- Consumes: `useLegal().loadDocuments()` (Task 3), `POST /api/v1/me/consents`, `consents` в регистрации, `pendingConsents` в `/me` (Task 2).
- Produces: `useAuth().register(input & { consents?: Consent[] })`, `useAuth().acceptConsents(consents: Consent[]): Promise<void>`, `type Consent = { document: 'TERMS' | 'PRIVACY_POLICY' | 'PD_CONSENT'; version: string }`; компонент `ConsentCheckboxes` (`v-model:terms`, `v-model:pd`, оба boolean); маршрут `/accept-terms`.

- [ ] **Step 1: `useAuth.ts`**

```ts
export type Consent = { document: 'TERMS' | 'PRIVACY_POLICY' | 'PD_CONSENT'; version: string };
```

В `MeResponse` добавить `pendingConsents: Consent[];`. В сигнатуру `register` добавить `consents?: Consent[];`. Новый метод (и в `return`):

```ts
  async function acceptConsents(consents: Consent[]): Promise<void> {
    await api.request('/api/v1/me/consents', {
      method: 'POST',
      body: JSON.stringify({ consents }),
    });
    if (currentData.value) currentData.value = { ...currentData.value, pendingConsents: [] };
  }
```

Если существующие тесты/моки создают `MeResponse` без `pendingConsents`, добавить им `pendingConsents: []`.

- [ ] **Step 2: Падающий тест `apps/web/app/components/auth/ConsentCheckboxes.test.ts`**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ConsentCheckboxes from './ConsentCheckboxes.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('ConsentCheckboxes', () => {
  it('renders two separate unchecked checkboxes with links to the documents', () => {
    const wrapper = mount(ConsentCheckboxes, {
      props: { terms: false, pd: false },
      global: { stubs },
    });
    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !(box.element as HTMLInputElement).checked)).toBe(true);
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(['/terms', '/privacy', '/consent']);
    expect(wrapper.findAll('a').every((link) => link.attributes('target') === '_blank')).toBe(true);
  });

  it('emits each checkbox separately', async () => {
    const wrapper = mount(ConsentCheckboxes, {
      props: { terms: false, pd: false },
      global: { stubs },
    });
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);
    expect(wrapper.emitted('update:terms')?.[0]).toEqual([true]);
    expect(wrapper.emitted('update:pd')?.[0]).toEqual([true]);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/auth/ConsentCheckboxes.test.ts`
Expected: FAIL.

- [ ] **Step 3: `apps/web/app/components/auth/ConsentCheckboxes.vue`**

```vue
<script setup lang="ts">
defineOptions({ name: 'ConsentCheckboxes' });

const terms = defineModel<boolean>('terms', { required: true });
const pd = defineModel<boolean>('pd', { required: true });
</script>

<template>
  <fieldset class="consent-checkboxes">
    <legend class="consent-checkboxes__legend">Документы</legend>
    <label class="consent-checkboxes__item">
      <input v-model="terms" name="consent-terms" type="checkbox" />
      <span>
        Принимаю
        <NuxtLink to="/terms" target="_blank">пользовательское соглашение</NuxtLink>
        и
        <NuxtLink to="/privacy" target="_blank">политику обработки персональных данных</NuxtLink>
      </span>
    </label>
    <label class="consent-checkboxes__item">
      <input v-model="pd" name="consent-pd" type="checkbox" />
      <span>
        Даю
        <NuxtLink to="/consent" target="_blank">согласие на обработку персональных данных</NuxtLink>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
.consent-checkboxes {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.consent-checkboxes__legend {
  margin-bottom: 0.25rem;
  font-weight: 600;
}

.consent-checkboxes__item {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  min-height: 2.75rem;
  font-size: 0.9rem;
  line-height: 1.4;
}

.consent-checkboxes__item input {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.1rem;
}
</style>
```

Run: команда Step 2. Expected: PASS.

- [ ] **Step 4: `AuthForm` умеет блокировать кнопку**

В `apps/web/app/components/auth/AuthForm.vue` добавить необязательный prop и использовать его в кнопке отправки:

```ts
const props = defineProps<{
  title: string;
  subtitle: string;
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
  loading?: boolean;
  summary?: string;
  submitDisabled?: boolean;
}>();
```

```vue
          <button
            class="primary-action"
            type="submit"
            :disabled="props.loading || props.submitDisabled"
          >
```

- [ ] **Step 5: Падающий тест регистрации `apps/web/app/pages/register.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  navigateTo: vi.fn(),
  loadDocuments: vi.fn(),
}));

vi.mock('#app', () => ({ navigateTo: mocks.navigateTo }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>(
    '../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ register: mocks.register }) };
});
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({ loadDocuments: mocks.loadDocuments }),
}));

import AuthForm from '../components/auth/AuthForm.vue';
import RegisterPage from './register.vue';

const documents = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

function mountPage() {
  return mount(RegisterPage, {
    global: {
      components: { AuthForm },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}

describe('register page', () => {
  beforeEach(() => {
    mocks.register.mockReset().mockResolvedValue({ user: { id: 'u1' } });
    mocks.navigateTo.mockReset();
    mocks.loadDocuments.mockReset().mockResolvedValue(documents);
  });

  it('keeps the submit disabled until both consents are checked', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const submit = () => wrapper.get('button[type="submit"]');

    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="consent-terms"]').setValue(true);
    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="consent-pd"]').setValue(true);
    expect(submit().attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('отметьте оба пункта');
  });

  it('sends the current document versions with the registration', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('#email').setValue('user@harmofin.test');
    await wrapper.get('#password').setValue('correct-password-10');
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.register).toHaveBeenCalledWith({
      email: 'user@harmofin.test',
      password: 'correct-password-10',
      consents: [
        { document: 'TERMS', version: '2026-10-18' },
        { document: 'PRIVACY_POLICY', version: '2026-10-18' },
        { document: 'PD_CONSENT', version: '2026-10-18' },
      ],
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app');
  });

  it('does not register when the document versions failed to load', async () => {
    mocks.loadDocuments.mockRejectedValue(new Error('offline'));
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Не удалось загрузить документы');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/register.test.ts`
Expected: FAIL (галочек нет).

- [ ] **Step 6: Регистрация**

В `apps/web/app/pages/register.vue`, script — заменить импорт vue и добавить:

```ts
import { computed, onMounted, ref } from 'vue';
import { navigateTo } from '#app';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { useLegal, type LegalDocument } from '../composables/useLegal.js';
```

После существующих `ref`:

```ts
const acceptTerms = ref(false);
const acceptPd = ref(false);
const documents = ref<LegalDocument[]>([]);
const { loadDocuments } = useLegal();
const consentsReady = computed(
  () => acceptTerms.value && acceptPd.value && documents.value.length === 3,
);

onMounted(async () => {
  try {
    documents.value = await loadDocuments();
  } catch {
    summary.value = 'Не удалось загрузить документы. Обновите страницу.';
  }
});
```

В `submit()` первой строкой: `if (!consentsReady.value) return;`. В объект `register({ … })` после `password` добавить:

```ts
      consents: documents.value.map(({ document, version }) => ({ document, version })),
```

В template: у `<AuthForm …>` добавить `:submit-disabled="!consentsReady"`; перед `<template #footer>`:

```vue
    <ConsentCheckboxes v-model:terms="acceptTerms" v-model:pd="acceptPd" />
    <p v-if="!acceptTerms || !acceptPd" class="consent-hint">
      Чтобы создать аккаунт, отметьте оба пункта.
    </p>
```

В `<style scoped>` к селектору `small, label span` добавить `.consent-hint`, и `.consent-hint { margin: 0; }`.

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/register.test.ts`
Expected: PASS.

- [ ] **Step 7: Падающий тест экрана принятия `apps/web/app/pages/accept-terms.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  currentData: { value: null as unknown },
  loadMe: vi.fn(),
  acceptConsents: vi.fn(),
  logout: vi.fn(),
  navigateTo: vi.fn(),
  loadDocuments: vi.fn(),
}));

vi.mock('#imports', () => ({ definePageMeta: () => undefined, navigateTo: mocks.navigateTo }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>(
    '../composables/useAuth.js',
  );
  return {
    ...actual,
    useAuth: () => ({
      currentData: mocks.currentData,
      loadMe: mocks.loadMe,
      acceptConsents: mocks.acceptConsents,
      logout: mocks.logout,
    }),
  };
});
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({ loadDocuments: mocks.loadDocuments }),
}));

import AuthForm from '../components/auth/AuthForm.vue';
import AcceptTermsPage from './accept-terms.vue';

const pending = [{ document: 'TERMS', version: '2026-10-18' }];
const documents = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

function mountPage() {
  return mount(AcceptTermsPage, {
    global: {
      components: { AuthForm },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}

async function checkBoth(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.get('[name="consent-terms"]').setValue(true);
  await wrapper.get('[name="consent-pd"]').setValue(true);
}

describe('accept terms page', () => {
  beforeEach(() => {
    mocks.currentData.value = { user: {}, workspaces: [], pendingConsents: pending };
    mocks.loadMe.mockReset();
    mocks.acceptConsents.mockReset().mockResolvedValue(undefined);
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.navigateTo.mockReset();
    mocks.loadDocuments.mockReset().mockResolvedValue(documents);
  });

  it('accepts the full current set and continues to the app', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();

    await checkBoth(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.acceptConsents).toHaveBeenCalledWith([
      { document: 'TERMS', version: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18' },
    ]);
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('shows the server message when the editions moved on', async () => {
    mocks.acceptConsents.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'LEGAL_CONSENT_VERSION_MISMATCH',
        detail: 'Документы обновились. Обновите страницу и примите актуальные редакции.',
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await checkBoth(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Документы обновились');
    expect(mocks.navigateTo).not.toHaveBeenCalledWith('/app', { replace: true });
  });

  it('leaves the screen when nothing is pending', async () => {
    mocks.currentData.value = { user: {}, workspaces: [], pendingConsents: [] };
    mountPage();
    await flushPromises();

    expect(mocks.navigateTo).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('offers account deletion and sign-out instead of accepting', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('a[href="/app/settings/delete-account"]').exists()).toBe(true);
    await wrapper.get('button.form-links__button').trigger('click');
    await flushPromises();
    expect(mocks.logout).toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/login', { replace: true });
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/accept-terms.test.ts`
Expected: FAIL — страницы нет.

- [ ] **Step 8: Экран принятия `apps/web/app/pages/accept-terms.vue`**

Сервер требует полный набор текущих документов, поэтому отправляются все три текущие версии из `GET /legal/documents`, а не только pending.

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ConsentCheckboxes from '../components/auth/ConsentCheckboxes.vue';
import { errorMessage, useAuth } from '../composables/useAuth.js';
import { useLegal } from '../composables/useLegal.js';

defineOptions({ name: 'AcceptTermsPage' });
definePageMeta({ middleware: 'auth' });

const { currentData, loadMe, acceptConsents, logout } = useAuth();
const { loadDocuments } = useLegal();
const acceptTerms = ref(false);
const acceptPd = ref(false);
const loading = ref(false);
const summary = ref('');
const ready = computed(() => acceptTerms.value && acceptPd.value);

onMounted(async () => {
  if (!currentData.value) await loadMe();
  if (currentData.value && currentData.value.pendingConsents.length === 0)
    await navigateTo('/app', { replace: true });
});

async function submit() {
  if (!ready.value) return;
  loading.value = true;
  summary.value = '';
  try {
    const documents = await loadDocuments();
    await acceptConsents(documents.map(({ document, version }) => ({ document, version })));
    await navigateTo('/app', { replace: true });
  } catch (error) {
    summary.value = errorMessage(error).summary;
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await logout();
  await navigateTo('/login', { replace: true });
}
</script>

<template>
  <AuthForm
    title="Мы обновили документы"
    subtitle="Чтобы продолжить работу, примите актуальные редакции документов."
    submit-label="Принять и продолжить"
    :loading="loading"
    :summary="summary"
    :submit-disabled="!ready"
    :on-submit="submit"
  >
    <ConsentCheckboxes v-model:terms="acceptTerms" v-model:pd="acceptPd" />
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/app/settings/delete-account">Удалить аккаунт</NuxtLink>
        <button type="button" class="form-links__button" @click="signOut">Выйти</button>
      </p>
    </template>
  </AuthForm>
</template>

<style scoped>
.form-links__button {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/accept-terms.test.ts`
Expected: PASS.

- [ ] **Step 9: Падающий тест middleware `apps/web/app/middleware/auth.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadMe: vi.fn() }));

vi.mock('#app', () => ({
  defineNuxtRouteMiddleware: (fn: unknown) => fn,
  navigateTo: (path: string) => path,
}));
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ loadMe: mocks.loadMe }) }));

import middleware from './auth.js';

const run = middleware as unknown as (to: { path: string }) => Promise<string | undefined>;
const pending = [{ document: 'TERMS', version: '2026-10-18' }];

describe('auth middleware', () => {
  beforeEach(() => mocks.loadMe.mockReset());

  it.each([
    ['/app', pending, '/accept-terms'],
    ['/app/operations', pending, '/accept-terms'],
    ['/accept-terms', pending, undefined],
    ['/app/settings/delete-account', pending, undefined],
    ['/app', [], undefined],
  ])('on %s with pending %j resolves to %s', async (path, pendingConsents, target) => {
    mocks.loadMe.mockResolvedValue({ user: {}, workspaces: [], pendingConsents });
    await expect(run({ path })).resolves.toBe(target);
  });

  it('sends signed-out users to /login', async () => {
    mocks.loadMe.mockRejectedValue(new Error('401'));
    await expect(run({ path: '/app' })).resolves.toBe('/login');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/middleware/auth.test.ts`
Expected: FAIL (редиректа на `/accept-terms` нет).

- [ ] **Step 10: Барьер в `apps/web/app/middleware/auth.ts`**

```ts
import { defineNuxtRouteMiddleware, navigateTo } from '#app';

import { useAuth } from '../composables/useAuth.js';

// Pages a user without current consents may still open: accepting, or leaving.
const CONSENT_EXEMPT_PATHS = new Set(['/accept-terms', '/app/settings/delete-account']);

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  let me;
  try {
    me = await useAuth().loadMe();
  } catch {
    return navigateTo('/login');
  }
  if (me.pendingConsents.length > 0 && !CONSENT_EXEMPT_PATHS.has(to.path))
    return navigateTo('/accept-terms');
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/middleware/auth.test.ts`
Expected: PASS.

- [ ] **Step 11: Проверки и коммит**

Run: `pnpm --filter @harmofin/web exec vitest run && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`

```bash
git add apps/web/app/composables/useAuth.ts apps/web/app/components/auth apps/web/app/pages/register.vue apps/web/app/pages/register.test.ts apps/web/app/pages/accept-terms.vue apps/web/app/pages/accept-terms.test.ts apps/web/app/middleware
git commit -m "feat(web): согласие на регистрации и экран принятия документов"
```

---

### Task 5: Лендинг — ссылки и карточки доверия

**Files:**
- Modify: `apps/web/app/data/landing.ts:107-117` (`securityCards`), `:183-187` (`footerInfoLinks`)
- Modify: `apps/web/app/components/landing/LandingFooter.vue`
- Test: `apps/web/app/components/landing/sections/SecuritySection.test.ts`, `apps/web/app/components/landing/LandingFooter.test.ts` (create)

**Interfaces:**
- Consumes: `useLegal().operator` (Task 3).
- Produces: `footerInfoLinks: { label: string; href: string }[]`.

- [ ] **Step 1: Данные**

```ts
export const securityCards: LandingTextCard[] = [
  {
    title: 'Защищённый доступ',
    text: 'Вход по паролю, восстановление доступа и управление активными сессиями.',
  },
  {
    title: 'Ваш бюджет — только ваш',
    text: 'Данные бюджета недоступны другим пользователям.',
  },
  { title: 'История изменений', text: 'Изменения финансовых данных сохраняются в журнале.' },
  {
    title: 'Без привязки банка',
    text: 'Сервис не просит логины от интернет-банка и данные карт — операции вы вносите сами.',
  },
  { title: 'Данные хранятся в России', text: 'Сервер и резервные копии находятся в России.' },
  {
    title: 'Выгрузка и удаление',
    text: 'Операции можно выгрузить в CSV, а аккаунт — удалить в настройках в любой момент.',
  },
];
```

```ts
export const footerInfoLinks: { label: string; href: string }[] = [
  { label: 'Политика обработки персональных данных', href: '/privacy' },
  { label: 'Пользовательское соглашение', href: '/terms' },
  { label: 'Согласие на обработку персональных данных', href: '/consent' },
];
```

- [ ] **Step 2: Подвал**

В `LandingFooter.vue`: импорт `useLegal`, `const { operator } = useLegal();`. Колонку «Информация» заменить на:

```vue
      <div class="landing-footer__column">
        <h3 class="landing-footer__heading">Информация</h3>
        <ul class="landing-footer__list">
          <li v-for="link in footerInfoLinks" :key="link.href">
            <NuxtLink :to="link.href" class="landing-footer__link">{{ link.label }}</NuxtLink>
          </li>
          <li v-if="operator.email">
            <a :href="`mailto:${operator.email}`" class="landing-footer__link">Контакты</a>
          </li>
        </ul>
      </div>
```

Удалить ставший ненужным класс `landing-footer__link--text`, если больше не используется.

- [ ] **Step 3: Тесты**

`apps/web/app/components/landing/LandingFooter.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ email: 'privacy@harmofin.example' }));

vi.mock('../../composables/useLegal.js', () => ({
  useLegal: () => ({ operator: computed(() => ({ email: state.email })) }),
}));

import LandingFooter from './LandingFooter.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('LandingFooter', () => {
  it('links the three legal documents and the operator contact', () => {
    state.email = 'privacy@harmofin.example';
    const wrapper = mount(LandingFooter, { global: { stubs } });
    const links = wrapper.findAll('a').map((link) => [link.text(), link.attributes('href')]);

    expect(links).toEqual(
      expect.arrayContaining([
        ['Политика обработки персональных данных', '/privacy'],
        ['Пользовательское соглашение', '/terms'],
        ['Согласие на обработку персональных данных', '/consent'],
        ['Контакты', 'mailto:privacy@harmofin.example'],
      ]),
    );
  });

  it('hides the contact link while the operator email is not set', () => {
    state.email = '';
    const wrapper = mount(LandingFooter, { global: { stubs } });
    expect(wrapper.text()).not.toContain('Контакты');
  });
});
```

`SecuritySection.test.ts`: обновить ожидаемое число карточек на 6 и проверить заголовки «Без привязки банка», «Данные хранятся в России», «Выгрузка и удаление». Если `SecuritySection` раскладывает карточки сеткой на 3 колонки — 6 карточек ложатся в 2 ряда без правок вёрстки; проверить это в тесте не нужно.

Run: `pnpm --filter @harmofin/web exec vitest run app/components/landing && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/data/landing.ts apps/web/app/components/landing
git commit -m "feat(web): ссылки на документы и карточки доверия на лендинге"
```

---

### Task 6: E2E, чеклист запуска и документация

**Files:**
- Modify: все E2E-регистрации: `e2e/account-deletion.spec.ts`, `app-shell.spec.ts`, `auth.spec.ts`, `envelope-v2-onboarding.spec.ts`, `envelope-v2-payments.spec.ts`, `envelope-v2-period.spec.ts`, `envelope-v2-plans.spec.ts`, `reference-data.spec.ts`, `reference-lists.spec.ts`, `settings.spec.ts`
- Create: `e2e/legal-consent.spec.ts`
- Create: `docs/runbooks/public-launch-legal.md`
- Modify: `docs/runbooks/account-data-request.md`, `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` (§18.5)

- [ ] **Step 1: Галочки во всех E2E-регистрациях**

В каждом месте, где перед `getByRole('button', { name: 'Создать аккаунт' }).click()` заполняются Email и Пароль (`grep -rn "Создать аккаунт" e2e`), вставить:

```ts
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
```

- [ ] **Step 2: Новый сценарий `e2e/legal-consent.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { apiV1, webOrigin } from './env';

const password = 'e2e-password-10';

test('registration requires both consents and documents are public', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Политика обработки персональных данных',
  );
  await page.goto('/consent');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Согласие на обработку персональных данных',
  );

  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(`e2e-legal-${Date.now()}@harmofin.test`);
  await page.getByLabel('Пароль').fill(password);
  const submit = page.getByRole('button', { name: 'Создать аккаунт' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/app$/);
});

test('a user without consents is held on the acceptance screen', async ({ page, request }) => {
  const email = `e2e-noconsent-${Date.now()}@harmofin.test`;
  // API registration without the optional consents field, as an older client would do.
  const registered = await request.post(`${apiV1}/auth/register`, {
    headers: { origin: webOrigin },
    data: { email, password },
  });
  expect(registered.status()).toBe(201);

  await page.goto('/login');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/accept-terms$/);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/accept-terms$/);

  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Принять и продолжить' }).click();
  await expect(page).toHaveURL(/\/app$/);
});
```

Проверка без запуска браузера: `pnpm lint` (и `tsc --noEmit -p e2e`, если у `e2e/` есть tsconfig). Local Playwright **не запускать**.

- [ ] **Step 3: Runbook `docs/runbooks/public-launch-legal.md`**

Содержимое — 11 пунктов чеклиста из раздела «Документация и чеклист запуска» спецификации дословно, каждый с конкретикой:

```markdown
# Чеклист юридической готовности к публичному запуску

Документ не является юридической консультацией. Сверьте статьи с актуальной редакцией 152-ФЗ перед запуском.

1. **Статус НПД.** Зарегистрироваться как плательщик налога на профессиональный доход в приложении «Мой налог». Пока сервис бесплатный, доходов и налога нет.
2. **Реквизиты.** Заполнить в production-окружении `NUXT_PUBLIC_LEGAL_OPERATOR_NAME` (ФИО полностью), `NUXT_PUBLIC_LEGAL_OPERATOR_INN` (12 цифр), `NUXT_PUBLIC_LEGAL_OPERATOR_EMAIL`, `NUXT_PUBLIC_LEGAL_HOSTING_PROVIDER`, `NUXT_PUBLIC_LEGAL_EMAIL_PROVIDER`. Без них `infra/compose/production.yml` не стартует. Открыть `/privacy`, `/terms`, `/consent` и убедиться, что нет предупреждения «Реквизиты оператора не заполнены».
3. **Уведомление Роскомнадзора (ст. 22).** До открытия регистрации подать уведомление об обработке персональных данных на pd.rkn.gov.ru (электронная форма, подпись через Госуслуги). Указать: цели и правовые основания из раздела 5 политики, категории данных из раздела 4, места хранения в РФ, меры защиты из раздела 11, отсутствие трансграничной передачи.
4. **Локализация (ст. 18 ч. 5).** В панели хостинга проверить, что VPS и его резервные копии в российском регионе; проверить, что почтовый сервис хранит и обрабатывает письма в РФ.
5. **Резервные копии.** Настроить хранение не более 30 дней — так обещает политика (раздел 9).
6. **Сверка с законом.** Перечитать ст. 9, 14, 18, 18.1, 20, 21, 22 152-ФЗ в актуальной редакции (consultant.ru или pravo.gov.ru) и сравнить с текстами документов. По возможности заказать разовую вычитку юристом по персональным данным.
7. **Адрес оператора в согласии (ст. 9 ч. 4).** Закон требует указать адрес оператора. Решить: указать адрес регистрации или проверить у юриста допустимость указания только email. При добавлении адреса — выпустить новую редакцию (п. 11).
8. **Утечка (ст. 21 ч. 3.1).** В течение 24 часов с момента обнаружения — первичное уведомление на pd.rkn.gov.ru (что произошло, предполагаемые причины, вред, принятые меры, контакт). В течение 72 часов — результаты внутреннего расследования и виновные, если установлены. Уведомить затронутых пользователей по email. Технические шаги — `docs/runbooks/suspicious-activity.md`.
9. **Запросы пользователей (ст. 14, 20).** Отвечать в течение 10 рабочих дней (продление на 5 с уведомлением о причине). Вести журнал обращений вне Git. Процедуры — `docs/runbooks/account-data-request.md`.
10. **Акт об уничтожении.** Для каждой выполненной очистки аккаунта (`account_deletions.purged_at IS NOT NULL`) оформлять акт об уничтожении персональных данных по требованиям приказа Роскомнадзора № 179 от 28.10.2022 вместе с выгрузкой из журнала (идентификатор записи, дата очистки, перечень категорий данных). Хранить 3 года.
11. **Новая редакция документа.** Изменить текст в `apps/web/app/components/legal/`, обновить версию и дату в `apps/api/src/legal/legal-documents.ts` и в его тесте, записать новый хеш в `apps/web/app/components/legal/legal-texts.test.ts`, задеплоить. Все пользователи примут редакцию на экране `/accept-terms`.
```

- [ ] **Step 4: Ссылки в документации**

- `docs/runbooks/account-data-request.md`: в начало добавить строку «Юридический чеклист запуска и порядок работы с запросами: [public-launch-legal.md](public-launch-legal.md).»
- `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`, §18.5: после строки «- пользовательское соглашение;» добавить примечание: «> Политика обработки персональных данных, пользовательское соглашение и согласие на обработку ПД перенесены в объём v1 решением владельца от 18.10.2026: [дизайн](2026-10-18-legal-documents-design.md).»

- [ ] **Step 5: Финальные проверки и коммит**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`

```bash
git add e2e docs/runbooks/public-launch-legal.md docs/runbooks/account-data-request.md docs/superpowers/specs/2026-08-30-family-budget-app-spec.md
git commit -m "docs: чеклист юридического запуска; e2e согласия на регистрации"
```

---

## Ревью по матрице

После Task 2: Security (публичный эндпоинт, CSRF, хранение согласия), API (новые эндпоинты и поля, `openapi.json`). После Task 1: backend (миграция, очистка). После Task 3–5: UI/UX (документы, регистрация, экран принятия, лендинг, доступность). Каждая задача — QA; в конце — final.
