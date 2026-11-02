# Задача 2: API — конфиг и проверки

Перед началом: прочитать [README](README.md). Задача 1 закоммичена.

**Files:**
- Modify: `apps/api/src/config/env.ts` — `VAPID_PUBLIC_KEY`, поле `push`.
- Create: `apps/api/src/config/env.push.test.ts`
- Create: `apps/api/src/push/push-endpoint.ts`, `apps/api/src/push/push-endpoint.test.ts`
- Create: `apps/api/src/push/device-label.ts`, `apps/api/src/push/device-label.test.ts`

**Interfaces:**
- Consumes: ничего из других задач.
- Produces (использует задача 3):
  - `ApiConfig.push?: { vapidPublicKey: string }` — есть, только если задан `VAPID_PUBLIC_KEY`.
  - `isAllowedPushEndpoint(endpoint: string): boolean`, `isValidP256dh(value: string): boolean`, `isValidAuthSecret(value: string): boolean`, `MAX_ENDPOINT_LENGTH = 2048` из `push/push-endpoint.ts`.
  - `deviceLabel(userAgent: string | undefined): string` из `push/device-label.ts` — не длиннее 80 символов.

---

- [ ] **Step 1: Тест конфига (падает)**

Файл `apps/api/src/config/env.push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};

// 65 bytes: 0x04 followed by 64 bytes, base64url without padding (87 characters).
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');

describe('loadApiConfig push', () => {
  it('leaves push out without a key or with an empty key', () => {
    expect(loadApiConfig(base).push).toBeUndefined();
    expect(loadApiConfig({ ...base, VAPID_PUBLIC_KEY: '' }).push).toBeUndefined();
  });

  it('maps a valid public key', () => {
    expect(loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey }).push).toEqual({
      vapidPublicKey: publicKey,
    });
  });

  it('rejects a key of the wrong length or point format', () => {
    expect(() => loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey.slice(1) })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
    const compressed = Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 7)]).toString(
      'base64url',
    );
    expect(() => loadApiConfig({ ...base, VAPID_PUBLIC_KEY: compressed })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
  });

  it('never accepts the private key variable name as a config field', () => {
    const config = loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: 'x' });
    expect(JSON.stringify(config)).not.toContain('"x"');
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/config/env.push.test.ts`
Expected: FAIL (`push` всегда `undefined`, ошибки не бросаются).

- [ ] **Step 2: Конфиг**

В `apps/api/src/config/env.ts`:

1. В `apiEnvironmentSchema` после строки `TELEGRAM_API_BASE_URL: httpUrl.default('https://api.telegram.org'),` добавить:

```ts
  // Public VAPID key only: the private key lives in the worker and never reaches the API.
  VAPID_PUBLIC_KEY: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{87}$/)
        .refine((value) => Buffer.from(value, 'base64url')[0] === 4, {
          message: 'must be an uncompressed P-256 public key',
        })
        .optional(),
    ),
```

2. В `interface ApiConfig` после строки `telegram?: ApiTelegramConfig;` добавить:

```ts
  /** Present only when VAPID_PUBLIC_KEY is set; the client gets this key from the API at runtime. */
  push?: { vapidPublicKey: string };
```

3. В `return { ... }` функции `loadApiConfig` после блока `...(missingTelegram.length === 0 ? { telegram: {...} } : {}),` (перед закрывающей `};`) добавить:

```ts
    ...(environment.VAPID_PUBLIC_KEY ? { push: { vapidPublicKey: environment.VAPID_PUBLIC_KEY } } : {}),
```

Run: `pnpm --filter @harmofin/api exec vitest run src/config/env.push.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 3: Тест проверок endpoint и ключей (падает)**

Файл `apps/api/src/push/push-endpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint, isValidAuthSecret, isValidP256dh } from './push-endpoint.js';

const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
const auth = Buffer.alloc(16, 2).toString('base64url');

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/send',
    'https://notfcm.googleapis.com/send',
    'https://127.0.0.1/push',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(2048)}`,
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('device keys', () => {
  it('accepts browser keys with and without padding', () => {
    expect(isValidP256dh(p256dh)).toBe(true);
    expect(isValidAuthSecret(auth)).toBe(true);
    expect(isValidAuthSecret(`${auth}==`)).toBe(true);
  });

  it('rejects keys of the wrong size, format or alphabet', () => {
    expect(isValidP256dh(p256dh.slice(4))).toBe(false);
    expect(
      isValidP256dh(Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 1)]).toString('base64url')),
    ).toBe(false);
    expect(isValidP256dh(`${p256dh.slice(1)}+`)).toBe(false);
    expect(isValidAuthSecret(Buffer.alloc(15, 2).toString('base64url'))).toBe(false);
    expect(isValidAuthSecret('')).toBe(false);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/push/push-endpoint.test.ts`
Expected: FAIL (`Cannot find module './push-endpoint.js'`).

- [ ] **Step 4: Проверки endpoint и ключей**

Файл `apps/api/src/push/push-endpoint.ts`:

```ts
// The worker posts to the stored endpoint, so only real push services are accepted: an arbitrary
// URL here would let a client make the worker send requests anywhere (SSRF).
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

export const MAX_ENDPOINT_LENGTH = 2048;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The device's ECDH public key: an uncompressed P-256 point (65 bytes, first byte 0x04). */
export function isValidP256dh(value: string): boolean {
  if (!BASE64URL.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 65 && bytes[0] === 4;
}

/** The device's authentication secret: 16 bytes. */
export function isValidAuthSecret(value: string): boolean {
  return BASE64URL.test(value) && Buffer.from(value, 'base64url').length === 16;
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/push/push-endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Тест подписи устройства (падает)**

Файл `apps/api/src/push/device-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { deviceLabel } from './device-label.js';

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome, Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari, iPhone',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Safari, iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox, Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge, Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36',
      'Яндекс Браузер, Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari, macOS',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome, Linux',
    ],
  ])('names %s', (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });

  it('falls back without a user agent', () => {
    expect(deviceLabel(undefined)).toBe('Браузер');
    expect(deviceLabel('curl/8.0')).toBe('Браузер');
  });

  it('never exceeds 80 characters', () => {
    expect(deviceLabel(`Chrome/1 Android ${'x'.repeat(500)}`).length).toBeLessThanOrEqual(80);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/push/device-label.test.ts`
Expected: FAIL (`Cannot find module './device-label.js'`).

- [ ] **Step 6: Подпись устройства**

Файл `apps/api/src/push/device-label.ts`:

```ts
// A short human name for a device ("Chrome, Android"). Only this label is stored, never the full
// User-Agent. Order matters: Edge, Opera and Yandex also say "Chrome"; Android also says "Linux";
// iPhone also says "Mac OS X".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/Edg(?:A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\/|(?:iPhone|iPad).*AppleWebKit\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const MAX_LABEL_LENGTH = 80;

function firstMatch(userAgent: string, table: ReadonlyArray<readonly [RegExp, string]>) {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function deviceLabel(userAgent: string | undefined): string {
  const value = userAgent ?? '';
  const browser = firstMatch(value, BROWSERS) ?? 'Браузер';
  const system = firstMatch(value, SYSTEMS);
  return (system ? `${browser}, ${system}` : browser).slice(0, MAX_LABEL_LENGTH);
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/push/device-label.test.ts`
Expected: PASS.

- [ ] **Step 7: Прогнать проверки**

Run: `pnpm --filter @harmofin/api test`
Expected: PASS (все юниты API, включая `env.telegram.test.ts`).

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/api/src/config/env.ts apps/api/src/config/env.push.test.ts apps/api/src/push`
Затем снова `pnpm --filter @harmofin/api exec vitest run src/config/env.push.test.ts src/push` — PASS.

- [ ] **Step 8: Review по чек-листу**

```bash
git add apps/api/src/config/env.ts apps/api/src/config/env.push.test.ts apps/api/src/push
git diff --staged
```

Чек-лист:

- security: в API нет `VAPID_PRIVATE_KEY`; endpoint принимается только `https` без порта и учётных данных; проверка хоста по суффиксу с точкой (`notfcm.googleapis.com` отклоняется); полный `User-Agent` никуда не сохраняется.
- API: конфиг без ключа даёт `push: undefined`; ошибка конфига называет переменную, но не значение.
- QA: тесты покрывают допустимые и недопустимые хосты, длину, ключи с паддингом и без, подписи основных браузеров.
- final: только файлы из списка Files.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git commit -m "feat(push): конфиг VAPID в API и проверки подписки"
```

Строку в «Ход выполнения» — как в README.
