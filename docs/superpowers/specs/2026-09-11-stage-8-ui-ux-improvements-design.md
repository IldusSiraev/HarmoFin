# Дизайн Stage 8: UI/UX improvements

**Версия:** 1.0  
**Дата:** 11.09.2026  
**Статус:** черновик для согласования

## Визуальная концепция

### Предметная область

HarmoFin — приложение для управления семейным бюджетом с концепцией **envelope budgeting**. Пользователь разделяет физическое расположение денег (счета) и их назначение (конверты). Ключевые метафоры:

- **Конверты** — деньги имеют цель (groceries, rent, savings)
- **Счета** — физическое расположение (bank cards, cash)
- **Финансовые циклы** — не календарный месяц, а период между зарплатами
- **Распределение** — доход направляется в конверты по правилам

Целевая аудитория: семьи с нестабильным доходом, которым нужен контроль между выплатами зарплаты.

### Дизайнерское решение

#### Палитра

Финансы требуют доверия и спокойствия. Избегаем aggressive gradients и neon accents. Базовая палитра построена вокруг **teal** (океан, стабильность) и **navy** (глубина, надежность):

```
--surface-deepest: #0a0f16      /* Hero background, footer */
--surface-deep: #0d1b2a         /* Primary text, structural */
--surface-mid: #1e293b          /* Secondary text */
--surface-raised: #f8fafc       /* Page background */
--surface-card: #ffffff         /* Cards, modals */

--accent-teal: #1ba39c          /* Primary actions, links */
--accent-green: #22a06b         /* Income, positive flow */
--accent-amber: #d97706         /* Warnings, low balance */
--accent-navy: #2c5b8a          /* Info, structural accent */
```

**Signature color**: Teal используется экономно — только для primary actions и ключевых links. Green для income, amber для warnings. Navy для структурных элементов (borders, dividers).

#### Типографика

```
Display:  Inter 700, -0.04em, clamp(2.5rem, 6vw, 4.5rem)
Headline: Inter 600, -0.02em, clamp(1.5rem, 4vw, 2.25rem)
Body:     Inter 400, 1.6lh, 1rem
Label:    Inter 600, 0.875rem, 0.05em uppercase
Money:    SF Mono / Consolas, tabular-nums
```

**Ключевое решение**: Money amounts используют monospace font с `font-feature-settings: "tnum"` (tabular numbers) для alignment в таблицах. Это единственный случай использования mono font в интерфейсе.

#### Layout

**Landing**: single-column flow с centered content, max-width 70rem. Hero с wordmark, tagline, CTA. Features grid (3→1 колонка на mobile). Showcase секция со скриншотом. Final CTA.

**App shell**: sticky header + main content. Header с horizontal nav (desktop) или hamburger (mobile). Main content max-width 70rem, centered.

**Dashboard**: CSS Grid с responsive columns (2→1 на mobile). Total money card spanning 2 columns для emphasis. Остальные cards в grid flow.

```
┌──────────────┬──────────────┐
│ Total Money  │              │  ← hero card, 2 cols
├──────────────┼──────────────┤
│ Period Limit │ Obligations  │
├──────────────┼──────────────┤
│ Accounts     │ Envelopes    │
└──────────────┴──────────────┘

Mobile:
┌──────────────┐
│ Total Money  │
├──────────────┤
│ Period Limit │
├──────────────┤
│ Obligations  │
├──────────────┤
│ Accounts     │
├──────────────┤
│ Envelopes    │
└──────────────┘
```

#### Signature element

**Envelope illustration** на landing hero. CSS-only (без JavaScript), анимированная при page load. Три конверта разных цветов (teal, green, navy) с видимыми краями денег внутри. Один конверт "открывается" (rotation transform) показывая money inside.

Это единственный декоративный элемент. Остальной дизайн — чистая функциональность.

## Компонентная архитектура

### Landing components

```
apps/web/app/components/landing/
├── HeroSection.vue          # Wordmark, tagline, CTA, envelope illustration
├── FeaturesGrid.vue         # 3 feature cards
├── FeatureCard.vue          # Reusable feature card
├── ShowcaseSection.vue      # Dashboard screenshot с annotation
├── FinalCTA.vue             # Bottom CTA
└── EnvelopeIllustration.vue # CSS-only animated envelopes
```

**HeroSection**:
- Background: subtle gradient `linear-gradient(180deg, #f8fafc 0%, #f2f4f7 100%)`
- Wordmark: Inter 700, 3rem, navy
- Tagline: Inter 400, 1.25rem, slate-600, max-width 32rem
- CTA buttons: primary (teal) + secondary (outline)
- Envelope illustration positioned absolute, right side (desktop) или below (mobile)

**FeaturesGrid**:
- CSS Grid, `grid-template-columns: repeat(3, 1fr)` → `1fr` на mobile
- Gap: `var(--hf-space-8)`
- Each card: icon (CSS-only), title (Inter 600, 1.5rem), description (Inter 400, 1rem, slate-600)

**ShowcaseSection**:
- Background: `var(--surface-deepest)`
- Screenshot: border-radius `var(--hf-card-radius)`, box-shadow elevated
- Annotation: positioned labels pointing to key UI elements

### App shell components

```
apps/web/app/components/app/
├── AppHeader.vue            # Header с nav + user menu
├── AppNavigation.vue        # Horizontal nav links (desktop)
├── AppUserMenu.vue          # User dropdown (desktop)
├── AppMobileMenu.vue        # Slide-in menu (mobile)
└── AppMobileMenuButton.vue  # Hamburger button
```

**AppHeader**:
```vue
<header class="app-header">
  <AppMobileMenuButton @toggle="mobileMenuOpen = !mobileMenuOpen" />
  <NuxtLink to="/app" class="app-wordmark">HarmoFin</NuxtLink>
  <AppNavigation class="desktop-only" />
  <AppUserMenu class="desktop-only" />
</header>
<AppMobileMenu :open="mobileMenuOpen" @close="mobileMenuOpen = false" />
```

**AppNavigation**:
- Horizontal flex layout, gap `var(--hf-space-4)`
- Links: Inter 600, teal color, underline on hover
- Active link: border-bottom 2px solid teal

**AppUserMenu**:
- Button: email + chevron icon
- Dropdown: positioned absolute, z-index 100
- Items: Settings link, Logout button
- Backdrop: transparent overlay to close on outside click

**AppMobileMenu**:
- Fixed overlay: `position: fixed; inset: 0; background: var(--hf-color-overlay)`
- Slide-in panel: `position: fixed; top: 0; left: 0; height: 100%; width: 80%; max-width: 20rem`
- Transform: `translateX(-100%)` → `translateX(0)` when open
- Contains: nav links (vertical stack) + user info + logout button

### Dashboard components

```
apps/web/app/components/dashboard/
├── QuickActionBar.vue       # Quick actions: + Операция, + Перевод, Обновить
├── AddOperationModal.vue    # Simplified operation form
├── AddTransferModal.vue     # Simplified transfer form
├── DashboardSkeleton.vue    # Loading state
└── (existing components: BalanceList, PeriodLimitCard, UpcomingObligations)
```

**QuickActionBar**:
```vue
<div class="quick-actions">
  <UiButton variant="primary" @click="openOperationModal">+ Операция</UiButton>
  <UiButton variant="secondary" @click="openTransferModal">+ Перевод</UiButton>
  <UiButton variant="tertiary" @click="refresh">Обновить</UiButton>
</div>
```

**AddOperationModal**:
- Simplified form: type (income/expense), amount, account, category, envelope, date
- Optional fields hidden за "Показать больше" toggle
- Submit → POST /api/v1/budgets/:id/transactions
- Success → close modal, refresh dashboard

**DashboardSkeleton**:
- Skeleton cards matching dashboard-grid layout
- Animated pulse effect: `@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`

### Empty state improvements

**UiEmptyState** (existing component, enhanced):
```vue
<template>
  <div class="empty-state">
    <slot name="illustration">
      <!-- Default icon -->
    </slot>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <UiButton v-if="actionLabel" @click="$emit('action')">
      {{ actionLabel }}
    </UiButton>
  </div>
</template>
```

Empty state illustrations: CSS-only icons (не images, не SVG files):
- Operations: receipt icon (3 lines + checkmark)
- Accounts: credit card icon (rectangle + chip)
- Envelopes: envelope outline
- Plans: calendar icon

## Responsive strategy

### Breakpoints

```css
/* Mobile first */
.element { /* base: 375px+ */ }

@media (min-width: 768px) {
  .element { /* tablet */ }
}

@media (min-width: 1280px) {
  .element { /* desktop */ }
}
```

### Key responsive changes

**Header**:
- Mobile: hamburger + wordmark + (no nav)
- Desktop: wordmark + horizontal nav + user menu

**Dashboard grid**:
- Mobile: 1 column
- Desktop: 2 columns

**Forms**:
- Mobile: stacked inputs (1 column)
- Desktop: 2 column grid для related fields

**Tables**:
- Mobile: horizontal scroll или card view (зависит от table complexity)
- Desktop: full table

**Modals**:
- Mobile: full-screen (100vw, 100vh)
- Desktop: centered dialog (max-width 40rem)

**Touch targets**:
- Минимум 44x44px для buttons, links, form controls
- Gap между touch targets минимум 8px

## Accessibility

**Базовые требования** (advanced features не входят в Stage 8):

- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<button>`, `<a>`
- ARIA labels: `aria-label`, `aria-labelledby`, `aria-describedby` где нужно
- ARIA live regions: `aria-live="polite"` для dynamic content (loading states, alerts)
- Keyboard navigation: Tab, Shift+Tab, Enter, Escape работают
- Focus indicators: `outline` visible на `:focus-visible`
- Color contrast: минимум 4.5:1 для text, 3:1 для UI components
- Skip links: НЕ добавляем (оставляем для будущего этапа)

## Token additions

Добавить в `apps/web/app/assets/styles/tokens.css`:

```css
/* Gradients */
--hf-gradient-hero: linear-gradient(180deg, #f8fafc 0%, #f2f4f7 100%);

/* Additional colors */
--hf-color-warning-accent: #d97706;
--hf-color-surface-deepest: #0a0f16;

/* Typography */
--hf-font-family-mono: 'SF Mono', Consolas, 'Courier New', monospace;

/* Z-index scale */
--hf-z-index-dropdown: 100;
--hf-z-index-modal-backdrop: 200;
--hf-z-index-modal: 201;
--hf-z-index-mobile-menu: 300;

/* Transitions */
--hf-transition-fast: 150ms ease;
--hf-transition-base: 250ms ease;
```

## Testing strategy

### Playwright tests

**Landing**:
- Guest user видит landing на `/`
- CTA buttons работают (navigate to `/register`, `/login`)
- Authenticated user redirect на `/app` с `/`

**App header**:
- Navigation links работают
- User menu открывается/закрывается
- Mobile menu открывается/закрывается
- Logout работает

**Dashboard**:
- Quick actions buttons открывают modals
- Modals закрываются (X button, backdrop click, Escape)
- Forms в modals работают (create operation/transfer)

**Mobile**:
- Все tests прогоняются на mobile viewport (375x667)
- Touch targets минимум 44x44px (visual regression)

### Unit tests

- Landing components render correctly
- AppHeader показывает correct user email
- AppMobileMenu emits close event
- Empty states показывают action button when `actionLabel` prop provided

## Copy (placeholder text)

**Hero**:
- Tagline: "Управляйте семейным бюджетом с полным контролем. Конверты, циклы, планы — всё в одном месте."
- Primary CTA: "Начать бесплатно"
- Secondary CTA: "Войти"

**Features**:
1. **Конверты и счета**
   "Разделяйте, где лежат деньги и на что они предназначены. Полная прозрачность распределения бюджета."

2. **Финансовые циклы**
   "Планируйте между выплатами зарплаты, а не по календарному месяцу. Гибкие периоды под вашу ситуацию."

3. **Полный контроль**
   "Отслеживайте доходы, расходы, переводы. Аналитика, уведомления, экспорт — всё для осознанного управления финансами."

**Final CTA**:
- Headline: "Попробуйте HarmoFin бесплатно"
- Description: "Регистрация занимает меньше минуты. Без кредитных карт, без ограничений."
- CTA: "Создать аккаунт"

---

**Финальное замечание**: Весь дизайн построен вокруг ясности и доверия. Никаких gradient backgrounds с purple-to-pink, никаких glass morphism effects, никаких floating particles animations. Только чистая функциональность с deliberate использованием цвета для иерархии и направления внимания.
