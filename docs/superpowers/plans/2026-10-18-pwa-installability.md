# HarmoFin PWA installability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/web` an installable PWA (manifest, icons, minimal service worker, offline fallback, «Добавить расход» shortcut).

**Architecture:** Static `public/manifest.webmanifest`, hand-written `public/sw.js` (navigation-only offline fallback, no response caching), client plugin that registers the SW in production, query-param hook in `AppOperationDialogs` for the shortcut. PNG icons come from a dependency-free generator script.

**Tech Stack:** Nuxt 4, Vue 3.5, Vitest + happy-dom, Node 24 (`node:zlib` incl. `zlib.crc32`).

**Spec:** [docs/superpowers/specs/2026-10-18-pwa-installability-design.md](../specs/2026-10-18-pwa-installability-design.md)

## Global Constraints

- No new dependencies. No caching of `/api/*` or any network response; Cache Storage holds only `/offline.html`.
- Colors: page background `#F7F9FA` (light), `#0B1524` (dark); brand Teal `#1BA39C`; navy text `#0D1B2A`.
- UI text in Russian; code identifiers in English.
- Tests live outside `public/` (served as static files); Vitest includes `app/**`, `config/**`, `server/**`.
- Local Playwright is not run. No commit/push without owner approval.

---

### Task 1: Icons and favicon

**Files:**
- Create: `apps/web/scripts/generate-pwa-icons.mjs`
- Create (generated): `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180)
- Modify: `apps/web/public/favicon.svg` (fill `#0a7f60` → `#1ba39c`)

**Produces:** icon paths used by Task 2 manifest and head.

- [ ] Write generator: renders the favicon glyph (32-unit grid: rounded rect `rx=8`; capsules (10,8)–(10,24), (22,8)–(22,24), (10,16)–(22,16), half-width 1.5) with 4×4 supersampling; `any` icons have transparent rounded corners, `maskable`/apple are full-bleed squares with glyph scaled 0.8 around the center. Encodes RGBA PNG via `zlib.deflateSync` and `zlib.crc32`.
- [ ] Run `node apps/web/scripts/generate-pwa-icons.mjs`; open one PNG to inspect.
- [ ] Recolor favicon.

### Task 2: Manifest, offline page and head links

**Files:**
- Create: `apps/web/public/manifest.webmanifest`, `apps/web/public/offline.html`
- Modify: `apps/web/nuxt.config.ts` (`app.head.link`, `app.head.meta`)
- Test: `apps/web/app/pwa/manifest.test.ts`

- [ ] Failing test: parses manifest, asserts `start_url: '/app'`, `scope: '/'`, `display: 'standalone'`, `lang: 'ru'`, colors `#F7F9FA`, icons 192/512 `any` and 512 `maskable` exist with matching IHDR size (bytes 16–23), shortcut `{ name: 'Добавить расход', url: '/app?entry=expense' }`; offline page has `lang="ru"`, heading «Нет подключения к интернету», no external `<script src>`/`<link>`.
- [ ] Run `pnpm --filter @harmofin/web test -- app/pwa/manifest.test.ts` → FAIL.
- [ ] Add manifest and offline page per spec; head: `{ rel: 'manifest', href: '/manifest.webmanifest' }`, `{ rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }`; meta `theme-color` `#F7F9FA` (`media: '(prefers-color-scheme: light)'`) and `#0B1524` (`media: '(prefers-color-scheme: dark)'`), `apple-mobile-web-app-title: HarmoFin`, `mobile-web-app-capable: yes`.
- [ ] Run test → PASS.

### Task 3: Service worker and registration

**Files:**
- Create: `apps/web/public/sw.js`, `apps/web/app/pwa/register-service-worker.ts`, `apps/web/app/plugins/service-worker.client.ts`
- Test: `apps/web/app/pwa/sw.test.ts`, `apps/web/app/pwa/register-service-worker.test.ts`

**Produces:** `registerServiceWorker(options: { dev: boolean; container?: ServiceWorkerContainer }): Promise<void>`.

- [ ] Failing sw test: evaluate `public/sw.js` with fake `self`/`caches`/`fetch` (via `new Function`), capture listeners; assert install caches exactly `['/offline.html']`; activate deletes `harmofin-old` but keeps `harmofin-shell-v1` and foreign caches; fetch ignores `POST`, non-navigate, `/api/` navigations and other origins (no `respondWith`); navigation returns network response without `cache.put`; on network rejection returns cached offline page.
- [ ] Failing register test: `dev: true` → no `register`; missing container → no throw; production → `register('/sw.js', { scope: '/' })`; rejected `register` is swallowed.
- [ ] Implement `sw.js` (cache `harmofin-shell-v1`), helper and plugin (`registerServiceWorker({ dev: import.meta.dev, container: navigator.serviceWorker })`).
- [ ] Run tests → PASS.

### Task 4: «Добавить расход» shortcut

**Files:**
- Modify: `apps/web/app/components/app/AppOperationDialogs.vue`, `apps/web/app/test/nuxt-imports.ts` (`useRoute` gets `query: {}`)
- Test: `apps/web/app/components/app/AppOperationDialogs.test.ts`

- [ ] Failing test: with `useRoute` mocked to `{ path: '/app', query: { entry: 'expense', tab: 'x' } }`, mount → expense entry dialog open and `navigateTo({ path: '/app', query: { tab: 'x' } }, { replace: true })`; without the param → no dialog, no navigation.
- [ ] Implement `onMounted` hook.
- [ ] Run test → PASS.

### Task 5: Verification

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- [ ] `pnpm --filter @harmofin/web build`, run `.output/server/index.mjs` on localhost, check in the built-in browser: manifest parsed, SW `activated`, offline navigation shows the fallback. No Playwright.
- [ ] Inspect final diff; owner approves commit.
