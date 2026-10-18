# HarmoFin как устанавливаемое PWA — дизайн

Дата: 2026-10-18. Статус: утверждён владельцем в чате.

## Зачем

Личный бюджет ведут с телефона, мобильного приложения нет. Цель — чтобы `apps/web` можно было
установить на главный экран (Chrome/Android, Safari/iOS) и открыть как отдельное окно, с ярлыком
«Добавить расход» на быстрый ввод. Это не офлайн-режим: офлайн-ввод операций отложен, потому что
требует idempotency и серверного подтверждения.

## Не входит в задачу

- Офлайн-ввод и очередь операций, background sync, push-уведомления.
- Кэширование любых ответов `/api/*` и HTML-страниц с данными бюджета.
- Precache сборки Nuxt (`/_nuxt/*`) и новые зависимости (`@vite-pwa/nuxt`, Workbox).

## Решения

1. **Свой manifest и service worker без зависимостей.** Статический
   `apps/web/public/manifest.webmanifest` и рукописный `apps/web/public/sw.js`. Полный контроль над тем,
   что попадает в Cache Storage.
2. **Manifest:** `name` «HarmoFin — семейный бюджет», `short_name` «HarmoFin», `lang: ru`, `dir: ltr`,
   `id: /app`, `start_url: /app`, `scope: /`, `display: standalone`,
   `theme_color` и `background_color` — `#F7F9FA` (фон страницы, `--hf-color-page-background`).
   Иконки: `icon-192.png` и `icon-512.png` (`purpose: any`), `icon-maskable-512.png` (`purpose: maskable`).
   Ярлык: `name` «Добавить расход», `url` `/app?entry=expense`, иконка `icon-192.png`.
3. **Head (`nuxt.config.ts`):** `<link rel="manifest">`, `<link rel="apple-touch-icon">` (180 px),
   `<meta name="theme-color">` в двух вариантах через `media`: светлая тема `#F7F9FA`, тёмная `#0B1524`
   (тёмный `--hf-color-slate-50`), `apple-mobile-web-app-title` «HarmoFin». Шапка окна сливается с фоном
   страницы — без цветной полосы, по Calm Fintech.
4. **Иконка:** существующий глиф «H» из favicon, но на бренд-цвете Teal `#1BA39C` вместо устаревшего
   `#0A7F60`; favicon перекрашивается так же. PNG рисует скрипт `apps/web/scripts/generate-pwa-icons.mjs`
   (только `node:zlib`, сглаживание supersampling), результат коммитится в `apps/web/public/icons/`.
   Maskable-вариант: фон залит до краёв, глиф внутри безопасной зоны 80 %.
5. **Service worker:**
   - `install`: кладёт в кэш `harmofin-shell-v1` только `/offline.html` (иконки браузер загружает сам); `skipWaiting`.
   - `activate`: удаляет кэши с префиксом `harmofin-`, кроме текущего; `clients.claim`.
   - `fetch`: обрабатывает только `GET`-навигации (`request.mode === 'navigate'`) своего origin вне
     `/api/`: сначала сеть, при сетевой ошибке — кэшированный `/offline.html`. Ответы сети не кэшируются.
     Остальные запросы (включая `/api/*`, `/_nuxt/*`, шрифты) SW не перехватывает.
6. **Регистрация:** клиентский плагин `apps/web/app/plugins/service-worker.client.ts` вызывает
   `navigator.serviceWorker.register('/sw.js', { scope: '/' })` только в production-сборке и только если
   API поддерживается. Ошибка регистрации не ломает приложение.
7. **Офлайн-страница** `apps/web/public/offline.html`: самодостаточная, стили встроены (значения из токенов),
   светлая/тёмная тема по `prefers-color-scheme`. Заголовок «Нет подключения к интернету», пояснение, что
   данные бюджета без сети недоступны и ничего не сохранено, кнопка «Повторить» (перезагрузка). Никаких
   финансовых данных.
8. **Ярлык «Добавить расход»:** `AppOperationDialogs` при монтировании видит `route.query.entry === 'expense'`,
   вызывает `openOperation('EXPENSE')` и убирает параметр из URL через `navigateTo(..., { replace: true })`,
   чтобы перезагрузка не открывала диалог повторно. Ограничение: без сессии middleware ведёт на `/login`,
   и после входа диалог сам не открывается — пользователь попадает на `/app`.

## Безопасность и данные

SW не видит и не хранит ответы API, cookies сессии не затрагиваются, `localStorage` не используется. Кэш
содержит только статические публичные файлы. Изменения Caddy не нужны: браузер проверяет обновление
`sw.js` в обход HTTP-кэша (`updateViaCache: 'imports'` по умолчанию).

## Проверка

- Vitest: manifest (обязательные поля, файлы иконок существуют, размеры по IHDR, maskable, ярлык);
  `sw.js` в фейковом SW-окружении (allowlist кэша, `/api` и не-навигации не перехватываются, офлайн-заглушка
  при сетевой ошибке, ответы не кэшируются, очистка старых кэшей); плагин не регистрирует SW в dev;
  открытие диалога расхода по `?entry=expense` и очистка параметра.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Installability: production-сборка на localhost во встроенном браузере — manifest без ошибок, SW
  активирован (с разрешения владельца; локальный Playwright не запускается).
- E2E-сценарий для CI не добавляется: поведение покрыто unit-тестами.
