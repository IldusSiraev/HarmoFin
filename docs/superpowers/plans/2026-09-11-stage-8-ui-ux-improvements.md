# План Stage 8: UI/UX improvements

**Версия:** 1.0  
**Дата:** 11.09.2026  
**Статус:** черновик для согласования

## Цель

Улучшить пользовательский опыт HarmoFin: создать информативную landing page для новых пользователей, обновить dashboard для аутентифицированных пользователей, добавить навигационную систему и оптимизировать mobile experience.

## Границы этапа

### Входит

- Landing page для неаутентифицированных пользователей с описанием возможностей
- Обновленный header с навигацией и user menu для всех app/* страниц
- Улучшенный dashboard (/app/index) с quick actions
- Mobile-friendly навигация (hamburger menu)
- Responsive improvements для существующих страниц
- Визуальные улучшения компонентов (cards, buttons, spacing)
- Empty states для списков без данных
- Loading states с skeleton screens

### Не входит

- Редизайн логотипа или полная rebrand
- Темная тема (dark mode)
- Анимации и transitions (кроме простых hover states)
- Internationalization (i18n)
- Onboarding tour или tooltips
- Keyboard shortcuts
- Advanced accessibility features (кроме базовых ARIA labels)

## Дизайнерское решение

### Палитра

Текущая teal-navy палитра сохраняется как основа. Добавляются акцентные цвета для визуальной иерархии:

- **Primary action**: `#1ba39c` (teal) — основные действия, links
- **Success accent**: `#22a06b` (green) — positive money flow, income
- **Warning accent**: `#d97706` (amber) — alerts, low balance warnings  
- **Surface gradient**: от `#f8fafc` к `#f2f4f7` — subtle depth на landing hero
- **Navy depth**: `#0d1b2a` → `#1e293b` → `#334155` — текст и structural elements

### Типографика

- **Display**: Inter 700, -0.04em tracking, clamp(2.5rem, 6vw, 4.5rem)
- **Headline**: Inter 600, -0.02em tracking, clamp(1.5rem, 4vw, 2.25rem)
- **Body**: Inter 400, 1.6 line-height, 1rem base
- **Label**: Inter 600, 0.875rem, 0.05em tracking uppercase для kickers
- **Mono**: 'SF Mono', Consolas, monospace для money amounts

### Layout concept

```
┌─────────────────────────────────────────┐
│ LANDING (index.vue для guest)           │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ HERO                                │ │
│ │ HarmoFin wordmark + tagline         │ │
│ │ Primary CTA: Начать → /register     │ │
│ │ Secondary: Войти → /login           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ FEATURES (3 columns → 1 на mobile)  │ │
│ │ • Конверты и счета                  │ │
│ │ • Финансовые циклы                  │ │
│ │ • Полный контроль                   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ SHOWCASE                            │ │
│ │ Скриншот dashboard с annotation     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ FINAL CTA                           │ │
│ │ Попробуйте бесплатно                │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ APP SHELL (все /app/* pages)            │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ HEADER                              │ │
│ │ [☰] HarmoFin | Nav links | [User ▾]│ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ CONTENT (page-specific)             │ │
│ │                                     │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘

Mobile: hamburger menu slides in from left
Desktop: horizontal nav + dropdown user menu
```

### Signature element

**Envelope visual metaphor**: На landing hero секции, небольшая анимированная иллюстрация конверта с деньгами (CSS-only, без JavaScript) — открывающийся envelope показывает categorized money inside. Цвета конвертов соответствуют категориям из приложения (teal, green, navy). Это единственный декоративный элемент, но он сразу объясняет core concept приложения.

## Задачи

### Task 1: Landing page для неаутентифицированных пользователей

**Scope**:
- Обновить `apps/web/app/pages/index.vue`:
  - Если пользователь НЕ аутентифицирован → показать landing
  - Если аутентифицирован → redirect на `/app`
- Создать `apps/web/app/components/landing/` с компонентами:
  - `HeroSection.vue` — hero с wordmark, tagline, CTA buttons
  - `FeaturesGrid.vue` — 3 feature cards (конверты, циклы, контроль)
  - `ShowcaseSection.vue` — скриншот dashboard с аннотацией
  - `FinalCTA.vue` — призыв к действию внизу страницы
- Добавить envelope illustration в hero (CSS-only)
- Responsive: mobile-first, stack на узких экранах

**Acceptance**:
- Landing видна на `/` для guest users
- Authenticated users redirect на `/app`
- Все CTA ведут на `/register` или `/login`
- Mobile responsive (breakpoint 768px)
- Проходит Playwright smoke test

---

### Task 2: App header с навигацией и user menu

**Scope**:
- Создать `apps/web/app/components/app/AppHeader.vue`:
  - Wordmark link → `/app`
  - Горизонтальная навигация (desktop): Операции, Счета, Конверты, Планы, Категории, Аналитика, Уведомления
  - User dropdown (desktop): email, Settings, Выйти
  - Hamburger button (mobile) → открывает slide-in menu
- Создать `apps/web/app/components/app/AppMobileMenu.vue`:
  - Slide-in menu с overlay
  - Навигация + user info + logout
- Обновить `apps/web/app/pages/app/index.vue`:
  - Убрать встроенный header
  - Использовать `<AppHeader />`
- Создать layout wrapper `apps/web/app/layouts/app.vue`:
  - `<AppHeader />` + `<slot />` для content
- Применить layout ко всем `/app/*` pages через `definePageMeta({ layout: 'app' })`

**Acceptance**:
- Header отображается на всех `/app/*` страницах
- Навигация работает (active link highlight)
- User dropdown открывается/закрывается
- Mobile menu работает с overlay
- Logout перенаправляет на `/login`
- Keyboard accessible (Tab, Enter, Escape)

---

### Task 3: Улучшенный dashboard с quick actions

**Scope**:
- Обновить `apps/web/app/pages/app/index.vue`:
  - Добавить quick actions bar над dashboard-grid:
    - `+ Операция` → modal для быстрого добавления операции
    - `+ Перевод` → modal для transfer
    - `Обновить` → refresh summary
  - Улучшить layout dashboard-grid:
    - Total money card → hero-sized, spanning 2 columns
    - Period limit card + Upcoming obligations в row
    - Accounts list + Envelopes list в row
  - Добавить skeleton loading states вместо "Загрузка бюджета…"
- Создать `apps/web/app/components/dashboard/QuickActionBar.vue`
- Создать `apps/web/app/components/dashboard/AddOperationModal.vue` (упрощенная форма)
- Создать `apps/web/app/components/dashboard/AddTransferModal.vue` (упрощенная форма)

**Acceptance**:
- Quick actions bar отображается над dashboard
- Modals открываются/закрываются
- Skeleton loading states показываются при загрузке
- Dashboard responsive (grid → single column на mobile)
- Forms работают и создают operations/transfers

---

### Task 4: Empty states для списков

**Scope**:
- Обновить `apps/web/app/components/ui/EmptyState.vue`:
  - Добавить prop `actionLabel` и `@action` event
  - Добавить illustration slot (optional)
- Добавить empty states в:
  - `/app/operations` — "Операции ещё не добавлены"
  - `/app/accounts` — "Счета не настроены"
  - `/app/envelopes` — "Конверты не созданы"
  - `/app/plans` — "Планы не настроены"
  - `/app/transfers` — "Переводы отсутствуют"
  - `/app/notifications` — "Уведомлений нет"
- Каждый empty state с кнопкой действия (+ Добавить, + Создать)

**Acceptance**:
- Empty states показываются когда списки пусты
- Action buttons открывают соответствующие формы/modals
- Illustrations (optional, CSS-only icons)
- Не показываются во время loading

---

### Task 5: Mobile responsive improvements

**Scope**:
- Audit всех `/app/*` pages на mobile (375px, 768px breakpoints)
- Fixes:
  - Forms: stack inputs vertically на mobile
  - Tables: horizontal scroll или card view на mobile
  - Modals: full-screen на mobile
  - Spacing: уменьшить padding на узких экранах
  - Touch targets: минимум 44x44px для buttons/links
- Обновить CSS с mobile-first approach:
  ```css
  /* Base: mobile */
  .element { ... }
  
  /* Desktop */
  @media (min-width: 768px) {
    .element { ... }
  }
  ```

**Acceptance**:
- Все страницы usable на 375px width
- Touch targets минимум 44x44px
- Horizontal scroll только где нужно (tables)
- Modals full-screen на mobile
- Playwright mobile viewport tests проходят

---

### Task 6: Visual polish

**Scope**:
- Обновить `apps/web/app/assets/styles/tokens.css`:
  - Добавить gradient tokens для hero background
  - Добавить warning accent `--hf-color-warning-accent: #d97706`
  - Добавить mono font family для money
- Card improvements:
  - Добавить subtle border: `1px solid var(--hf-color-border)`
  - Hover state: slight shadow lift
- Button improvements:
  - Добавить focus-visible styles (outline вместо box-shadow)
  - Consistent height и padding
- Spacing consistency:
  - Audit всех pages на consistent spacing (multiples of --hf-space-*)
- Typography:
  - Money amounts используют mono font
  - Consistent heading hierarchy (h1, h2, h3)

**Acceptance**:
- Visual consistency на всех pages
- Hover states на interactive elements
- Focus indicators видимы
- Money amounts monospaced
- Spacing uniform (базируется на tokens)

---

## Критерии приемки Stage 8

- [ ] Landing page показывается неаутентифицированным пользователям на `/`
- [ ] App header с навигацией на всех `/app/*` pages
- [ ] Mobile menu работает с hamburger button
- [ ] Dashboard с quick actions и улучшенным layout
- [ ] Empty states на всех list pages
- [ ] Все pages responsive (375px, 768px, 1280px)
- [ ] Touch targets минимум 44x44px
- [ ] Visual consistency (spacing, colors, typography)
- [ ] Проходят Playwright tests (desktop + mobile viewports)
- [ ] Vue lint warnings НЕ увеличились
- [ ] CI проходит

## Риски

1. **Landing content** — нужен реальный copy (tagline, feature descriptions). Сейчас будет placeholder text.
2. **Envelope illustration** — CSS-only может быть слишком сложным. Fallback: простая icon.
3. **Quick action modals** — упрощенные формы могут не покрывать все edge cases. Нужно решить какие поля обязательны для MVP modal.
4. **Mobile tables** — некоторые таблицы слишком широкие. Может потребоваться card view на mobile вместо scroll.

## Зависимости

- Stage 1-7 завершены и merged в main
- Nuxt 4, Vue 3, existing auth system работают
- API endpoints для operations/transfers доступны

## Оценка

- Task 1 (Landing): 3-4 часа
- Task 2 (Header + navigation): 4-5 часов
- Task 3 (Dashboard improvements): 3-4 часа
- Task 4 (Empty states): 2-3 часа
- Task 5 (Mobile responsive): 3-4 часа
- Task 6 (Visual polish): 2-3 часа

**Итого**: 17-23 часа (3-4 рабочих дня)
