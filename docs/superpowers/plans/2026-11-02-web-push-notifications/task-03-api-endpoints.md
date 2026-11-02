# Задача 3: API — подписки и настройки канала

Перед началом: прочитать [README](README.md). Задачи 1–2 закоммичены.

**Files:**
- Create: `apps/api/src/push/push.schemas.ts`
- Create: `apps/api/src/push/push.repository.ts`
- Create: `apps/api/src/push/push.application.service.ts`
- Create: `apps/api/src/push/push.dto.ts`
- Create: `apps/api/src/push/push.controller.ts`
- Create: `apps/api/src/push/push.module.ts`
- Modify: `apps/api/src/app.module.ts` — регистрация `PushModule`.
- Modify: `apps/api/src/auth/auth-rate-limit.guard.ts` — лимит на `POST /api/v1/me/push/subscriptions`.
- Create: `apps/api/test/helpers/push.ts` — общие тестовые данные (используют задачи 4 и 5).
- Create: `apps/api/test/push-subscriptions.integration.test.ts`
- Modify: `openapi.json` (генерируется).

**Interfaces:**
- Consumes (задача 1): Prisma-модель `pushSubscription`, поля `planOverdueEnabled`, `calendarReminderEnabled` в `notificationChannelSetting`, канал `'PUSH'`.
- Consumes (задача 2): `ApiConfig.push?.vapidPublicKey`; `isAllowedPushEndpoint`, `isValidP256dh`, `isValidAuthSecret`, `MAX_ENDPOINT_LENGTH` из `push/push-endpoint.ts`; `deviceLabel` из `push/device-label.ts`.
- Consumes (существующее): `requiredContext(request)` → `{ userId, sessionId }`, `requestMeta(request)` → `{ userAgent?, requestId? }` из `auth/auth-http.ts`; `SessionAuthGuard`, `CsrfGuard`, `AuthRateLimitGuard`; `ZodValidationPipe`; `ProblemDetailsResponse`; `createUuidV7(date?)` из `common/identifiers/uuid-v7.ts`.
- Produces (используют задачи 4, 5, 7, 8):
  - `GET /api/v1/me/notification-settings/push` → `{ available, vapidPublicKey, enabled, planOverdueEnabled, calendarReminderEnabled, devices: [{ id, label, createdAt, lastSuccessAt, current }] }`.
  - `PUT /api/v1/me/notification-settings/push` с телом `{ enabled, planOverdueEnabled, calendarReminderEnabled }` → тот же ответ; 409 `PUSH_NO_DEVICES`.
  - `POST /api/v1/me/push/subscriptions` с телом `{ endpoint, keys: { p256dh, auth } }` → тот же ответ; 409 `PUSH_UNAVAILABLE`, 422 `PUSH_ENDPOINT_NOT_ALLOWED`, 400 `VALIDATION_FAILED`.
  - `DELETE /api/v1/me/push/subscriptions/:subscriptionId` → 204.
  - Тестовые помощники из `apps/api/test/helpers/push.ts`: `vapidPublicKey`, `deviceKeys`, `pushEndpoint()`, `currentSessionId(prisma, userId)`, `revokedSessionId(prisma, userId)`, `addSubscription(prisma, { userId, sessionId, endpoint?, applicationServerKey? })`.

---

- [ ] **Step 1: Тестовые помощники**

Файл `apps/api/test/helpers/push.ts`:

```ts
import { randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

/** A syntactically valid public VAPID key (0x04 + 64 bytes, base64url). Not a real key pair. */
export const vapidPublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString(
  'base64url',
);

/** Device keys in the shape the browser sends them. */
export const deviceKeys = {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
  auth: Buffer.alloc(16, 2).toString('base64url'),
};

export const pushEndpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

/** The session `FamilyTestApp.register()` created for the user. */
export async function currentSessionId(prisma: PrismaClient, userId: string): Promise<string> {
  const session = await prisma.session.findFirstOrThrow({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return session.id;
}

/** A second, already revoked session of the user (as after signing out on another device). */
export async function revokedSessionId(prisma: PrismaClient, userId: string): Promise<string> {
  const id = randomUUID();
  const future = new Date(Date.now() + 86_400_000);
  await prisma.session.create({
    data: {
      id,
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      csrfTokenHash: randomBytes(32).toString('hex'),
      idleExpiresAt: future,
      absoluteExpiresAt: future,
      revokedAt: new Date(),
      revokedReason: 'LOGOUT',
    },
  });
  return id;
}

export async function addSubscription(
  prisma: PrismaClient,
  input: { userId: string; sessionId: string; endpoint?: string; applicationServerKey?: string },
): Promise<{ id: string; endpoint: string }> {
  const id = randomUUID();
  const endpoint = input.endpoint ?? pushEndpoint();
  await prisma.pushSubscription.create({
    data: {
      id,
      userId: input.userId,
      sessionId: input.sessionId,
      endpoint,
      p256dh: deviceKeys.p256dh,
      auth: deviceKeys.auth,
      applicationServerKey: input.applicationServerKey ?? vapidPublicKey,
      label: 'Chrome, Android',
    },
  });
  return { id, endpoint };
}
```

- [ ] **Step 2: Интеграционный тест (падает)**

Файл `apps/api/test/push-subscriptions.integration.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
import {
  addSubscription,
  currentSessionId,
  deviceKeys,
  pushEndpoint,
  revokedSessionId,
  vapidPublicKey,
} from './helpers/push.js';

const env = new FamilyTestApp();
const settingsPath = '/api/v1/me/notification-settings/push';
const subscriptionsPath = '/api/v1/me/push/subscriptions';
const allOn = { enabled: true, planOverdueEnabled: true, calendarReminderEnabled: true };
let anna: FamilyActor;
let boris: FamilyActor;

type View = {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: Array<{ id: string; label: string; current: boolean; lastSuccessAt: string | null }>;
};

const subscribe = (actor: FamilyActor, endpoint = pushEndpoint()) =>
  env.inject('POST', subscriptionsPath, actor, { endpoint, keys: deviceKeys });

async function reset(actor: FamilyActor) {
  await env.prisma.pushSubscription.deleteMany({ where: { userId: actor.user.id } });
  await env.prisma.notificationChannelSetting.deleteMany({
    where: { userId: actor.user.id, channel: 'PUSH' },
  });
}

beforeAll(async () => {
  await env.start({ VAPID_PUBLIC_KEY: vapidPublicKey, RATE_LIMIT_LOGIN_MAX: '100' });
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  await reset(anna);
  await reset(boris);
});

describe('push settings', () => {
  it('returns defaults with the public key and no devices', async () => {
    const response = await env.inject('GET', settingsPath, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: true,
      vapidPublicKey,
      enabled: false,
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
      devices: [],
    });
  });

  it('refuses to enable the channel without a device', async () => {
    const response = await env.inject('PUT', settingsPath, anna, allOn);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PUSH_NO_DEVICES' });
  });

  it('saves the type switches once a device exists', async () => {
    expect((await subscribe(anna)).statusCode).toBe(200);
    const response = await env.inject('PUT', settingsPath, anna, {
      ...allOn,
      planOverdueEnabled: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: true,
      planOverdueEnabled: false,
      calendarReminderEnabled: true,
    });
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'PUSH' } },
    });
    expect(setting.digestFrequency).toBe('OFF');
    expect(setting.includeAmounts).toBe(false);
  });

  it('hides a device whose session is revoked', async () => {
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });
    const view = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(view.devices).toEqual([]);
    expect((await env.inject('PUT', settingsPath, anna, allOn)).statusCode).toBe(409);
  });
});

describe('push subscriptions', () => {
  it('stores the device for the current session and switches the channel on', async () => {
    const endpoint = pushEndpoint();
    const response = await subscribe(anna, endpoint);
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.enabled).toBe(true);
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({ label: 'Браузер', current: true, lastSuccessAt: null });
    expect(JSON.stringify(view)).not.toContain(endpoint);

    const row = await env.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row.sessionId).toBe(await currentSessionId(env.prisma, anna.user.id));
    expect(row.applicationServerKey).toBe(vapidPublicKey);
    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'PUSH_SUBSCRIBED', entityId: row.id },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValues ?? null)).not.toContain(endpoint);
  });

  it('updates the same endpoint instead of adding a second device', async () => {
    const endpoint = pushEndpoint();
    await subscribe(anna, endpoint);
    await subscribe(anna, endpoint);
    expect(await env.prisma.pushSubscription.count({ where: { userId: anna.user.id } })).toBe(1);
  });

  it('moves an endpoint to the user who subscribed with it last', async () => {
    const endpoint = pushEndpoint();
    await subscribe(anna, endpoint);
    const response = await subscribe(boris, endpoint);
    expect(response.statusCode).toBe(200);
    const row = await env.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row.userId).toBe(boris.user.id);
    const annaView = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(annaView.devices).toEqual([]);
    expect(annaView.enabled).toBe(false);
  });

  it('keeps at most 10 devices and drops the oldest', async () => {
    const first = pushEndpoint();
    await subscribe(anna, first);
    // Make the order unambiguous even when two requests land in the same millisecond.
    await env.prisma.pushSubscription.update({
      where: { endpoint: first },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    for (let index = 0; index < 10; index += 1) {
      expect((await subscribe(anna)).statusCode).toBe(200);
    }
    expect(await env.prisma.pushSubscription.count({ where: { userId: anna.user.id } })).toBe(10);
    expect(
      await env.prisma.pushSubscription.findUnique({ where: { endpoint: first } }),
    ).toBeNull();
  });

  it('rejects endpoints outside the push services', async () => {
    for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/fcm/send/x']) {
      const response = await subscribe(anna, endpoint);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'PUSH_ENDPOINT_NOT_ALLOWED' });
    }
  });

  it('rejects malformed device keys', async () => {
    const response = await env.inject('POST', subscriptionsPath, anna, {
      endpoint: pushEndpoint(),
      keys: { p256dh: 'abc', auth: deviceKeys.auth },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'POST',
      url: subscriptionsPath,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: { endpoint: pushEndpoint(), keys: deviceKeys },
    });
    expect(response.statusCode).toBe(403);
  });

  it('deletes only own devices and switches the channel off with the last one', async () => {
    const view = (await subscribe(anna)).json<View>();
    const deviceId = view.devices[0]!.id;

    expect((await env.inject('DELETE', `${subscriptionsPath}/${deviceId}`, boris)).statusCode).toBe(
      204,
    );
    expect(await env.prisma.pushSubscription.count({ where: { id: deviceId } })).toBe(1);

    expect((await env.inject('DELETE', `${subscriptionsPath}/${deviceId}`, anna)).statusCode).toBe(
      204,
    );
    const after = (await env.inject('GET', settingsPath, anna)).json<View>();
    expect(after.devices).toEqual([]);
    expect(after.enabled).toBe(false);
  });

  it('rejects a malformed device id', async () => {
    const response = await env.inject('DELETE', `${subscriptionsPath}/not-a-uuid`, anna);
    expect(response.statusCode).toBe(400);
  });
});

describe('push without VAPID on the server', () => {
  const bare = new FamilyTestApp();
  let carol: FamilyActor;

  beforeAll(async () => {
    await bare.start();
    carol = await bare.register();
  });

  afterAll(async () => {
    await bare.stop();
  });

  it('reports the channel as unavailable and refuses subscriptions', async () => {
    const view = await bare.inject('GET', settingsPath, carol);
    expect(view.json()).toMatchObject({ available: false, vapidPublicKey: null });
    const response = await bare.inject('POST', subscriptionsPath, carol, {
      endpoint: pushEndpoint(),
      keys: deviceKeys,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PUSH_UNAVAILABLE' });
  });
});
```

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/push-subscriptions.integration.test.ts`
Expected: FAIL (404: маршрутов ещё нет).

- [ ] **Step 3: Схемы запросов**

Файл `apps/api/src/push/push.schemas.ts`:

```ts
import { z } from 'zod';

import { MAX_ENDPOINT_LENGTH, isValidAuthSecret, isValidP256dh } from './push-endpoint.js';

/** PushSubscription.toJSON() without expirationTime; the host is checked by the service (422). */
export const createPushSubscriptionSchema = z
  .object({
    endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
    keys: z
      .object({
        p256dh: z.string().max(128).refine(isValidP256dh, { message: 'Неверный ключ устройства.' }),
        auth: z.string().max(64).refine(isValidAuthSecret, { message: 'Неверный ключ устройства.' }),
      })
      .strict(),
  })
  .strict();

export const updatePushSettingsSchema = z
  .object({
    enabled: z.boolean(),
    planOverdueEnabled: z.boolean(),
    calendarReminderEnabled: z.boolean(),
  })
  .strict();

export const pushSubscriptionIdSchema = z.string().uuid();

export type CreatePushSubscriptionInput = z.infer<typeof createPushSubscriptionSchema>;
export type UpdatePushSettingsInput = z.infer<typeof updatePushSettingsSchema>;
```

- [ ] **Step 4: Репозиторий**

Файл `apps/api/src/push/push.repository.ts`:

```ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type PushSettingValues = {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
};

export type StoredPushSetting = PushSettingValues & { id: string };

export type PushDeviceRow = {
  id: string;
  sessionId: string;
  label: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
};

export type PushSubscriptionData = {
  sessionId: string;
  p256dh: string;
  auth: string;
  applicationServerKey: string;
  label: string;
};

const SETTING_SELECT = {
  id: true,
  enabled: true,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
} as const;

/** A push device is usable only while the session it was created in is alive. */
export function activeSessionWhere(now: Date): Prisma.SessionWhereInput {
  return { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } };
}

/**
 * Push subscriptions (one per browser) and the PUSH channel settings. Endpoints and device keys
 * never reach audit values or API responses.
 */
export class PushRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findSetting(tx: Tx, userId: string): Promise<StoredPushSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'PUSH' } },
      select: SETTING_SELECT,
    });
  }

  /** The PUSH row never carries a digest or amounts. */
  upsertSetting(tx: Tx, userId: string, values: PushSettingValues): Promise<StoredPushSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'PUSH' } },
      create: {
        id: createUuidV7(),
        userId,
        channel: 'PUSH',
        digestFrequency: 'OFF',
        includeAmounts: false,
        ...values,
      },
      update: values,
      select: SETTING_SELECT,
    });
  }

  listActiveDevices(tx: Tx, userId: string, now: Date): Promise<PushDeviceRow[]> {
    return tx.pushSubscription.findMany({
      where: { userId, session: activeSessionWhere(now) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, sessionId: true, label: true, createdAt: true, lastSuccessAt: true },
    });
  }

  findByEndpoint(tx: Tx, endpoint: string) {
    return tx.pushSubscription.findUnique({
      where: { endpoint },
      select: { id: true, userId: true },
    });
  }

  findOwn(tx: Tx, userId: string, id: string) {
    return tx.pushSubscription.findFirst({ where: { id, userId }, select: { id: true } });
  }

  async create(
    tx: Tx,
    input: PushSubscriptionData & { userId: string; endpoint: string; now: Date },
  ): Promise<string> {
    const id = createUuidV7(input.now);
    await tx.pushSubscription.create({
      data: {
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        applicationServerKey: input.applicationServerKey,
        label: input.label,
      },
    });
    return id;
  }

  async update(tx: Tx, id: string, data: PushSubscriptionData): Promise<void> {
    await tx.pushSubscription.update({ where: { id }, data });
  }

  async remove(tx: Tx, id: string): Promise<void> {
    await tx.pushSubscription.deleteMany({ where: { id } });
  }

  async idsNewestFirst(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx.pushSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  count(tx: Tx, userId: string): Promise<number> {
    return tx.pushSubscription.count({ where: { userId } });
  }

  /** No devices left: the channel is switched off and its unsent pushes are cancelled. */
  async disableChannel(tx: Tx, userId: string): Promise<void> {
    await tx.notificationChannelSetting.updateMany({
      where: { userId, channel: 'PUSH' },
      data: { enabled: false },
    });
    await tx.notificationDelivery.updateMany({
      where: { userId, channel: 'PUSH', status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' },
    });
  }

  async audit(
    tx: Tx,
    userId: string,
    entry: {
      entityType: string;
      entityId: string;
      action: string;
      values?: Record<string, unknown>;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        ...(entry.values ? { newValues: entry.values as Prisma.InputJsonValue } : {}),
        source: 'API',
        requestId: entry.requestId ?? null,
      },
    });
  }
}
```

- [ ] **Step 5: Сервис**

Файл `apps/api/src/push/push.application.service.ts`:

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { deviceLabel } from './device-label.js';
import { isAllowedPushEndpoint } from './push-endpoint.js';
import type { CreatePushSubscriptionInput, UpdatePushSettingsInput } from './push.schemas.js';
import type { PushRepository, PushSettingValues } from './push.repository.js';

type Tx = Prisma.TransactionClient;
type Meta = { requestId?: string; userAgent?: string };

export const MAX_PUSH_DEVICES = 10;

export type PushDeviceView = {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  current: boolean;
};

export type PushSettingsView = {
  available: boolean;
  vapidPublicKey: string | null;
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: PushDeviceView[];
};

const DEFAULTS: PushSettingValues = {
  enabled: false,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
};

const ENDPOINT_MESSAGE = 'Этот адрес push-сервиса не поддерживается.';

/**
 * Push channel of the signed-in user: the device list (subscriptions bound to sessions) and the
 * per-type switches. Only devices of active sessions are shown or counted. The first device switches
 * the channel on, removing the last one switches it off.
 */
export class PushApplicationService {
  constructor(
    private readonly repository: PushRepository,
    private readonly vapidPublicKey: string | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get(userId: string, sessionId: string): Promise<PushSettingsView> {
    return this.repository.transaction((tx) => this.view(tx, userId, sessionId, this.clock()));
  }

  update(
    userId: string,
    sessionId: string,
    input: UpdatePushSettingsInput,
    meta: Meta,
  ): Promise<PushSettingsView> {
    return this.repository.transaction(async (tx) => {
      const now = this.clock();
      const devices = await this.repository.listActiveDevices(tx, userId, now);
      if (input.enabled && devices.length === 0) {
        throw new ConflictException({
          code: 'PUSH_NO_DEVICES',
          detail: 'Сначала включите уведомления на устройстве.',
        });
      }
      const saved = await this.repository.upsertSetting(tx, userId, input);
      await this.repository.audit(tx, userId, {
        entityType: 'notification_settings',
        entityId: saved.id,
        action: 'UPDATED',
        values: { channel: 'PUSH', ...input },
        ...this.requestIdOf(meta),
      });
      return this.view(tx, userId, sessionId, now);
    });
  }

  async subscribe(
    userId: string,
    sessionId: string,
    input: CreatePushSubscriptionInput,
    meta: Meta,
  ): Promise<PushSettingsView> {
    const vapidPublicKey = this.vapidPublicKey;
    if (!vapidPublicKey) {
      throw new ConflictException({
        code: 'PUSH_UNAVAILABLE',
        detail: 'Push-уведомления не настроены на сервере.',
      });
    }
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new UnprocessableEntityException({
        code: 'PUSH_ENDPOINT_NOT_ALLOWED',
        detail: ENDPOINT_MESSAGE,
        fieldErrors: [{ field: 'endpoint', message: ENDPOINT_MESSAGE, code: 'custom' }],
      });
    }
    return this.repository.transaction(async (tx) => {
      const now = this.clock();
      const data = {
        sessionId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        applicationServerKey: vapidPublicKey,
        label: deviceLabel(meta.userAgent),
      };
      const existing = await this.repository.findByEndpoint(tx, input.endpoint);
      if (existing && existing.userId === userId) {
        await this.repository.update(tx, existing.id, data);
      } else {
        if (existing) await this.removeDevice(tx, existing.userId, existing.id, 'replaced', meta);
        const id = await this.repository.create(tx, {
          ...data,
          userId,
          endpoint: input.endpoint,
          now,
        });
        await this.repository.audit(tx, userId, {
          entityType: 'push_subscription',
          entityId: id,
          action: 'PUSH_SUBSCRIBED',
          ...this.requestIdOf(meta),
        });
      }
      const ids = await this.repository.idsNewestFirst(tx, userId);
      for (const extra of ids.slice(MAX_PUSH_DEVICES)) {
        await this.removeDevice(tx, userId, extra, 'limit', meta);
      }
      const current = await this.repository.findSetting(tx, userId);
      await this.repository.upsertSetting(tx, userId, {
        enabled: true,
        planOverdueEnabled: current?.planOverdueEnabled ?? DEFAULTS.planOverdueEnabled,
        calendarReminderEnabled:
          current?.calendarReminderEnabled ?? DEFAULTS.calendarReminderEnabled,
      });
      return this.view(tx, userId, sessionId, now);
    });
  }

  unsubscribe(userId: string, subscriptionId: string, meta: Meta): Promise<void> {
    return this.repository.transaction(async (tx) => {
      const own = await this.repository.findOwn(tx, userId, subscriptionId);
      if (!own) return;
      await this.removeDevice(tx, userId, own.id, 'web', meta);
    });
  }

  /** Deletes one device of `ownerId`; without devices left the owner's channel is switched off. */
  private async removeDevice(
    tx: Tx,
    ownerId: string,
    subscriptionId: string,
    reason: 'web' | 'replaced' | 'limit',
    meta: Meta,
  ): Promise<void> {
    await this.repository.remove(tx, subscriptionId);
    await this.repository.audit(tx, ownerId, {
      entityType: 'push_subscription',
      entityId: subscriptionId,
      action: 'PUSH_UNSUBSCRIBED',
      values: { reason },
      ...this.requestIdOf(meta),
    });
    if ((await this.repository.count(tx, ownerId)) === 0) {
      await this.repository.disableChannel(tx, ownerId);
    }
  }

  private async view(
    tx: Tx,
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<PushSettingsView> {
    const setting = (await this.repository.findSetting(tx, userId)) ?? DEFAULTS;
    const devices = await this.repository.listActiveDevices(tx, userId, now);
    return {
      available: this.vapidPublicKey !== null,
      vapidPublicKey: this.vapidPublicKey,
      enabled: setting.enabled,
      planOverdueEnabled: setting.planOverdueEnabled,
      calendarReminderEnabled: setting.calendarReminderEnabled,
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt.toISOString(),
        lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
        current: device.sessionId === sessionId,
      })),
    };
  }

  private requestIdOf(meta: Meta): { requestId?: string } {
    return meta.requestId ? { requestId: meta.requestId } : {};
  }
}
```

- [ ] **Step 6: DTO для OpenAPI**

Файл `apps/api/src/push/push.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class PushDeviceResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, description: 'Браузер и система, например «Chrome, Android».' })
  label!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSuccessAt!: string | null;

  @ApiProperty({ type: Boolean, description: 'Устройство текущей сессии.' })
  current!: boolean;
}

export class PushNotificationSettingsResponse {
  @ApiProperty({ type: Boolean, description: 'VAPID настроен на сервере.' })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Публичный VAPID-ключ (base64url) для PushManager.subscribe; null без настройки.',
  })
  vapidPublicKey!: string | null;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Просроченный платёж.' })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Напоминание календаря.' })
  calendarReminderEnabled!: boolean;

  @ApiProperty({
    type: [PushDeviceResponse],
    description: 'Устройства активных сессий; адрес push-сервиса не отдаётся.',
  })
  devices!: PushDeviceResponse[];
}

export class UpdatePushNotificationSettingsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  calendarReminderEnabled!: boolean;
}

export class PushSubscriptionKeysRequest {
  @ApiProperty({ type: String, description: 'base64url, 65 байт, первый байт 0x04.' })
  p256dh!: string;

  @ApiProperty({ type: String, description: 'base64url, 16 байт.' })
  auth!: string;
}

export class CreatePushSubscriptionRequest {
  @ApiProperty({
    type: String,
    maxLength: 2048,
    description: 'https-адрес push-сервиса браузера (FCM, Mozilla, Apple, Microsoft).',
  })
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysRequest })
  keys!: PushSubscriptionKeysRequest;
}
```

- [ ] **Step 7: Контроллер**

Файл `apps/api/src/push/push.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PushApplicationService } from './push.application.service.js';
import {
  CreatePushSubscriptionRequest,
  PushNotificationSettingsResponse,
  UpdatePushNotificationSettingsRequest,
} from './push.dto.js';
import {
  createPushSubscriptionSchema,
  pushSubscriptionIdSchema,
  updatePushSettingsSchema,
  type CreatePushSubscriptionInput,
  type UpdatePushSettingsInput,
} from './push.schemas.js';

const metaOf = (request: AuthenticatedRequest) => {
  const meta = requestMeta(request);
  return {
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
  };
};

@ApiTags('notification-settings')
@Controller()
export class PushController {
  constructor(
    @Inject(PushApplicationService)
    private readonly service: PushApplicationService,
  ) {}

  @Get('me/notification-settings/push')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки push-уведомлений',
    description:
      'Настройки текущего пользователя (по умолчанию выключено, оба типа включены), публичный VAPID-ключ и устройства активных сессий. Коды: 401.',
  })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    const context = requiredContext(request);
    return this.service.get(context.userId, context.sessionId);
  }

  @Put('me/notification-settings/push')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки push-уведомлений',
    description:
      'Главный переключатель и типы: просроченный платёж, напоминание календаря. Включить можно только с устройством. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 PUSH_NO_DEVICES.',
  })
  @ApiBody({ type: UpdatePushNotificationSettingsRequest })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updatePushSettingsSchema)) input: UpdatePushSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = requiredContext(request);
    return this.service.update(context.userId, context.sessionId, input, metaOf(request));
  }

  @Post('me/push/subscriptions')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Подключить это устройство к push-уведомлениям',
    description:
      'Сохраняет подписку браузера для текущей сессии и включает канал. Тот же адрес у другого пользователя переходит к текущему. Не больше 10 устройств: лишние, самые старые, удаляются. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 PUSH_UNAVAILABLE, 422 PUSH_ENDPOINT_NOT_ALLOWED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: CreatePushSubscriptionRequest })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  subscribe(
    @Body(new ZodValidationPipe(createPushSubscriptionSchema)) input: CreatePushSubscriptionInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = requiredContext(request);
    return this.service.subscribe(context.userId, context.sessionId, input, metaOf(request));
  }

  @Delete('me/push/subscriptions/:subscriptionId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отключить устройство от push-уведомлений',
    description:
      'Удаляет своё устройство; последнее устройство выключает канал. Чужое или несуществующее — тоже 204. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID.',
  })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async remove(
    @Param('subscriptionId', new ZodValidationPipe(pushSubscriptionIdSchema))
    subscriptionId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.unsubscribe(requiredContext(request).userId, subscriptionId, metaOf(request));
  }
}
```

- [ ] **Step 8: Модуль и регистрация**

Файл `apps/api/src/push/push.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { PushApplicationService } from './push.application.service.js';
import { PushController } from './push.controller.js';
import { PushRepository } from './push.repository.js';

@Module({})
export class PushModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: PushModule,
      controllers: [PushController],
      providers: [
        {
          provide: PushRepository,
          useFactory: (prisma: PrismaService) => new PushRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: PushApplicationService,
          useFactory: (repository: PushRepository) =>
            new PushApplicationService(repository, config.push?.vapidPublicKey ?? null),
          inject: [PushRepository],
        },
      ],
    };
  }
}
```

В `apps/api/src/app.module.ts`:

1. После строки `import { TelegramModule } from './telegram/telegram.module.js';` добавить:

```ts
import { PushModule } from './push/push.module.js';
```

2. После строки `        TelegramModule.register(config),` добавить:

```ts
        PushModule.register(config),
```

- [ ] **Step 9: Ограничение частоты**

В `apps/api/src/auth/auth-rate-limit.guard.ts` в методе `maximumFor` после блока

```ts
    if (url.startsWith('/api/v1/me/telegram/link') && method === 'POST')
      return this.config.rateLimit.loginMax;
```

добавить:

```ts
    if (url.startsWith('/api/v1/me/push/subscriptions') && method === 'POST')
      return this.config.rateLimit.loginMax;
```

- [ ] **Step 10: Тест проходит**

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/push-subscriptions.integration.test.ts`
Expected: PASS (14 тестов).

Если `di-explicit-inject.test.ts` в юнитах требует `@Inject` у параметров конструктора, он уже соблюдён: у контроллера `@Inject(PushApplicationService)`, сервисы создаются фабриками.

- [ ] **Step 11: OpenAPI**

```bash
node scripts/openapi/generate.mjs
pnpm exec prettier --write openapi.json
node scripts/openapi/check.mjs openapi.json
```

Expected: в `openapi.json` появились пути `/api/v1/me/notification-settings/push` (get, put), `/api/v1/me/push/subscriptions` (post) и `/api/v1/me/push/subscriptions/{subscriptionId}` (delete). `check.mjs` без строк `lint:`.

- [ ] **Step 12: Прогнать проверки**

Run: `pnpm --filter @harmofin/api test`
Expected: PASS.

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/api/src/push apps/api/src/app.module.ts apps/api/src/auth/auth-rate-limit.guard.ts apps/api/test/helpers/push.ts apps/api/test/push-subscriptions.integration.test.ts`
Если prettier что-то поменял — повторить интеграционный тест шага 10.

Run: `pnpm test:integration`
Expected: PASS (весь набор).

- [ ] **Step 13: Review по чек-листу**

```bash
git add apps/api/src/push apps/api/src/app.module.ts apps/api/src/auth/auth-rate-limit.guard.ts apps/api/test/helpers/push.ts apps/api/test/push-subscriptions.integration.test.ts openapi.json
git diff --staged
```

Чек-лист:

- security:
  - все запросы фильтруют `userId` из сессии, чужой `DELETE` ничего не удаляет;
  - endpoint не попадает в ответы и аудит; хост проверяется до транзакции;
  - устройство привязано к `sessionId` текущей сессии;
  - устройства неактивных сессий не показываются и не считаются;
  - CSRF на `PUT`, `POST`, `DELETE`; ограничение частоты на `POST`.
- API:
  - все коды ошибок перечислены в `description` и `@ApiResponse`;
  - `POST` отвечает 200 и полным видом настроек;
  - `DELETE` отвечает 204;
  - изменения OpenAPI только аддитивные.
- backend: всё в одной транзакции; строка `PUSH` создаётся с `digestFrequency: 'OFF'`; последняя подписка выключает канал и отменяет `PENDING`.
- QA: тесты покрывают значения по умолчанию, 409/422/400/403, перепривязку, переход endpoint, лимит 10, отозванную сессию и сервер без VAPID.
- final: только файлы из списка Files.

- [ ] **Step 14: Commit**

```bash
git branch --show-current
git commit -m "feat(push): подписки устройств и настройки канала в API"
```

Строку в «Ход выполнения» — как в README.
