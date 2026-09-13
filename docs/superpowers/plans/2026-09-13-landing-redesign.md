# Landing Redesign & Token Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить лендинг HarmoFin на 16-секционную маркетинговую страницу по новому ТЗ и перевести дизайн-токены проекта на палитру, типографику, радиусы и тени нового UI-кита.

**Architecture:** Один источник токенов (`tokens.css`) с сохранением семантических имён — значения меняются, 36 компонентов `/app` получают новую палитру без правок. Лендинг собирается из презентационных секций (`components/landing/sections/*`), которые получают демо-данные из единственного модуля `app/data/landing.ts` и используют общие примитивы (`components/landing/ui/*`, `components/ui/Button.vue`). Графика — только CSS/SVG, без `echarts` и растровых изображений.

**Tech Stack:** Nuxt 4.5.2, Vue 3.5.42 (`<script setup lang="ts">`), TypeScript strict, Vitest + happy-dom + @vue/test-utils, Playwright, `lucide-vue-next`, CSS custom properties (без CSS-фреймворка).

**Spec:** `docs/superpowers/specs/2026-09-13-landing-redesign-design.md` (исходники: `docs/superpowers/specs/ТЗ для агента — лендинг HarmoFin.md`, `identity/landing-temporar_design.png`, `identity/temporary_UI.png`)

## Global Constraints

- Node.js 24.20.0, pnpm 11.24.0 (`packageManager: pnpm@11.24.0`). Ветка работы: `feat/landing-redesign`.
- Команды: `pnpm --filter @harmofin/web test`, `pnpm --filter @harmofin/web lint`, `pnpm --filter @harmofin/web typecheck`, `pnpm --filter @harmofin/web build`, `pnpm format`, `pnpm test:e2e`.
- Prettier: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`. После правок запускать `pnpm format`.
- ESLint: `eslint.configs.recommended` + `typescript-eslint` + `vue/flat/recommended`; `@typescript-eslint/no-explicit-any: error`; `vue/multi-word-component-names: error` (кроме `index`) — имя каждого компонента из двух слов и указывается через `defineOptions({ name: '...' })`, как в существующих компонентах.
- TypeScript strict. Импорты локальных `.ts`-модулей в `.vue` — с расширением `.js` (как в `FinanceMoney.vue`: `import { formatMinorUnits } from './money-format.js'`).
- Тексты интерфейса — на русском, идентификаторы, имена файлов и коммиты — на английском.
- Деньги в демо-данных хранятся строками минорных единиц (копеек) и форматируются через `formatMinorUnits`; литералов сумм в шаблонах быть не должно.
- Цвета задаются только токенами `--hf-*`; хардкод hex в компонентах запрещён.
- Токены `--hf-color-*-bright` не используются как фон под белым текстом и не являются единственным носителем статуса.
- Анимации: 300–600 мс, `ease-out`, одноразовое появление; при `prefers-reduced-motion: reduce` — мгновенное конечное состояние.
- Один `<h1>` на странице (в Hero), заголовки секций — `<h2>`, заголовки карточек — `<h3>`.
- Playwright локально не запускаем — e2e идёт в CI.

---

### Task 1: Токены нового кита и чистка легаси-переменных

**Files:**
- Modify: `apps/web/app/assets/styles/tokens.css`
- Modify: `apps/web/app/components/auth/AuthForm.vue` (использует `--hf-color-brand-*`)
- Modify: `apps/web/app/components/analytics/ReportChart.vue:39-45` (хардкод `#d8ddd9`, `#33403a`, `#2f6e5a`)
- Create: `apps/web/app/assets/styles/tokens.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: токены `--hf-color-brand`, `--hf-color-brand-hover`, `--hf-color-brand-bright`, `--hf-color-brand-soft`, `--hf-color-action-primary`, `--hf-color-primary-bright`, `--hf-color-primary-soft`, `--hf-color-action-danger`, `--hf-color-status-danger-bright`, `--hf-color-status-warning-bright`, `--hf-color-text`, `--hf-color-text-muted`, `--hf-color-border`, `--hf-color-surface`, `--hf-color-page-background`, `--hf-radius-sm|md|lg|xl`, `--hf-shadow-xs|sm|md|lg|card`, `--hf-font-size-h1|h2|h3|body|small|caption|display`, `--hf-line-height-*`, `--hf-container-max`, `--hf-container-max-wide`. Все последующие задачи используют только их.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/assets/styles/tokens.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const tokensPath = fileURLToPath(new URL('./tokens.css', import.meta.url));
const appDir = fileURLToPath(new URL('../../', import.meta.url));
const tokens = readFileSync(tokensPath, 'utf8');

const requiredTokens = [
  ['--hf-color-brand', '#0a7f60'],
  ['--hf-color-brand-hover', '#086b51'],
  ['--hf-color-brand-bright', '#10b991'],
  ['--hf-color-brand-soft', '#e7f7f2'],
  ['--hf-color-action-primary', '#1d6fd6'],
  ['--hf-color-primary-bright', '#4f9cf9'],
  ['--hf-color-primary-soft', '#e6f2ff'],
  ['--hf-color-action-danger', '#dc2626'],
  ['--hf-color-status-danger-bright', '#ef4444'],
  ['--hf-color-status-warning-bright', '#f59e0b'],
  ['--hf-color-text', '#0f172a'],
  ['--hf-color-text-muted', '#64748b'],
  ['--hf-color-border', '#e2e8f0'],
  ['--hf-color-page-background', '#f8fafc'],
  ['--hf-color-surface', '#ffffff'],
];

const legacyTokens = [
  '--hf-color-brand-teal',
  '--hf-color-brand-navy',
  '--hf-color-brand-mint',
  '--hf-color-brand-green',
  '--hf-color-brand-blue',
  '--hf-color-teal-700',
  '--hf-color-teal-800',
  '--hf-color-teal-900',
];

function collectFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full, extensions);
    return extensions.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

describe('design tokens', () => {
  it.each(requiredTokens)('defines %s as %s', (name, value) => {
    expect(tokens.toLowerCase()).toContain(`${name}: ${value};`);
  });

  it('defines the kit radius scale', () => {
    expect(tokens).toContain('--hf-radius-sm: 0.25rem;');
    expect(tokens).toContain('--hf-radius-md: 0.5rem;');
    expect(tokens).toContain('--hf-radius-lg: 0.75rem;');
    expect(tokens).toContain('--hf-radius-xl: 1rem;');
  });

  it('defines the kit shadow scale and keeps the card alias', () => {
    for (const shadow of ['--hf-shadow-xs', '--hf-shadow-sm', '--hf-shadow-md', '--hf-shadow-lg']) {
      expect(tokens).toContain(`${shadow}:`);
    }
    expect(tokens).toContain('--hf-shadow-card: var(--hf-shadow-sm);');
  });

  it('defines the kit type scale', () => {
    for (const size of ['h1', 'h2', 'h3', 'body', 'small', 'caption', 'display']) {
      expect(tokens).toContain(`--hf-font-size-${size}:`);
    }
  });

  it('no longer references legacy brand variables anywhere in the app', () => {
    const files = collectFiles(appDir, ['.vue', '.css', '.ts']).filter(
      (file) => !file.endsWith('tokens.test.ts'),
    );
    const offenders = files.filter((file) => {
      const content = readFileSync(file, 'utf8');
      return legacyTokens.some((token) => content.includes(token));
    });

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- tokens.test.ts`
Expected: FAIL — токенов `--hf-color-brand` и шкал кита ещё нет, легаси-переменные встречаются в `tokens.css` и `AuthForm.vue`.

- [ ] **Step 3: Переписать `tokens.css`**

Заменить блок `:root` на новую систему (медиазапрос с компактными высотами контролов на `min-width: 1024px` оставить как есть):

```css
:root {
  /* palette */
  --hf-color-white: #ffffff;
  --hf-color-brand: #0a7f60;
  --hf-color-brand-hover: #086b51;
  --hf-color-brand-active: #065a44;
  --hf-color-brand-bright: #10b991;
  --hf-color-brand-soft: #e7f7f2;
  --hf-color-primary-bright: #4f9cf9;
  --hf-color-primary-soft: #e6f2ff;
  --hf-color-primary-strong: #1d6fd6;
  --hf-color-primary-strong-hover: #1a5fb8;
  --hf-color-danger-strong: #dc2626;
  --hf-color-danger-strong-hover: #b91c1c;
  --hf-color-danger-bright: #ef4444;
  --hf-color-danger-soft: #fef2f2;
  --hf-color-warning-bright: #f59e0b;
  --hf-color-warning-soft: #fffbeb;
  --hf-color-slate-900: #0f172a;
  --hf-color-slate-500: #64748b;
  --hf-color-slate-200: #e2e8f0;
  --hf-color-slate-50: #f8fafc;

  /* typography */
  --hf-font-family-sans: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --hf-font-weight-regular: 400;
  --hf-font-weight-medium: 500;
  --hf-font-weight-semibold: 600;
  --hf-font-weight-bold: 700;
  --hf-font-size-h1: clamp(2rem, 5vw, 3rem);
  --hf-line-height-h1: 1.16;
  --hf-font-size-h2: clamp(1.625rem, 3.5vw, 2rem);
  --hf-line-height-h2: 1.25;
  --hf-font-size-h3: 1.5rem;
  --hf-line-height-h3: 1.33;
  --hf-font-size-body: 1rem;
  --hf-line-height-body: 1.5;
  --hf-font-size-small: 0.875rem;
  --hf-line-height-small: 1.43;
  --hf-font-size-caption: 0.75rem;
  --hf-line-height-caption: 1.33;
  --hf-font-size-display: clamp(2.5rem, 7vw, 4rem);
  --hf-line-height-display: 1.1;

  /* spacing scale — без изменений */
  --hf-space-1: 0.25rem;
  --hf-space-2: 0.5rem;
  --hf-space-3: 0.75rem;
  --hf-space-4: 1rem;
  --hf-space-5: 1.25rem;
  --hf-space-6: 1.5rem;
  --hf-space-8: 2rem;
  --hf-space-10: 2.5rem;
  --hf-space-12: 3rem;
  --hf-space-16: 4rem;
  --hf-space-20: 5rem;
  --hf-space-24: 6rem;

  /* radii */
  --hf-radius-sm: 0.25rem;
  --hf-radius-md: 0.5rem;
  --hf-radius-lg: 0.75rem;
  --hf-radius-xl: 1rem;

  /* shadows */
  --hf-shadow-xs: 0 1px 2px rgb(15 23 42 / 6%);
  --hf-shadow-sm:
    0 1px 3px rgb(15 23 42 / 8%),
    0 1px 2px rgb(15 23 42 / 6%);
  --hf-shadow-md: 0 4px 12px rgb(15 23 42 / 8%);
  --hf-shadow-lg: 0 12px 32px rgb(15 23 42 / 12%);
  --hf-shadow-card: var(--hf-shadow-sm);

  /* layout */
  --hf-container-max: 75rem;
  --hf-container-max-wide: 80rem;
  --hf-control-height-sm: 2.75rem;
  --hf-control-height-md: 3rem;
  --hf-control-height-lg: 3.25rem;
  --hf-sidebar-width: 16rem;

  /* semantic roles */
  --hf-color-page-background: var(--hf-color-slate-50);
  --hf-color-surface: var(--hf-color-white);
  --hf-color-surface-subtle: var(--hf-color-slate-50);
  --hf-color-text: var(--hf-color-slate-900);
  --hf-color-text-muted: var(--hf-color-slate-500);
  --hf-color-text-subtle: var(--hf-color-slate-500);
  --hf-color-border: var(--hf-color-slate-200);
  --hf-color-border-strong: #94a3b8;
  --hf-color-focus-ring: var(--hf-color-primary-strong);
  --hf-color-focus-halo: var(--hf-color-white);
  --hf-focus-indicator:
    0 0 0 2px var(--hf-color-focus-halo),
    0 0 0 5px var(--hf-color-focus-ring);
  --hf-color-action-primary: var(--hf-color-primary-strong);
  --hf-color-action-primary-hover: var(--hf-color-primary-strong-hover);
  --hf-color-action-primary-active: #174f99;
  --hf-color-action-brand: var(--hf-color-brand);
  --hf-color-action-brand-hover: var(--hf-color-brand-hover);
  --hf-color-action-brand-active: var(--hf-color-brand-active);
  --hf-color-action-danger: var(--hf-color-danger-strong);
  --hf-color-action-danger-hover: var(--hf-color-danger-strong-hover);
  --hf-color-action-secondary-hover: var(--hf-color-slate-50);
  --hf-color-status-neutral: var(--hf-color-slate-500);
  --hf-color-status-neutral-background: var(--hf-color-slate-200);
  --hf-color-status-info: var(--hf-color-primary-strong);
  --hf-color-status-info-background: var(--hf-color-primary-soft);
  --hf-color-status-success: var(--hf-color-brand);
  --hf-color-status-success-background: var(--hf-color-brand-soft);
  --hf-color-status-warning: #92400e;
  --hf-color-status-warning-background: var(--hf-color-warning-soft);
  --hf-color-status-warning-bright: var(--hf-color-warning-bright);
  --hf-color-status-danger: var(--hf-color-danger-strong);
  --hf-color-status-danger-background: var(--hf-color-danger-soft);
  --hf-color-status-danger-bright: var(--hf-color-danger-bright);
  --hf-color-text-danger: var(--hf-color-danger-strong);
  --hf-color-border-danger: var(--hf-color-danger-strong);
  --hf-color-overlay: rgb(15 23 42 / 48%);
  --hf-z-index-tooltip: 150;
  --hf-tooltip-background: var(--hf-color-slate-900);
  --hf-tooltip-color: var(--hf-color-white);

  /* component tokens */
  --hf-button-font-weight: var(--hf-font-weight-semibold);
  --hf-button-radius: var(--hf-radius-md);
  --hf-button-padding-inline: var(--hf-space-5);
  --hf-control-radius: var(--hf-radius-md);
  --hf-control-padding-inline: var(--hf-space-3);
  --hf-card-radius: var(--hf-radius-lg);
  --hf-card-padding: var(--hf-space-6);

  --hf-transition-fast: 150ms ease;
  --hf-transition-base: 250ms ease;
}
```

Токены `--hf-color-brand`, `--hf-color-action-primary` и прочие, которые тест проверяет на точное значение, объявляются литеральным hex (как в блоке palette выше) — тест сверяет именно строки `--hf-color-brand: #0a7f60;`. Для `--hf-color-action-primary`, `--hf-color-action-danger`, `--hf-color-text`, `--hf-color-text-muted`, `--hf-color-border`, `--hf-color-page-background`, `--hf-color-surface`, `--hf-color-brand-bright`, `--hf-color-brand-soft`, `--hf-color-primary-bright`, `--hf-color-primary-soft`, `--hf-color-status-danger-bright`, `--hf-color-status-warning-bright` добавить в конец файла явный блок с литеральными значениями:

```css
:root {
  --hf-color-brand: #0a7f60;
  --hf-color-brand-hover: #086b51;
  --hf-color-brand-bright: #10b991;
  --hf-color-brand-soft: #e7f7f2;
  --hf-color-action-primary: #1d6fd6;
  --hf-color-primary-bright: #4f9cf9;
  --hf-color-primary-soft: #e6f2ff;
  --hf-color-action-danger: #dc2626;
  --hf-color-status-danger-bright: #ef4444;
  --hf-color-status-warning-bright: #f59e0b;
  --hf-color-text: #0f172a;
  --hf-color-text-muted: #64748b;
  --hf-color-border: #e2e8f0;
  --hf-color-page-background: #f8fafc;
  --hf-color-surface: #ffffff;
}
```

Этот блок идёт последним и перекрывает алиасы выше — так значения токенов видны в одном месте и не расходятся с тестом.

- [ ] **Step 4: Перевести `AuthForm.vue` и `ReportChart.vue` на семантические токены**

В `AuthForm.vue` заменить каждое использование `--hf-color-brand-navy` на `--hf-color-text`, `--hf-color-brand-teal` на `--hf-color-action-primary`, `--hf-color-brand-light` на `--hf-color-surface-subtle`.

В `ReportChart.vue` заменить хардкод на чтение токенов из вычисленных стилей документа:

```ts
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const chartColors = {
  grid: readToken('--hf-color-border', '#e2e8f0'),
  axis: readToken('--hf-color-text-muted', '#64748b'),
  bar: readToken('--hf-color-brand', '#0a7f60'),
};
```

и использовать `chartColors.grid`, `chartColors.axis`, `chartColors.bar` в опциях `xAxis.splitLine.lineStyle.color`, `yAxis.axisLabel.color`, `series.itemStyle.color`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS, включая существующий `ReportChart.test.ts`.

- [ ] **Step 6: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/assets/styles/tokens.css apps/web/app/assets/styles/tokens.test.ts apps/web/app/components/auth/AuthForm.vue apps/web/app/components/analytics/ReportChart.vue
git commit -m "feat(web): rebrand design tokens to the new HarmoFin kit"
```

---

### Task 2: `UiButton` — ссылочный режим и брендовый вариант

**Files:**
- Modify: `apps/web/app/components/ui/Button.vue`
- Create: `apps/web/app/components/ui/Button.test.ts`

**Interfaces:**
- Consumes: токены `--hf-color-action-brand*` (Task 1).
- Produces: `UiButton` с пропами `variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'brand'`, `to?: string`. При заданном `to` рендерится `NuxtLink` с тем же набором классов `ui-button ui-button--<variant> ui-button--<size>`; проп `type` в этом случае не выводится в DOM.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/ui/Button.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiButton from './Button.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('UiButton', () => {
  it('renders a button element by default', () => {
    const wrapper = mount(UiButton, { slots: { default: 'Сохранить' } });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.classes()).toContain('ui-button--primary');
  });

  it('renders a link when "to" is provided', () => {
    const wrapper = mount(UiButton, {
      props: { to: '/register', variant: 'brand', size: 'lg' },
      slots: { default: 'Начать бесплатно' },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    });

    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('/register');
    expect(link.classes()).toContain('ui-button--brand');
    expect(link.classes()).toContain('ui-button--lg');
    expect(link.attributes('type')).toBeUndefined();
    expect(link.text()).toBe('Начать бесплатно');
  });

  it('does not emit click when disabled', async () => {
    const wrapper = mount(UiButton, { props: { disabled: true }, slots: { default: 'Ок' } });

    await wrapper.trigger('click');

    expect(wrapper.emitted('click')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- Button.test.ts`
Expected: FAIL — проп `to` не объявлен, `ui-button--brand` не существует.

- [ ] **Step 3: Расширить компонент**

В `defineProps` добавить `to?: string | undefined` и расширить union `variant` значением `'brand'`; в `withDefaults` добавить `to: undefined`.

В шаблоне заменить корневой `<button>` на динамический элемент, сохранив все существующие атрибуты для кнопочного режима:

```vue
<component
  :is="to ? 'NuxtLink' : 'button'"
  v-bind="$attrs"
  class="ui-button"
  :class="[
    `ui-button--${variant}`,
    `ui-button--${size}`,
    { 'ui-button--full-width': fullWidth },
  ]"
  :to="to"
  :type="to ? undefined : type"
  :disabled="to ? undefined : disabled || loading"
  :aria-busy="loading || undefined"
  :aria-label="ariaLabel"
  :aria-describedby="describedby"
  @click="handleClick($event, loading, disabled)"
>
  <slot />
</component>
```

В `<style scoped>` добавить вариант, повторяющий структуру существующего `ui-button--primary`:

```css
.ui-button--brand {
  color: var(--hf-color-white);
  border: 1px solid var(--hf-color-action-brand);
  background: var(--hf-color-action-brand);
}

.ui-button--brand:hover:not(:disabled) {
  border-color: var(--hf-color-action-brand-hover);
  background: var(--hf-color-action-brand-hover);
}

.ui-button--brand:active:not(:disabled) {
  border-color: var(--hf-color-action-brand-active);
  background: var(--hf-color-action-brand-active);
}

.ui-button {
  text-decoration: none;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test -- Button.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/ui/Button.vue apps/web/app/components/ui/Button.test.ts
git commit -m "feat(web): support link mode and brand variant in UiButton"
```

---

### Task 3: Демонстрационные данные лендинга

**Files:**
- Create: `apps/web/app/data/landing.ts`
- Create: `apps/web/app/data/landing.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: типы `LandingBudgetSnapshot`, `LandingEnvelope`, `LandingAllocation`, `LandingGoal`, `LandingPlan`, `LandingCategoryShare`, `LandingCashFlowPoint`, `LandingStep`, `LandingFaqItem`, `LandingTextCard` и константы `heroBudget`, `heroEnvelopes`, `heroTrustPoints`, `problemCards`, `conceptAccounts`, `conceptEnvelopes`, `cycleMilestones`, `allocationData`, `goalData`, `upcomingPlans`, `variableIncome`, `analyticsData`, `howItWorksSteps`, `audienceCards`, `roadmapNow`, `roadmapNext`, `securityCards`, `faqItems`, `landingNavLinks`, `footerProductLinks`, `footerInfoLinks`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/data/landing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  allocationData,
  analyticsData,
  faqItems,
  goalData,
  heroBudget,
  howItWorksSteps,
  landingNavLinks,
  upcomingPlans,
  variableIncome,
} from './landing.js';

const toNumber = (minorUnits: string): number => Number(BigInt(minorUnits));

describe('landing demo data', () => {
  it('keeps every money value as an integer minor-unit string', () => {
    const values = [
      heroBudget.availableMinor,
      heroBudget.periodLimitMinor,
      heroBudget.spentMinor,
      heroBudget.dailyAverageMinor,
      allocationData.incomeMinor,
      upcomingPlans.reservedMinor,
      variableIncome.plannedMinor,
      ...allocationData.allocations.map((item) => item.amountMinor),
      ...goalData.flatMap((goal) => [goal.savedMinor, goal.targetMinor]),
      ...upcomingPlans.items.map((item) => item.amountMinor),
    ];

    for (const value of values) {
      expect(value).toMatch(/^\d+$/);
    }
  });

  it('never lets allocations exceed the income they belong to', () => {
    const allocated = allocationData.allocations.reduce(
      (sum, item) => sum + toNumber(item.amountMinor),
      0,
    );

    expect(allocated).toBeLessThanOrEqual(toNumber(allocationData.incomeMinor));
  });

  it('keeps spent plus available within the period limit', () => {
    expect(toNumber(heroBudget.spentMinor) + toNumber(heroBudget.availableMinor)).toBeLessThanOrEqual(
      toNumber(heroBudget.periodLimitMinor),
    );
  });

  it('never shows a goal saved above its target', () => {
    for (const goal of goalData) {
      expect(toNumber(goal.savedMinor)).toBeLessThanOrEqual(toNumber(goal.targetMinor));
    }
  });

  it('uses category shares that add up to 100 percent', () => {
    const total = analyticsData.categories.reduce((sum, item) => sum + item.share, 0);

    expect(total).toBe(100);
  });

  it('exposes the sections required by the landing brief', () => {
    expect(landingNavLinks.map((link) => link.href)).toEqual([
      '#features',
      '#how-it-works',
      '#security',
      '#faq',
    ]);
    expect(faqItems).toHaveLength(6);
    expect(howItWorksSteps).toHaveLength(5);
    expect(variableIncome.cases).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- landing.test.ts`
Expected: FAIL — `Cannot find module './landing.js'`.

- [ ] **Step 3: Создать модуль данных**

`apps/web/app/data/landing.ts` — все значения из ТЗ, суммы в копейках:

```ts
export interface LandingBudgetSnapshot {
  dateLabel: string;
  periodLabel: string;
  daysLeft: number;
  availableMinor: string;
  periodLimitMinor: string;
  spentMinor: string;
  dailyAverageMinor: string;
}

export interface LandingEnvelope {
  name: string;
  amountMinor: string;
  tone: 'brand' | 'primary' | 'warning' | 'neutral';
}

export interface LandingAllocation {
  name: string;
  amountMinor: string;
}

export interface LandingGoal {
  name: string;
  savedMinor: string;
  targetMinor: string;
}

export interface LandingPlan {
  dateLabel: string;
  name: string;
  amountMinor: string;
}

export interface LandingCategoryShare {
  name: string;
  share: number;
}

export interface LandingCashFlowPoint {
  label: string;
  incomeMinor: string;
  expenseMinor: string;
}

export interface LandingStep {
  index: string;
  title: string;
  caption: string;
}

export interface LandingFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface LandingTextCard {
  title: string;
  text: string;
}

export const heroBudget: LandingBudgetSnapshot = {
  dateLabel: 'Сегодня, 13 сентября',
  periodLabel: 'Период 25–9',
  daysLeft: 7,
  availableMinor: '2180000',
  periodLimitMinor: '6300000',
  spentMinor: '4120000',
  dailyAverageMinor: '311400',
};

export const heroEnvelopes: LandingEnvelope[] = [
  { name: 'Обязательные', amountMinor: '5200000', tone: 'primary' },
  { name: 'Ремонт', amountMinor: '7000000', tone: 'warning' },
  { name: 'Автомобиль', amountMinor: '800000', tone: 'neutral' },
  { name: 'Свободные', amountMinor: '2180000', tone: 'brand' },
];

export const heroTrustPoints: string[] = [
  'Без сложных таблиц',
  'Адаптивный интерфейс',
  'Без банковской привязки на старте',
];

export const problemCards: LandingTextCard[] = [
  {
    title: 'На карте 120 000 ₽',
    text: 'Но часть этих денег уже нужна для ипотеки, ремонта и других обязательств.',
  },
  {
    title: 'До следующей выплаты ещё несколько дней',
    text: 'Сколько можно потратить сегодня, чтобы не остаться без денег позже?',
  },
  {
    title: 'Вы откладывали на ремонт',
    text: 'Но накопления и повседневные деньги смешались в одном остатке.',
  },
];

export const conceptAccounts: string[] = ['Карта', 'Счёт', 'Наличные'];

export const conceptEnvelopes: string[] = [
  'Ремонт',
  'Автомобиль',
  'Текущие',
  'Обязательные',
  'Свободные',
];

export const cycleMilestones: { dateLabel: string; caption: string }[] = [
  { dateLabel: '10 сентября', caption: 'Новый цикл' },
  { dateLabel: '25 сентября', caption: 'Следующая выплата' },
  { dateLabel: '9 октября', caption: 'Граница периода' },
  { dateLabel: '10 октября', caption: 'Новый цикл' },
];

export const allocationData: {
  incomeName: string;
  incomeMinor: string;
  allocations: LandingAllocation[];
} = {
  incomeName: 'Зарплата',
  incomeMinor: '10600000',
  allocations: [
    { name: 'Обязательные', amountMinor: '5000000' },
    { name: 'Текущие 25–9', amountMinor: '3600000' },
    { name: 'Ремонт', amountMinor: '2000000' },
  ],
};

export const goalData: LandingGoal[] = [
  { name: 'Ремонт', savedMinor: '7000000', targetMinor: '12000000' },
  { name: 'Автомобиль', savedMinor: '1800000', targetMinor: '3000000' },
  { name: 'Отпуск', savedMinor: '4200000', targetMinor: '10000000' },
];

export const upcomingPlans: { items: LandingPlan[]; reservedMinor: string } = {
  items: [
    { dateLabel: '20 сентября', name: 'Подписки', amountMinor: '300000' },
    { dateLabel: '25 сентября', name: 'Секции', amountMinor: '600000' },
    { dateLabel: '26 сентября', name: 'Ипотека', amountMinor: '3600000' },
    { dateLabel: '29 сентября', name: 'Алименты', amountMinor: '1600000' },
    { dateLabel: '01 октября', name: 'Детский сад', amountMinor: '300000' },
  ],
  reservedMinor: '5200000',
};

export const variableIncome: { plannedMinor: string; cases: { receivedMinor: string }[] } = {
  plannedMinor: '10000000',
  cases: [{ receivedMinor: '10600000' }, { receivedMinor: '9900000' }],
};

export const analyticsData: {
  categories: LandingCategoryShare[];
  cashFlow: LandingCashFlowPoint[];
  planVsFact: { label: string; planMinor: string; factMinor: string }[];
} = {
  categories: [
    { name: 'Продукты', share: 24 },
    { name: 'Жильё', share: 21 },
    { name: 'Дети', share: 14 },
    { name: 'Автомобиль', share: 10 },
    { name: 'Досуг', share: 8 },
    { name: 'Прочее', share: 23 },
  ],
  cashFlow: [
    { label: 'Апр', incomeMinor: '10200000', expenseMinor: '8900000' },
    { label: 'Май', incomeMinor: '9800000', expenseMinor: '9100000' },
    { label: 'Июн', incomeMinor: '10600000', expenseMinor: '8700000' },
    { label: 'Июл', incomeMinor: '11200000', expenseMinor: '9600000' },
    { label: 'Авг', incomeMinor: '9900000', expenseMinor: '9400000' },
    { label: 'Сен', incomeMinor: '10600000', expenseMinor: '8200000' },
  ],
  planVsFact: [
    { label: 'Обязательные', planMinor: '5000000', factMinor: '5200000' },
    { label: 'Текущие', planMinor: '3600000', factMinor: '3300000' },
    { label: 'Накопления', planMinor: '2000000', factMinor: '2000000' },
  ],
};

export const howItWorksSteps: LandingStep[] = [
  { index: '01', title: 'Получили зарплату', caption: '+106 000 ₽' },
  { index: '02', title: 'Распределили', caption: 'Обязательные, текущие, ремонт' },
  { index: '03', title: 'Оплатили покупку', caption: '−2 450 ₽, продукты' },
  { index: '04', title: 'Узнали остаток', caption: 'Можно потратить 21 800 ₽' },
  { index: '05', title: 'Накопления продолжают расти', caption: 'Ремонт 70 000 ₽' },
];

export const audienceCards: LandingTextCard[] = [
  { title: 'Семья', text: 'Общие расходы, обязательства и цели в одной финансовой системе.' },
  { title: 'Пара', text: 'Понятная финансовая картина без необходимости вести несколько таблиц.' },
  { title: 'Один человек', text: 'Бюджет под ваши выплаты, цели и реальные финансовые привычки.' },
];

export const roadmapNow: string[] = [
  'Личный бюджет',
  'Счета',
  'Конверты',
  'Финансовые циклы',
  'Регулярные планы',
  'Аналитика',
];

export const roadmapNext: string[] = [
  'Семейный доступ',
  'Импорт банковских выписок',
  'Банковские интеграции',
  'Telegram',
  'AI-анализ',
  'SaaS-функции',
];

export const securityCards: LandingTextCard[] = [
  {
    title: 'Защищённый доступ',
    text: 'Авторизация, восстановление пароля и управление активными сессиями.',
  },
  {
    title: 'Изоляция бюджета',
    text: 'Данные бюджетов изолированы и не должны быть доступны другим пользователям.',
  },
  { title: 'История изменений', text: 'Изменения финансовых данных сохраняются в журнале.' },
];

export const faqItems: LandingFaqItem[] = [
  {
    id: 'what-is',
    question: 'Что такое HarmoFin?',
    answer:
      'HarmoFin — веб-приложение для управления личным и семейным бюджетом, которое связывает фактические движения денег по счетам с их назначением в конвертах и категориями расходов.',
  },
  {
    id: 'difference',
    question: 'Чем HarmoFin отличается от обычного учёта расходов?',
    answer:
      'Он показывает не только баланс счетов, но и назначение денег и доступную сумму до следующей границы финансового периода.',
  },
  {
    id: 'stable-income',
    question: 'Нужно ли получать одинаковую зарплату каждый месяц?',
    answer: 'Нет. HarmoFin работает с фактически полученной суммой.',
  },
  {
    id: 'goals',
    question: 'Можно ли копить на отдельные цели?',
    answer: 'Да. Для этого используются накопительные конверты.',
  },
  {
    id: 'bank-sync',
    question: 'Есть ли банковская синхронизация?',
    answer: 'Не в текущем MVP. Банковские интеграции предусмотрены для следующих этапов.',
  },
  {
    id: 'mobile',
    question: 'Можно ли пользоваться с телефона?',
    answer: 'Да. Интерфейс должен адаптироваться под смартфоны и планшеты.',
  },
];

export const landingNavLinks: { href: string; label: string }[] = [
  { href: '#features', label: 'Возможности' },
  { href: '#how-it-works', label: 'Как это работает' },
  { href: '#security', label: 'Безопасность' },
  { href: '#faq', label: 'FAQ' },
];

export const footerProductLinks: { href: string; label: string }[] = [
  { href: '#features', label: 'Возможности' },
  { href: '#how-it-works', label: 'Как это работает' },
  { href: '#security', label: 'Безопасность' },
  { href: '#faq', label: 'FAQ' },
];

export const footerInfoLinks: { href: string; label: string }[] = [
  { href: '/privacy', label: 'Политика конфиденциальности' },
  { href: '/terms', label: 'Пользовательское соглашение' },
  { href: '/contacts', label: 'Контакты' },
];
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test -- landing.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/data/landing.ts apps/web/app/data/landing.test.ts
git commit -m "feat(web): add landing demo data module with financial invariants"
```

---

### Task 4: Форматирование денег на лендинге

**Files:**
- Create: `apps/web/app/components/landing/format-money.ts`
- Create: `apps/web/app/components/landing/format-money.test.ts`

**Interfaces:**
- Consumes: `formatMinorUnits` из `app/components/finance/money-format.ts`.
- Produces: `formatLandingMoney(minorUnits: string): string` — целые рубли без копеек («21 800 ₽», неразрывные пробелы U+00A0); `formatLandingSignedMoney(minorUnits: string, sign: 'plus' | 'minus'): string` — «+6 000 ₽» / «−1 000 ₽» (минус — U+2212).

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/landing/format-money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { formatLandingMoney, formatLandingSignedMoney } from './format-money.js';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('formatLandingMoney', () => {
  it('formats minor units as whole roubles', () => {
    expect(normalize(formatLandingMoney('2180000'))).toBe('21 800 ₽');
    expect(normalize(formatLandingMoney('10600000'))).toBe('106 000 ₽');
  });

  it('keeps non-breaking separators', () => {
    expect(formatLandingMoney('2180000')).toContain(' ');
  });

  it('rejects values that are not integer strings', () => {
    expect(() => formatLandingMoney('21800.5')).toThrow(TypeError);
  });
});

describe('formatLandingSignedMoney', () => {
  it('prefixes the sign', () => {
    expect(normalize(formatLandingSignedMoney('600000', 'plus'))).toBe('+6 000 ₽');
    expect(normalize(formatLandingSignedMoney('100000', 'minus'))).toBe('−1 000 ₽');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- format-money.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать модуль**

```ts
import { formatMinorUnits } from '../finance/money-format.js';

const MINOR_UNITS_IN_ROUBLE = 100n;

export function formatLandingMoney(minorUnits: string): string {
  if (!/^-?\d+$/.test(minorUnits)) {
    throw new TypeError('minorUnits must be an integer string');
  }

  const roubles = BigInt(minorUnits) / MINOR_UNITS_IN_ROUBLE;

  return formatMinorUnits(roubles.toString(), 'RUB', 0);
}

export function formatLandingSignedMoney(minorUnits: string, sign: 'plus' | 'minus'): string {
  const prefix = sign === 'plus' ? '+' : '−';

  return `${prefix}${formatLandingMoney(minorUnits)}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test -- format-money.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing/format-money.ts apps/web/app/components/landing/format-money.test.ts
git commit -m "feat(web): add whole-rouble money formatting for the landing page"
```

---

### Task 5: Композаблы анимации

**Files:**
- Create: `apps/web/app/composables/useCountUp.ts`
- Create: `apps/web/app/composables/useCountUp.test.ts`
- Create: `apps/web/app/composables/useRevealOnScroll.ts`
- Create: `apps/web/app/composables/useRevealOnScroll.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `useCountUp(targetValue: number, options?: { durationMs?: number }): { value: Ref<number>; start: () => void }` — `durationMs` по умолчанию 600; при `prefers-reduced-motion: reduce` `start()` сразу выставляет `targetValue`.
  - `useRevealOnScroll(): { target: Ref<HTMLElement | null>; revealed: Ref<boolean> }` — при `prefers-reduced-motion` или отсутствии `IntersectionObserver` `revealed` становится `true` сразу на `onMounted`.

- [ ] **Step 1: Write the failing test for useCountUp**

Создать `apps/web/app/composables/useCountUp.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from './useCountUp.js';

type Frame = (timestamp: number) => void;

function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function mockFrames(): Frame[] {
  const frames: Frame[] = [];
  window.requestAnimationFrame = ((callback: Frame) => {
    frames.push(callback);
    return frames.length;
  }) as unknown as typeof window.requestAnimationFrame;
  return frames;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('animates from zero to the target value', () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const { value, start } = useCountUp(1000, { durationMs: 600 });

    expect(value.value).toBe(0);
    start();

    frames[0]?.(0);
    frames[1]?.(300);
    expect(value.value).toBeGreaterThan(0);
    expect(value.value).toBeLessThan(1000);

    frames[2]?.(600);
    expect(value.value).toBe(1000);
  });

  it('jumps straight to the target when reduced motion is requested', () => {
    mockReducedMotion(true);
    const frames = mockFrames();
    const { value, start } = useCountUp(1000);

    start();

    expect(value.value).toBe(1000);
    expect(frames).toHaveLength(0);
  });

  it('ignores repeated start calls once finished', () => {
    mockReducedMotion(true);
    const { value, start } = useCountUp(500);

    start();
    start();

    expect(value.value).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- useCountUp.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `useCountUp`**

```ts
import { ref, type Ref } from 'vue';

const DEFAULT_DURATION_MS = 600;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(
  targetValue: number,
  options: { durationMs?: number } = {},
): { value: Ref<number>; start: () => void } {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const value = ref(0);
  let started = false;

  function start(): void {
    if (started) return;
    started = true;

    if (prefersReducedMotion() || typeof window === 'undefined') {
      value.value = targetValue;
      return;
    }

    let startedAt: number | null = null;

    const step = (timestamp: number): void => {
      if (startedAt === null) startedAt = timestamp;
      const elapsed = timestamp - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - (1 - progress) ** 3;
      value.value = progress === 1 ? targetValue : Math.round(targetValue * eased);

      if (progress < 1) window.requestAnimationFrame(step);
    };

    window.requestAnimationFrame(step);
  }

  return { value, start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- useCountUp.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for useRevealOnScroll**

Создать `apps/web/app/composables/useRevealOnScroll.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useRevealOnScroll } from './useRevealOnScroll.js';

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

function mockObserver(): { callbacks: ObserverCallback[]; disconnect: ReturnType<typeof vi.fn> } {
  const callbacks: ObserverCallback[] = [];
  const disconnect = vi.fn();

  class TestObserver {
    constructor(callback: ObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    disconnect(): void {
      disconnect();
    }
  }

  window.IntersectionObserver = TestObserver as unknown as typeof window.IntersectionObserver;

  return { callbacks, disconnect };
}

function mountHost() {
  const Host = defineComponent({
    name: 'RevealHost',
    setup() {
      const { target, revealed } = useRevealOnScroll();
      return () => h('div', { ref: target, class: revealed.value ? 'is-revealed' : '' });
    },
  });

  return mount(Host, { attachTo: document.body });
}

describe('useRevealOnScroll', () => {
  it('reveals the element once it intersects and stops observing', async () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { callbacks, disconnect } = mockObserver();
    const wrapper = mountHost();

    expect(wrapper.classes()).not.toContain('is-revealed');

    callbacks[0]?.([{ isIntersecting: true }]);
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-revealed');
    expect(disconnect).toHaveBeenCalled();
  });

  it('reveals immediately when IntersectionObserver is unavailable', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const wrapper = mountHost();
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-revealed');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- useRevealOnScroll.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 7: Реализовать `useRevealOnScroll`**

```ts
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

import { prefersReducedMotion } from './useCountUp.js';

export function useRevealOnScroll(): {
  target: Ref<HTMLElement | null>;
  revealed: Ref<boolean>;
} {
  const target = ref<HTMLElement | null>(null);
  const revealed = ref(false);
  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    if (
      prefersReducedMotion() ||
      typeof window === 'undefined' ||
      typeof window.IntersectionObserver !== 'function' ||
      !target.value
    ) {
      revealed.value = true;
      return;
    }

    observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          revealed.value = true;
          observer?.disconnect();
          observer = null;
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );

    observer.observe(target.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { target, revealed };
}
```

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @harmofin/web test -- useCountUp.test.ts useRevealOnScroll.test.ts`
Expected: PASS.

- [ ] **Step 9: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/composables/useCountUp.ts apps/web/app/composables/useCountUp.test.ts apps/web/app/composables/useRevealOnScroll.ts apps/web/app/composables/useRevealOnScroll.test.ts
git commit -m "feat(web): add count-up and reveal-on-scroll composables"
```

---

### Task 6: UI-примитивы лендинга

**Files:**
- Create: `apps/web/app/components/landing/ui/LandingSection.vue`
- Create: `apps/web/app/components/landing/ui/LandingCard.vue`
- Create: `apps/web/app/components/landing/ui/LandingCallout.vue`
- Create: `apps/web/app/components/landing/ui/LandingProgress.vue`
- Create: `apps/web/app/components/landing/ui/LandingMetric.vue`
- Create: `apps/web/app/components/landing/ui/LandingSection.test.ts`
- Create: `apps/web/app/components/landing/ui/LandingProgress.test.ts`
- Modify: `apps/web/package.json` (зависимость `lucide-vue-next`)

**Interfaces:**
- Consumes: токены Task 1.
- Produces:
  - `LandingSection` — props `sectionId: string`, `title: string`, `eyebrow?: string`, `description?: string`, `tone?: 'default' | 'muted' | 'brand'`; один слот `default`. Рендерит `<section :id="sectionId" :aria-labelledby="`${sectionId}-title`">` и `<h2 :id>`.
  - `LandingCard` — props `title?: string`; слоты `icon`, `default`. Заголовок карточки — `<h3>`.
  - `LandingCallout` — props `text: string`.
  - `LandingProgress` — props `label: string`, `valueMinor: string`, `targetMinor: string`, `tone?: 'brand' | 'primary' | 'warning'`; рендерит `role="progressbar"` с `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` (целые проценты) и `aria-label` вида `«Ремонт: 70 000 ₽ из 120 000 ₽»`.
  - `LandingMetric` — props `label: string`, `value: string`, `caption?: string`.

- [ ] **Step 1: Установить библиотеку иконок**

Run: `pnpm --filter @harmofin/web add lucide-vue-next`
Иконки импортируются точечно: `import { Menu, X } from 'lucide-vue-next';`.

- [ ] **Step 2: Write the failing tests**

Создать `apps/web/app/components/landing/ui/LandingSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingSection from './LandingSection.vue';

describe('LandingSection', () => {
  it('links the section to its heading for assistive technology', () => {
    const wrapper = mount(LandingSection, {
      props: { sectionId: 'concept', title: 'Где деньги?', eyebrow: 'Счета и конверты' },
      slots: { default: '<p>Контент</p>' },
    });

    const section = wrapper.get('section');
    expect(section.attributes('id')).toBe('concept');
    expect(section.attributes('aria-labelledby')).toBe('concept-title');

    const heading = wrapper.get('h2');
    expect(heading.attributes('id')).toBe('concept-title');
    expect(heading.text()).toBe('Где деньги?');
    expect(wrapper.text()).toContain('Счета и конверты');
    expect(wrapper.html()).toContain('<p>Контент</p>');
  });

  it('omits the description block when no description is given', () => {
    const wrapper = mount(LandingSection, { props: { sectionId: 'plans', title: 'Планы' } });

    expect(wrapper.find('.landing-section__description').exists()).toBe(false);
  });
});
```

Создать `apps/web/app/components/landing/ui/LandingProgress.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingProgress from './LandingProgress.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('LandingProgress', () => {
  it('exposes progress to assistive technology and shows both amounts as text', () => {
    const wrapper = mount(LandingProgress, {
      props: { label: 'Ремонт', valueMinor: '7000000', targetMinor: '12000000' },
    });

    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('58');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe('Ремонт: 70 000 ₽ из 120 000 ₽');
    expect(normalize(wrapper.text())).toContain('70 000 ₽ из 120 000 ₽');
  });

  it('never reports more than one hundred percent', () => {
    const wrapper = mount(LandingProgress, {
      props: { label: 'Отпуск', valueMinor: '12000000', targetMinor: '10000000' },
    });

    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- LandingSection.test.ts LandingProgress.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 4: Реализовать `LandingSection.vue`**

```vue
<script setup lang="ts">
defineOptions({ name: 'LandingSection' });

withDefaults(
  defineProps<{
    sectionId: string;
    title: string;
    eyebrow?: string | undefined;
    description?: string | undefined;
    tone?: 'default' | 'muted' | 'brand';
  }>(),
  { eyebrow: undefined, description: undefined, tone: 'default' },
);
</script>

<template>
  <section :id="sectionId" class="landing-section" :class="`landing-section--${tone}`" :aria-labelledby="`${sectionId}-title`">
    <div class="landing-section__inner">
      <header class="landing-section__header">
        <p v-if="eyebrow" class="landing-section__eyebrow">{{ eyebrow }}</p>
        <h2 :id="`${sectionId}-title`" class="landing-section__title">{{ title }}</h2>
        <p v-if="description" class="landing-section__description">{{ description }}</p>
      </header>
      <div class="landing-section__body">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.landing-section {
  padding: var(--hf-space-16) var(--hf-space-4);
  scroll-margin-top: 5rem;
}

.landing-section--muted {
  background: var(--hf-color-page-background);
}

.landing-section--brand {
  background: var(--hf-color-brand-soft);
}

.landing-section__inner {
  display: grid;
  gap: var(--hf-space-8);
  max-width: var(--hf-container-max);
  margin: 0 auto;
}

.landing-section__header {
  display: grid;
  gap: var(--hf-space-3);
  max-width: 44rem;
}

.landing-section__eyebrow {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.landing-section__title {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: -0.01em;
}

.landing-section__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
}

@media (min-width: 1024px) {
  .landing-section {
    padding: var(--hf-space-24) var(--hf-space-8);
  }
}
</style>
```

- [ ] **Step 5: Реализовать `LandingCard.vue`, `LandingCallout.vue`, `LandingMetric.vue`**

`LandingCard.vue`:

```vue
<script setup lang="ts">
defineOptions({ name: 'LandingCard' });

withDefaults(defineProps<{ title?: string | undefined }>(), { title: undefined });
</script>

<template>
  <article class="landing-card">
    <div v-if="$slots.icon" class="landing-card__icon" aria-hidden="true">
      <slot name="icon" />
    </div>
    <h3 v-if="title" class="landing-card__title">{{ title }}</h3>
    <div class="landing-card__body">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.landing-card {
  display: grid;
  gap: var(--hf-space-3);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.landing-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-primary-soft);
  color: var(--hf-color-action-primary);
}

.landing-card__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

.landing-card__body {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}
</style>
```

`LandingCallout.vue` — блок с брендовой подложкой, иконкой `ArrowRight` из `lucide-vue-next` (`aria-hidden="true"`) и текстом из пропа `text: string`; фон `var(--hf-color-brand-soft)`, текст `var(--hf-color-text)`, радиус `var(--hf-radius-lg)`, отступ `var(--hf-space-5)`.

`LandingMetric.vue` — props `label: string`, `value: string`, `caption?: string`; разметка: `<p class="landing-metric__label">`, `<p class="landing-metric__value">`, необязательный `<p class="landing-metric__caption">`; значение — `font-size: var(--hf-font-size-display)`, `font-variant-numeric: tabular-nums`, `letter-spacing: -0.02em`.

- [ ] **Step 6: Реализовать `LandingProgress.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';

defineOptions({ name: 'LandingProgress' });

const props = withDefaults(
  defineProps<{
    label: string;
    valueMinor: string;
    targetMinor: string;
    tone?: 'brand' | 'primary' | 'warning';
  }>(),
  { tone: 'brand' },
);

const percent = computed(() => {
  const value = Number(BigInt(props.valueMinor));
  const target = Number(BigInt(props.targetMinor));
  if (target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
});

const formattedValue = computed(() => formatLandingMoney(props.valueMinor));
const formattedTarget = computed(() => formatLandingMoney(props.targetMinor));
const summary = computed(() => `${props.label}: ${formattedValue.value} из ${formattedTarget.value}`);
</script>

<template>
  <div class="landing-progress">
    <div class="landing-progress__head">
      <span class="landing-progress__label">{{ label }}</span>
      <span class="landing-progress__amounts">{{ formattedValue }} из {{ formattedTarget }}</span>
    </div>
    <div
      class="landing-progress__track"
      role="progressbar"
      :aria-label="summary"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="landing-progress__fill"
        :class="`landing-progress__fill--${tone}`"
        :style="{ width: `${percent}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
.landing-progress {
  display: grid;
  gap: var(--hf-space-2);
}

.landing-progress__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--hf-space-2);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.landing-progress__amounts {
  color: var(--hf-color-text-muted);
  font-variant-numeric: tabular-nums;
}

.landing-progress__track {
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-slate-200);
  overflow: hidden;
}

.landing-progress__fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--hf-transition-base);
}

.landing-progress__fill--brand {
  background: var(--hf-color-brand-bright);
}

.landing-progress__fill--primary {
  background: var(--hf-color-primary-bright);
}

.landing-progress__fill--warning {
  background: var(--hf-color-status-warning-bright);
}
</style>
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @harmofin/web test -- LandingSection.test.ts LandingProgress.test.ts`
Expected: PASS (58 % для 70 000 из 120 000, 100 % при превышении цели).

- [ ] **Step 8: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing/ui apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add landing UI primitives and icon library"
```

---

### Task 7: Каркас страницы, шапка, подвал, SEO

**Files:**
- Create: `apps/web/app/components/landing/LandingHeader.vue`
- Create: `apps/web/app/components/landing/LandingHeader.test.ts`
- Create: `apps/web/app/components/landing/LandingFooter.vue`
- Create: `apps/web/app/data/landing-seo.ts`
- Create: `apps/web/app/data/landing-seo.test.ts`
- Create: `apps/web/public/favicon.svg`
- Modify: `apps/web/app/test/nuxt-imports.ts` (стабы `useSeoMeta`, `useHead`)
- Modify: `apps/web/nuxt.config.ts` (favicon в `app.head.link`)
- Modify: `apps/web/app/pages/index.vue`
- Delete: `apps/web/app/components/landing/HeroSection.vue`, `FeaturesGrid.vue`, `FeatureCard.vue`, `ShowcaseSection.vue`, `FinalCTA.vue`

**Interfaces:**
- Consumes: `landingNavLinks`, `footerProductLinks`, `footerInfoLinks` (Task 3); `UiButton` с `to` (Task 2).
- Produces: `LandingHeader` (без пропов, эмитов нет), `LandingFooter` (без пропов), `landingSeo` — объект для `useSeoMeta`.

- [ ] **Step 1: Write the failing tests**

Создать `apps/web/app/data/landing-seo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { landingSeo } from './landing-seo.js';

describe('landingSeo', () => {
  it('matches the copy required by the landing brief', () => {
    expect(landingSeo.title).toBe('HarmoFin — управляйте личными и семейными финансами');
    expect(landingSeo.description).toBe(
      'HarmoFin помогает управлять семейным бюджетом, распределять деньги по целям и видеть, сколько действительно можно потратить.',
    );
    expect(landingSeo.ogTitle).toBe(landingSeo.title);
    expect(landingSeo.ogDescription).toBe(landingSeo.description);
    expect(landingSeo.ogType).toBe('website');
    expect(landingSeo.ogLocale).toBe('ru_RU');
    expect(landingSeo.twitterCard).toBe('summary_large_image');
  });
});
```

Создать `apps/web/app/components/landing/LandingHeader.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingHeader from './LandingHeader.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const mountHeader = () =>
  mount(LandingHeader, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

describe('LandingHeader', () => {
  it('renders anchor navigation and both call-to-action links', () => {
    const wrapper = mountHeader();

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining(['#features', '#how-it-works', '#security', '#faq', '/login', '/register']),
    );
  });

  it('toggles the mobile menu and reports its state', async () => {
    const wrapper = mountHeader();
    const toggle = wrapper.get('[data-testid="landing-menu-toggle"]');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe('landing-mobile-menu');
    expect(wrapper.find('#landing-mobile-menu').exists()).toBe(false);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('#landing-mobile-menu').isVisible()).toBe(true);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('closes the mobile menu when a navigation link is used', async () => {
    const wrapper = mountHeader();
    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');

    await wrapper.get('#landing-mobile-menu a').trigger('click');

    expect(wrapper.get('[data-testid="landing-menu-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- landing-seo.test.ts LandingHeader.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Реализовать `landing-seo.ts`**

```ts
export const landingSeo = {
  title: 'HarmoFin — управляйте личными и семейными финансами',
  description:
    'HarmoFin помогает управлять семейным бюджетом, распределять деньги по целям и видеть, сколько действительно можно потратить.',
  ogTitle: 'HarmoFin — управляйте личными и семейными финансами',
  ogDescription:
    'HarmoFin помогает управлять семейным бюджетом, распределять деньги по целям и видеть, сколько действительно можно потратить.',
  ogType: 'website',
  ogLocale: 'ru_RU',
  twitterCard: 'summary_large_image',
} as const;
```

`canonical`, `og:url` и `og:image` в этот объект не добавляются: продакшен-домен не зафиксирован ни в одном источнике проекта, а изображение 1200×630 нечем собрать без новой зависимости (риск №1 в спеке). Вместо выдуманных значений — комментарий в файле:

```ts
// TODO: добавить canonical, og:url и og:image, когда будут известны продакшен-домен и файл
// превью 1200×630 (см. риск №1 в docs/superpowers/specs/2026-09-13-landing-redesign-design.md).
```

- [ ] **Step 4: Реализовать `LandingHeader.vue`**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Menu, X } from 'lucide-vue-next';

import UiButton from '../ui/Button.vue';
import { landingNavLinks } from '../../data/landing.js';

defineOptions({ name: 'LandingHeader' });

const menuOpen = ref(false);
const scrolled = ref(false);

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
}

function closeMenu(): void {
  menuOpen.value = false;
}

function handleScroll(): void {
  scrolled.value = window.scrollY > 24;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('keydown', handleKeydown);
  handleScroll();
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <header class="landing-header" :class="{ 'landing-header--scrolled': scrolled }">
    <div class="landing-header__inner">
      <NuxtLink to="/" class="landing-header__wordmark">HarmoFin</NuxtLink>

      <nav class="landing-header__nav" aria-label="Разделы страницы">
        <a v-for="link in landingNavLinks" :key="link.href" :href="link.href" class="landing-header__link">
          {{ link.label }}
        </a>
      </nav>

      <div class="landing-header__actions">
        <UiButton to="/login" variant="tertiary" size="md">Войти</UiButton>
        <UiButton to="/register" variant="brand" size="md">Начать бесплатно</UiButton>
      </div>

      <button
        type="button"
        class="landing-header__toggle"
        data-testid="landing-menu-toggle"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="landing-mobile-menu"
        :aria-label="menuOpen ? 'Закрыть меню' : 'Открыть меню'"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="24" aria-hidden="true" />
        <Menu v-else :size="24" aria-hidden="true" />
      </button>
    </div>

    <div v-if="menuOpen" id="landing-mobile-menu" class="landing-header__mobile">
      <a
        v-for="link in landingNavLinks"
        :key="link.href"
        :href="link.href"
        class="landing-header__link"
        @click="closeMenu"
      >
        {{ link.label }}
      </a>
      <UiButton to="/login" variant="secondary" size="lg" full-width>Войти</UiButton>
      <UiButton to="/register" variant="brand" size="lg" full-width>Начать бесплатно</UiButton>
    </div>
  </header>
</template>
```

Стили: `position: sticky; top: 0; z-index: 100;` прозрачный фон, при `.landing-header--scrolled` — `background: rgb(255 255 255 / 82%)`, `backdrop-filter: blur(12px)`, `border-bottom: 1px solid var(--hf-color-border)`. `.landing-header__inner` — flex, `max-width: var(--hf-container-max-wide)`, высота `4.5rem`, `gap: var(--hf-space-6)`. `.landing-header__nav` и `.landing-header__actions` скрыты (`display: none`) до `min-width: 1024px`, `.landing-header__toggle` показан только ниже 1024px, размер `2.75rem`, `border-radius: var(--hf-radius-md)`. `.landing-header__mobile` — grid с `gap: var(--hf-space-3)`, фон `var(--hf-color-surface)`, `border-bottom: 1px solid var(--hf-color-border)`, `padding: var(--hf-space-4)`.

- [ ] **Step 5: Реализовать `LandingFooter.vue`**

Разметка: `<footer class="landing-footer">` с четырьмя колонками — бренд (`HarmoFin` + «Система управления личными и семейными финансами»), «Продукт» (`footerProductLinks`), «Информация» (`footerInfoLinks`), копирайт «© 2026 HarmoFin». Заголовки колонок — `<h3 class="landing-footer__heading">`, списки — `<ul>`/`<li>`. Сетка: одна колонка до 768px, четыре — от 1024px; фон `var(--hf-color-surface)`, верхняя граница `1px solid var(--hf-color-border)`.

- [ ] **Step 6: Обновить стабы Nuxt и `nuxt.config.ts`**

В `apps/web/app/test/nuxt-imports.ts` добавить:

```ts
export function useSeoMeta(): void {}

export function useHead(): void {}
```

В `apps/web/nuxt.config.ts` добавить внутрь `defineNuxtConfig`:

```ts
app: {
  head: {
    htmlAttrs: { lang: 'ru' },
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  },
},
```

Создать `apps/web/public/favicon.svg` — квадрат 32×32 с фоном `#0a7f60`, радиусом 8 и белой буквой «H» по центру:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="HarmoFin">
  <rect width="32" height="32" rx="8" fill="#0a7f60" />
  <path d="M10 8v16M22 8v16M10 16h12" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
</svg>
```

- [ ] **Step 7: Переписать `pages/index.vue` и удалить старые компоненты**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useSeoMeta } from '#imports';

import LandingFooter from '../components/landing/LandingFooter.vue';
import LandingHeader from '../components/landing/LandingHeader.vue';
import { landingSeo } from '../data/landing-seo.js';
import { useAuth } from '../composables/useAuth.js';

const { currentData } = useAuth();
const isAuthenticated = computed(() => !!currentData.value?.user);

useSeoMeta(landingSeo);

if (isAuthenticated.value) {
  await navigateTo('/app');
}
</script>

<template>
  <div v-if="!isAuthenticated" class="landing">
    <LandingHeader />
    <main class="landing__main">
      <!-- секции добавляются в задачах 8–17 -->
    </main>
    <LandingFooter />
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
}
</style>
```

```bash
git rm apps/web/app/components/landing/HeroSection.vue apps/web/app/components/landing/FeaturesGrid.vue apps/web/app/components/landing/FeatureCard.vue apps/web/app/components/landing/ShowcaseSection.vue apps/web/app/components/landing/FinalCTA.vue
```

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS (включая новые `landing-seo.test.ts` и `LandingHeader.test.ts`).

- [ ] **Step 9: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
git add apps/web/app/components/landing apps/web/app/data/landing-seo.ts apps/web/app/data/landing-seo.test.ts apps/web/app/pages/index.vue apps/web/app/test/nuxt-imports.ts apps/web/nuxt.config.ts apps/web/public/favicon.svg
git commit -m "feat(web): add landing shell with header, footer and SEO metadata"
```

---

### Task 8: Hero и продуктовый mockup

**Files:**
- Create: `apps/web/app/components/landing/mockups/DashboardMockup.vue`
- Create: `apps/web/app/components/landing/mockups/DashboardMockup.test.ts`
- Create: `apps/web/app/components/landing/sections/HeroSection.vue`
- Create: `apps/web/app/components/landing/sections/HeroSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `heroBudget`, `heroEnvelopes`, `heroTrustPoints` (Task 3), `formatLandingMoney` (Task 4), `UiButton` (Task 2).
- Produces: `DashboardMockup` — без пропов, читает `heroBudget`/`heroEnvelopes` напрямую; `HeroSection` — без пропов, содержит единственный `<h1>` страницы.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/mockups/DashboardMockup.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardMockup from './DashboardMockup.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('DashboardMockup', () => {
  it('shows the available amount, the period frame and every envelope', () => {
    const wrapper = mount(DashboardMockup);
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('21 800 ₽');
    expect(text).toContain('Период 25–9');
    expect(text).toContain('Осталось 7 дней');
    expect(text).toContain('63 000 ₽');
    expect(text).toContain('41 200 ₽');
    expect(text).toContain('3 114 ₽');
    expect(text).toContain('Обязательные');
    expect(text).toContain('Свободные');
  });

  it('is hidden from assistive technology as a decorative product preview', () => {
    const wrapper = mount(DashboardMockup);

    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });
});
```

`apps/web/app/components/landing/sections/HeroSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HeroSection from './HeroSection.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('HeroSection', () => {
  it('states the product promise in the single page heading', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    const headings = wrapper.findAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.text()).toBe(
      'Понимайте свои деньги, а не просто записывайте расходы.',
    );
    expect(wrapper.text()).toContain('Управляйте личными и семейными финансами');
    expect(wrapper.text()).toContain(
      'HarmoFin показывает, сколько денег у вас есть, на что они уже предназначены и сколько можно потратить прямо сейчас.',
    );
  });

  it('sends the primary call to action to registration and the secondary one to the demo section', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('#how-it-works');
  });

  it('lists the trust points from the brief', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    expect(wrapper.text()).toContain('Без сложных таблиц');
    expect(wrapper.text()).toContain('Адаптивный интерфейс');
    expect(wrapper.text()).toContain('Без банковской привязки на старте');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- DashboardMockup.test.ts HeroSection.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `DashboardMockup.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { heroBudget, heroEnvelopes } from '../../data/landing.js';

defineOptions({ name: 'DashboardMockup' });

const spentPercent = computed(() => {
  const spent = Number(BigInt(heroBudget.spentMinor));
  const limit = Number(BigInt(heroBudget.periodLimitMinor));
  return limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
});

const rows = computed(() => [
  { label: 'Лимит периода', value: formatLandingMoney(heroBudget.periodLimitMinor) },
  { label: 'Потрачено', value: formatLandingMoney(heroBudget.spentMinor) },
  { label: 'Средний лимит', value: `${formatLandingMoney(heroBudget.dailyAverageMinor)} / день` },
]);

const envelopes = computed(() =>
  heroEnvelopes.map((envelope) => ({
    ...envelope,
    formatted: formatLandingMoney(envelope.amountMinor),
  })),
);

const available = computed(() => formatLandingMoney(heroBudget.availableMinor));
</script>

<template>
  <div class="dashboard-mockup" aria-hidden="true">
    <div class="dashboard-mockup__chrome">
      <span class="dashboard-mockup__wordmark">HarmoFin</span>
    </div>

    <div class="dashboard-mockup__meta">
      <span>{{ heroBudget.dateLabel }}</span>
      <span>{{ heroBudget.periodLabel }}</span>
      <span>Осталось {{ heroBudget.daysLeft }} дней</span>
    </div>

    <p class="dashboard-mockup__label">Можно потратить</p>
    <p class="dashboard-mockup__value">{{ available }}</p>

    <div class="dashboard-mockup__track">
      <div class="dashboard-mockup__fill" :style="{ width: `${spentPercent}%` }" />
    </div>

    <dl class="dashboard-mockup__rows">
      <div v-for="row in rows" :key="row.label" class="dashboard-mockup__row">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>

    <ul class="dashboard-mockup__envelopes">
      <li
        v-for="envelope in envelopes"
        :key="envelope.name"
        class="dashboard-mockup__envelope"
        :class="`dashboard-mockup__envelope--${envelope.tone}`"
      >
        <span>{{ envelope.name }}</span>
        <strong>{{ envelope.formatted }}</strong>
      </li>
    </ul>
  </div>
</template>
```

Стили: карточка `background: var(--hf-color-surface)`, `border: 1px solid var(--hf-color-border)`, `border-radius: var(--hf-radius-xl)`, `box-shadow: var(--hf-shadow-lg)`, `padding: var(--hf-space-5)`, `display: grid; gap: var(--hf-space-4)`. `.dashboard-mockup__value` — `font-size: var(--hf-font-size-display)`, `font-variant-numeric: tabular-nums`, цвет `var(--hf-color-brand)`. `.dashboard-mockup__track` — высота `0.625rem`, фон `var(--hf-color-slate-200)`, `.dashboard-mockup__fill` — `background: var(--hf-color-brand-bright)`. `.dashboard-mockup__meta` и `.dashboard-mockup__rows` — `font-size: var(--hf-font-size-caption)`, цвет `var(--hf-color-text-muted)`; строки `dl` — flex со `justify-content: space-between`. `.dashboard-mockup__envelopes` — сетка `repeat(2, minmax(0, 1fr))`, элементы с подложками по тону: `--brand` → `var(--hf-color-brand-soft)`, `--primary` → `var(--hf-color-primary-soft)`, `--warning` → `var(--hf-color-warning-soft)`, `--neutral` → `var(--hf-color-page-background)`; `list-style: none; margin: 0; padding: 0`. Ниже 480px `.dashboard-mockup__meta` переносится в колонку, а `.dashboard-mockup__rows` остаётся в одну колонку.

- [ ] **Step 4: Реализовать `HeroSection.vue`**

```vue
<script setup lang="ts">
import { Check } from 'lucide-vue-next';

import DashboardMockup from '../mockups/DashboardMockup.vue';
import UiButton from '../../ui/Button.vue';
import { heroTrustPoints } from '../../../data/landing.js';

defineOptions({ name: 'HeroSection' });
</script>

<template>
  <section id="hero" class="hero" aria-labelledby="hero-title">
    <div class="hero__inner">
      <div class="hero__content">
        <p class="hero__eyebrow">Управляйте личными и семейными финансами</p>
        <h1 id="hero-title" class="hero__title">
          Понимайте свои деньги, а не просто записывайте расходы.
        </h1>
        <p class="hero__description">
          HarmoFin показывает, сколько денег у вас есть, на что они уже предназначены и сколько
          можно потратить прямо сейчас.
        </p>
        <div class="hero__actions">
          <UiButton to="/register" variant="brand" size="lg">Начать бесплатно</UiButton>
          <a class="hero__secondary" href="#how-it-works">Посмотреть, как это работает →</a>
        </div>
        <ul class="hero__trust">
          <li v-for="point in heroTrustPoints" :key="point" class="hero__trust-item">
            <Check :size="16" aria-hidden="true" />
            <span>{{ point }}</span>
          </li>
        </ul>
      </div>

      <div class="hero__preview">
        <DashboardMockup />
      </div>
    </div>
  </section>
</template>
```

Стили: `.hero` — `background: linear-gradient(180deg, var(--hf-color-brand-soft) 0%, var(--hf-color-surface) 100%)`, `padding: var(--hf-space-12) var(--hf-space-4) var(--hf-space-16)`. `.hero__inner` — grid в одну колонку, `gap: var(--hf-space-10)`, `max-width: var(--hf-container-max-wide)`; от 1024px — `grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr)`, `align-items: center`, `padding-inline: var(--hf-space-8)`. `.hero__title` — `font-size: var(--hf-font-size-h1)`, `line-height: var(--hf-line-height-h1)`, `font-weight: var(--hf-font-weight-bold)`, `letter-spacing: -0.02em`. `.hero__actions` — flex, `gap: var(--hf-space-4)`, `flex-wrap: wrap`; ниже 768px кнопка CTA во всю ширину (`:deep(.ui-button) { width: 100% }` для первого элемента через класс-обёртку). `.hero__trust` — `list-style: none`, flex с переносом, `gap: var(--hf-space-4)`, иконка `color: var(--hf-color-brand)`. `.hero__secondary` — цвет `var(--hf-color-action-primary)`, без подчёркивания, подчёркивание на `:hover`.

- [ ] **Step 5: Подключить секцию в страницу**

В `apps/web/app/pages/index.vue` импортировать `HeroSection` и поставить его первым внутри `<main class="landing__main">`, заменив комментарий-заглушку.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @harmofin/web test -- DashboardMockup.test.ts HeroSection.test.ts`
Expected: PASS.

- [ ] **Step 7: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add landing hero section with product dashboard mockup"
```

---

### Task 9: Секции «Проблема» и «Счета + конверты»

**Files:**
- Create: `apps/web/app/components/landing/sections/ProblemSection.vue`
- Create: `apps/web/app/components/landing/sections/ProblemSection.test.ts`
- Create: `apps/web/app/components/landing/sections/ConceptSection.vue`
- Create: `apps/web/app/components/landing/sections/ConceptSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `problemCards`, `conceptAccounts`, `conceptEnvelopes` (Task 3); `LandingSection`, `LandingCard`, `LandingCallout` (Task 6).
- Produces: `ProblemSection` (`id="problem"`), `ConceptSection` (`id="concept"`).

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/sections/ProblemSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProblemSection from './ProblemSection.vue';

describe('ProblemSection', () => {
  it('frames the problem with the copy from the brief', () => {
    const wrapper = mount(ProblemSection);

    expect(wrapper.get('section').attributes('id')).toBe('problem');
    expect(wrapper.get('h2').text()).toBe(
      'Деньги вроде есть. Но сколько из них действительно можно потратить?',
    );
    expect(wrapper.findAll('h3')).toHaveLength(3);
    expect(wrapper.text()).toContain('На карте 120 000 ₽');
    expect(wrapper.text()).toContain('HarmoFin разделяет деньги не только по счетам, но и по назначению.');
  });
});
```

`apps/web/app/components/landing/sections/ConceptSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ConceptSection from './ConceptSection.vue';

describe('ConceptSection', () => {
  it('separates where money is from what it is meant for', () => {
    const wrapper = mount(ConceptSection);

    expect(wrapper.get('section').attributes('id')).toBe('concept');
    expect(wrapper.get('h2').text()).toBe('Где деньги? И на что они предназначены?');

    const accounts = wrapper.get('[data-testid="concept-accounts"]');
    const envelopes = wrapper.get('[data-testid="concept-envelopes"]');

    expect(accounts.text()).toContain('Где находятся деньги?');
    expect(accounts.text()).toContain('Наличные');
    expect(envelopes.text()).toContain('На что нужны деньги?');
    expect(envelopes.text()).toContain('Свободные');
    expect(wrapper.text()).toContain(
      'Деньги на карте не означают, что все деньги на карте можно потратить.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- ProblemSection.test.ts ConceptSection.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `ProblemSection.vue`**

```vue
<script setup lang="ts">
import { Wallet, CalendarClock, PiggyBank } from 'lucide-vue-next';

import LandingCallout from '../ui/LandingCallout.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { problemCards } from '../../../data/landing.js';

defineOptions({ name: 'ProblemSection' });

const icons = [Wallet, CalendarClock, PiggyBank];
</script>

<template>
  <LandingSection
    section-id="problem"
    tone="muted"
    eyebrow="Знакомая проблема"
    title="Деньги вроде есть. Но сколько из них действительно можно потратить?"
    description="Обычный учёт расходов показывает прошлое. Но для управления бюджетом важно понимать, что происходит с деньгами сейчас."
  >
    <div class="problem__grid">
      <LandingCard v-for="(card, index) in problemCards" :key="card.title" :title="card.title">
        <template #icon>
          <component :is="icons[index]" :size="20" />
        </template>
        {{ card.text }}
      </LandingCard>
    </div>

    <LandingCallout text="HarmoFin разделяет деньги не только по счетам, но и по назначению." />
  </LandingSection>
</template>

<style scoped>
.problem__grid {
  display: grid;
  gap: var(--hf-space-4);
  margin-bottom: var(--hf-space-6);
}

@media (min-width: 768px) {
  .problem__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: Реализовать `ConceptSection.vue`**

Структура: `LandingSection` с `section-id="concept"`, `eyebrow="Счета и конверты"`, `title="Где деньги? И на что они предназначены?"`, `description="В HarmoFin место хранения денег и их назначение — две разные вещи."`. Внутри — сетка из трёх частей:

```vue
<div class="concept__grid">
  <div class="concept__column" data-testid="concept-accounts">
    <h3 class="concept__heading">Счета</h3>
    <p class="concept__caption">Где находятся деньги?</p>
    <ul class="concept__list">
      <li v-for="account in conceptAccounts" :key="account">{{ account }}</li>
    </ul>
  </div>

  <p class="concept__hub" aria-hidden="true">HarmoFin</p>

  <div class="concept__column" data-testid="concept-envelopes">
    <h3 class="concept__heading">Конверты</h3>
    <p class="concept__caption">На что нужны деньги?</p>
    <ul class="concept__list">
      <li v-for="envelope in conceptEnvelopes" :key="envelope">{{ envelope }}</li>
    </ul>
  </div>
</div>

<LandingCallout text="Деньги на карте не означают, что все деньги на карте можно потратить." />
```

Стили: `.concept__grid` — одна колонка на мобилке, от 1024px `grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)` с `align-items: center`. `.concept__column` — карточка (`border`, `border-radius: var(--hf-radius-lg)`, `background: var(--hf-color-surface)`, `padding: var(--hf-card-padding)`). `.concept__hub` — круг `4.5rem`, `background: var(--hf-color-brand-soft)`, `color: var(--hf-color-brand)`, `display: grid; place-items: center`; на мобилке скрыт (`display: none` до 1024px). `.concept__list` — `list-style: none; margin: 0; padding: 0; display: grid; gap: var(--hf-space-2)`, пункты с `border-bottom: 1px solid var(--hf-color-border)`.

- [ ] **Step 5: Подключить секции в страницу**

Добавить `ProblemSection` и `ConceptSection` после `HeroSection` в `apps/web/app/pages/index.vue`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @harmofin/web test -- ProblemSection.test.ts ConceptSection.test.ts`
Expected: PASS.

- [ ] **Step 7: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add problem and accounts-versus-envelopes landing sections"
```

---

### Task 10: Секция «Можно потратить» с count-up

**Files:**
- Create: `apps/web/app/components/landing/mockups/AvailableCard.vue`
- Create: `apps/web/app/components/landing/mockups/AvailableCard.test.ts`
- Create: `apps/web/app/components/landing/sections/AvailableToSpendSection.vue`
- Create: `apps/web/app/components/landing/sections/AvailableToSpendSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `heroBudget` (Task 3), `formatLandingMoney` (Task 4), `useCountUp`, `useRevealOnScroll` (Task 5), `LandingSection`, `LandingMetric` (Task 6).
- Produces: `AvailableCard` — без пропов; анимирует сумму при появлении, конечное значение доступно всегда (при reduced motion — сразу). `AvailableToSpendSection` — `id="available"`.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/mockups/AvailableCard.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AvailableCard from './AvailableCard.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Reflect.deleteProperty(window, 'IntersectionObserver');
});

describe('AvailableCard', () => {
  it('renders the final amount immediately when motion is reduced', async () => {
    const wrapper = mount(AvailableCard, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const text = normalize(wrapper.text());
    expect(text).toContain('21 800 ₽');
    expect(text).toContain('Период 25–9');
    expect(text).toContain('Осталось 7 дней');
    expect(text).toContain('41 200 ₽');
    expect(text).toContain('63 000 ₽');
    expect(text).toContain('3 114 ₽');
  });

  it('exposes the spending progress to assistive technology', async () => {
    const wrapper = mount(AvailableCard, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('65');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe(
      'Потрачено 41 200 ₽ из лимита 63 000 ₽',
    );
  });
});
```

`apps/web/app/components/landing/sections/AvailableToSpendSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableToSpendSection from './AvailableToSpendSection.vue';

describe('AvailableToSpendSection', () => {
  it('explains that the limit comes from actual operations', () => {
    const wrapper = mount(AvailableToSpendSection, { attachTo: document.body });

    expect(wrapper.get('section').attributes('id')).toBe('available');
    expect(wrapper.get('h2').text()).toBe('Главный вопрос — сколько можно потратить сегодня?');
    expect(wrapper.text()).toContain(
      'HarmoFin рассчитывает доступный остаток на основе фактических доходов и операций, а не предполагаемой суммы будущей выплаты.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- AvailableCard.test.ts AvailableToSpendSection.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `AvailableCard.vue`**

```vue
<script setup lang="ts">
import { computed, watch } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { heroBudget } from '../../../data/landing.js';
import { useCountUp } from '../../../composables/useCountUp.js';
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

defineOptions({ name: 'AvailableCard' });

const { target, revealed } = useRevealOnScroll();
const availableRoubles = Number(BigInt(heroBudget.availableMinor) / 100n);
const { value: animated, start } = useCountUp(availableRoubles);

watch(revealed, (isRevealed) => {
  if (isRevealed) start();
}, { immediate: true });

const displayed = computed(() => formatLandingMoney(`${animated.value}00`));
const spentPercent = computed(() => {
  const spent = Number(BigInt(heroBudget.spentMinor));
  const limit = Number(BigInt(heroBudget.periodLimitMinor));
  return limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
});
const progressLabel = computed(
  () =>
    `Потрачено ${formatLandingMoney(heroBudget.spentMinor)} из лимита ${formatLandingMoney(
      heroBudget.periodLimitMinor,
    )}`,
);
</script>

<template>
  <div ref="target" class="available-card" :class="{ 'is-revealed': revealed }">
    <p class="available-card__label">Можно потратить</p>
    <p class="available-card__value">{{ displayed }}</p>

    <div
      class="available-card__track"
      role="progressbar"
      :aria-label="progressLabel"
      :aria-valuenow="spentPercent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="available-card__fill" :style="{ width: `${spentPercent}%` }" />
    </div>

    <dl class="available-card__rows">
      <div class="available-card__row">
        <dt>{{ heroBudget.periodLabel }}</dt>
        <dd>Осталось {{ heroBudget.daysLeft }} дней</dd>
      </div>
      <div class="available-card__row">
        <dt>Потрачено</dt>
        <dd>{{ formatLandingMoney(heroBudget.spentMinor) }}</dd>
      </div>
      <div class="available-card__row">
        <dt>Лимит</dt>
        <dd>{{ formatLandingMoney(heroBudget.periodLimitMinor) }}</dd>
      </div>
      <div class="available-card__row">
        <dt>Сегодня</dt>
        <dd>≈ {{ formatLandingMoney(heroBudget.dailyAverageMinor) }}</dd>
      </div>
    </dl>
  </div>
</template>
```

`animated.value` — целые рубли, поэтому для форматирования обратно в минорные единицы добавляются два нуля (`${animated.value}00`). Стили: карточка с `border-radius: var(--hf-radius-xl)`, `box-shadow: var(--hf-shadow-md)`, `padding: var(--hf-space-8)`, `max-width: 34rem`; `.available-card__value` — `font-size: var(--hf-font-size-display)`, `color: var(--hf-color-brand)`, `font-variant-numeric: tabular-nums`; `.available-card` в состоянии до появления — `opacity: 0; transform: translateY(12px) scale(0.98)`, в `.is-revealed` — `opacity: 1; transform: none`, переход `400ms ease-out` для `opacity` и `transform`.

- [ ] **Step 4: Реализовать `AvailableToSpendSection.vue`**

`LandingSection` с `section-id="available"`, `eyebrow="Главный вопрос"`, `title="Главный вопрос — сколько можно потратить сегодня?"`, `description="HarmoFin рассчитывает доступный остаток на основе фактических доходов и операций, а не предполагаемой суммы будущей выплаты."`; в теле — `<AvailableCard />`, выровненная по центру колонки (`justify-self: center` на ширинах до 1024px, слева — на десктопе рядом с текстом описания).

- [ ] **Step 5: Подключить секцию и запустить тесты**

Добавить `AvailableToSpendSection` в `pages/index.vue` после `ConceptSection`.

Run: `pnpm --filter @harmofin/web test -- AvailableCard.test.ts AvailableToSpendSection.test.ts`
Expected: PASS (65 % — округление 41 200 / 63 000).

- [ ] **Step 6: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add available-to-spend landing section with animated amount"
```

---

### Task 11: Секции «Финансовый цикл» и «Распределение дохода»

**Files:**
- Create: `apps/web/app/components/landing/mockups/CycleTimeline.vue`
- Create: `apps/web/app/components/landing/mockups/CycleTimeline.test.ts`
- Create: `apps/web/app/components/landing/mockups/AllocationFlow.vue`
- Create: `apps/web/app/components/landing/mockups/AllocationFlow.test.ts`
- Create: `apps/web/app/components/landing/sections/FinancialCycleSection.vue`
- Create: `apps/web/app/components/landing/sections/IncomeAllocationSection.vue`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `cycleMilestones`, `allocationData` (Task 3), `formatLandingMoney` (Task 4), `LandingSection` (Task 6).
- Produces: `CycleTimeline` (`<ol>` с четырьмя вехами), `AllocationFlow` (доход + список назначений), `FinancialCycleSection` (`id="cycle"`), `IncomeAllocationSection` (`id="allocation"`).

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/mockups/CycleTimeline.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CycleTimeline from './CycleTimeline.vue';

describe('CycleTimeline', () => {
  it('lists cycle milestones as an ordered list with captions', () => {
    const wrapper = mount(CycleTimeline);

    const items = wrapper.findAll('ol li');
    expect(items).toHaveLength(4);
    expect(items[0]?.text()).toContain('10 сентября');
    expect(items[0]?.text()).toContain('Новый цикл');
    expect(items[1]?.text()).toContain('Следующая выплата');
    expect(items[2]?.text()).toContain('Граница периода');
    expect(wrapper.text()).toContain('Период 25–9');
  });
});
```

`apps/web/app/components/landing/mockups/AllocationFlow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AllocationFlow from './AllocationFlow.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('AllocationFlow', () => {
  it('shows the income and every allocation it feeds', () => {
    const wrapper = mount(AllocationFlow);
    const text = normalize(wrapper.text());

    expect(text).toContain('Зарплата');
    expect(text).toContain('106 000 ₽');
    expect(text).toContain('Обязательные');
    expect(text).toContain('50 000 ₽');
    expect(text).toContain('Текущие 25–9');
    expect(text).toContain('36 000 ₽');
    expect(text).toContain('Ремонт');
    expect(text).toContain('20 000 ₽');
  });

  it('states that allocations never exceed the income', () => {
    const wrapper = mount(AllocationFlow);

    expect(normalize(wrapper.text())).toContain('Распределено 106 000 ₽ из 106 000 ₽');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- CycleTimeline.test.ts AllocationFlow.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `CycleTimeline.vue`**

```vue
<script setup lang="ts">
import { cycleMilestones } from '../../../data/landing.js';

defineOptions({ name: 'CycleTimeline' });

const periods = [
  { label: 'Период 1', range: '10–24' },
  { label: 'Период 25–9', range: '25–9' },
];
</script>

<template>
  <div class="cycle-timeline">
    <ol class="cycle-timeline__list">
      <li v-for="milestone in cycleMilestones" :key="milestone.dateLabel" class="cycle-timeline__item">
        <span class="cycle-timeline__dot" aria-hidden="true" />
        <span class="cycle-timeline__date">{{ milestone.dateLabel }}</span>
        <span class="cycle-timeline__caption">{{ milestone.caption }}</span>
      </li>
    </ol>

    <ul class="cycle-timeline__periods">
      <li v-for="period in periods" :key="period.label" class="cycle-timeline__period">
        <strong>{{ period.label }}</strong>
        <span>{{ period.range }}</span>
      </li>
    </ul>
  </div>
</template>
```

Стили: `.cycle-timeline__list` — `list-style: none; margin: 0; padding: 0; display: grid; gap: var(--hf-space-4)`; на мобилке вертикальный таймлайн с линией `border-left: 2px solid var(--hf-color-border)` и точками `--hf-color-brand-bright`; от 768px — `grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr)`, линия становится горизонтальной (`border-top`). `.cycle-timeline__periods` — два бейджа с фоном `var(--hf-color-brand-soft)`, скругление `var(--hf-radius-md)`.

- [ ] **Step 4: Реализовать `AllocationFlow.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown } from 'lucide-vue-next';

import { formatLandingMoney } from '../format-money.js';
import { allocationData } from '../../../data/landing.js';

defineOptions({ name: 'AllocationFlow' });

const allocations = computed(() =>
  allocationData.allocations.map((item) => ({
    ...item,
    formatted: formatLandingMoney(item.amountMinor),
    percent: Math.round(
      (Number(BigInt(item.amountMinor)) / Number(BigInt(allocationData.incomeMinor))) * 100,
    ),
  })),
);

const allocatedMinor = computed(() =>
  allocationData.allocations
    .reduce((sum, item) => sum + BigInt(item.amountMinor), 0n)
    .toString(),
);

const summary = computed(
  () =>
    `Распределено ${formatLandingMoney(allocatedMinor.value)} из ${formatLandingMoney(
      allocationData.incomeMinor,
    )}`,
);
</script>

<template>
  <div class="allocation-flow">
    <div class="allocation-flow__income">
      <p class="allocation-flow__income-name">{{ allocationData.incomeName }}</p>
      <p class="allocation-flow__income-value">{{ formatLandingMoney(allocationData.incomeMinor) }}</p>
    </div>

    <ArrowDown class="allocation-flow__arrow" :size="24" aria-hidden="true" />

    <ul class="allocation-flow__list">
      <li v-for="item in allocations" :key="item.name" class="allocation-flow__item">
        <span class="allocation-flow__item-name">{{ item.name }}</span>
        <span class="allocation-flow__item-value">{{ item.formatted }}</span>
        <span class="allocation-flow__item-share">{{ item.percent }} %</span>
      </li>
    </ul>

    <p class="allocation-flow__summary">{{ summary }}</p>
  </div>
</template>
```

Стили: карточка на `var(--hf-color-surface)` с границей и `var(--hf-shadow-sm)`; `.allocation-flow__income-value` — `font-size: var(--hf-font-size-h2)`, `tabular-nums`; `.allocation-flow__list` — `list-style: none`, элементы — grid `1fr auto auto` с `gap: var(--hf-space-3)`, разделитель `border-top: 1px solid var(--hf-color-border)`; `.allocation-flow__summary` — `font-size: var(--hf-font-size-small)`, `color: var(--hf-color-text-muted)`.

- [ ] **Step 5: Реализовать секции**

`FinancialCycleSection.vue` — `LandingSection` с `section-id="cycle"`, `eyebrow="Гибкий цикл"`, `title="Ваш бюджет не обязан начинаться первого числа."`, `description="Настройте финансовый цикл под реальные даты ваших доходов и расходов."`, тело — `<CycleTimeline />`.

`IncomeAllocationSection.vue` — `LandingSection` с `section-id="allocation"`, `eyebrow="Распределение дохода"`, `title="Получили деньги — сразу понимаете, куда они пойдут."`, `description="Одно поступление может получить несколько назначений — без создания фиктивных доходов."`, тело — `<AllocationFlow />`.

- [ ] **Step 6: Подключить секции и запустить тесты**

Добавить обе секции в `pages/index.vue` после `AvailableToSpendSection`.

Run: `pnpm --filter @harmofin/web test -- CycleTimeline.test.ts AllocationFlow.test.ts`
Expected: PASS.

- [ ] **Step 7: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add financial cycle and income allocation landing sections"
```

---

### Task 12: Секции «Накопительные цели» и «Обязательные платежи»

**Files:**
- Create: `apps/web/app/components/landing/mockups/GoalsGrid.vue`
- Create: `apps/web/app/components/landing/mockups/GoalsGrid.test.ts`
- Create: `apps/web/app/components/landing/mockups/PlansList.vue`
- Create: `apps/web/app/components/landing/mockups/PlansList.test.ts`
- Create: `apps/web/app/components/landing/sections/GoalsSection.vue`
- Create: `apps/web/app/components/landing/sections/PlansSection.vue`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `goalData`, `upcomingPlans` (Task 3), `formatLandingMoney` (Task 4), `LandingSection`, `LandingProgress`, `LandingMetric` (Task 6).
- Produces: `GoalsGrid` (три `LandingProgress`), `PlansList` (список ближайших обязательств + метрика резерва), `GoalsSection` (`id="goals"`), `PlansSection` (`id="plans"`).

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/mockups/GoalsGrid.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GoalsGrid from './GoalsGrid.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('GoalsGrid', () => {
  it('shows each goal with its progress exposed to assistive technology', () => {
    const wrapper = mount(GoalsGrid);
    const bars = wrapper.findAll('[role="progressbar"]');

    expect(bars).toHaveLength(3);
    expect(normalize(bars[0]?.attributes('aria-label') ?? '')).toBe(
      'Ремонт: 70 000 ₽ из 120 000 ₽',
    );
    expect(bars[0]?.attributes('aria-valuenow')).toBe('58');
    expect(bars[1]?.attributes('aria-valuenow')).toBe('60');
    expect(bars[2]?.attributes('aria-valuenow')).toBe('42');
    expect(normalize(wrapper.text())).toContain('Отпуск');
  });
});
```

`apps/web/app/components/landing/mockups/PlansList.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansList from './PlansList.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('PlansList', () => {
  it('lists upcoming obligations with dates and amounts', () => {
    const wrapper = mount(PlansList);
    const rows = wrapper.findAll('[data-testid="plan-row"]');
    const text = normalize(wrapper.text());

    expect(rows).toHaveLength(5);
    expect(text).toContain('20 сентября');
    expect(text).toContain('Подписки');
    expect(text).toContain('3 000 ₽');
    expect(text).toContain('Ипотека');
    expect(text).toContain('36 000 ₽');
  });

  it('shows how much money the plans reserve', () => {
    const wrapper = mount(PlansList);

    expect(normalize(wrapper.text())).toContain('На обязательства');
    expect(normalize(wrapper.text())).toContain('52 000 ₽');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- GoalsGrid.test.ts PlansList.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `GoalsGrid.vue`**

```vue
<script setup lang="ts">
import LandingProgress from '../ui/LandingProgress.vue';
import { goalData } from '../../../data/landing.js';

defineOptions({ name: 'GoalsGrid' });

const tones = ['brand', 'primary', 'warning'] as const;
</script>

<template>
  <ul class="goals-grid">
    <li v-for="(goal, index) in goalData" :key="goal.name" class="goals-grid__item">
      <LandingProgress
        :label="goal.name"
        :value-minor="goal.savedMinor"
        :target-minor="goal.targetMinor"
        :tone="tones[index % tones.length]"
      />
    </li>
  </ul>
</template>

<style scoped>
.goals-grid {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.goals-grid__item {
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

@media (min-width: 768px) {
  .goals-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: Реализовать `PlansList.vue`**

```vue
<script setup lang="ts">
import LandingMetric from '../ui/LandingMetric.vue';
import { formatLandingMoney } from '../format-money.js';
import { upcomingPlans } from '../../../data/landing.js';

defineOptions({ name: 'PlansList' });
</script>

<template>
  <div class="plans-list">
    <div class="plans-list__card">
      <h3 class="plans-list__title">Ближайшие обязательства</h3>
      <ul class="plans-list__items">
        <li
          v-for="plan in upcomingPlans.items"
          :key="`${plan.dateLabel}-${plan.name}`"
          class="plans-list__row"
          data-testid="plan-row"
        >
          <span class="plans-list__date">{{ plan.dateLabel }}</span>
          <span class="plans-list__name">{{ plan.name }}</span>
          <span class="plans-list__amount">{{ formatLandingMoney(plan.amountMinor) }}</span>
        </li>
      </ul>
    </div>

    <div class="plans-list__reserve">
      <LandingMetric
        label="На обязательства"
        :value="formatLandingMoney(upcomingPlans.reservedMinor)"
        caption="Плановый остаток зарезервирован"
      />
    </div>
  </div>
</template>
```

Стили: `.plans-list` — grid в одну колонку, от 1024px `grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr)` с `gap: var(--hf-space-6)`. `.plans-list__row` — grid `auto 1fr auto`, `gap: var(--hf-space-3)`, `padding-block: var(--hf-space-3)`, разделители `border-top: 1px solid var(--hf-color-border)`; `.plans-list__date` — `color: var(--hf-color-text-muted)`, `font-size: var(--hf-font-size-small)`; `.plans-list__amount` — `font-variant-numeric: tabular-nums`. Ниже 480px строка перестраивается в две (`grid-template-columns: 1fr auto`, дата на отдельной строке через `grid-column: 1 / -1`). `.plans-list__reserve` — карточка с фоном `var(--hf-color-brand-soft)` и радиусом `var(--hf-radius-lg)`.

- [ ] **Step 5: Реализовать секции**

`GoalsSection.vue` — `LandingSection` с `section-id="goals"`, `eyebrow="Накопительные цели"`, `title="Откладывайте на важное, не смешивая его с повседневными расходами."`, `description="Деньги на ремонт остаются деньгами на ремонт. Фонд автомобиля не смешивается с текущими расходами."`, тело — `<GoalsGrid />`.

`PlansSection.vue` — `LandingSection` с `section-id="plans"`, `tone="muted"`, `eyebrow="Планы и обязательства"`, `title="Заранее знайте, какие платежи вас ждут."`, `description="Регулярные планы помогают заранее видеть обязательства, но не превращают плановую сумму в фактическую операцию без подтверждения пользователя."`, тело — `<PlansList />`.

- [ ] **Step 6: Подключить секции и запустить тесты**

Добавить `GoalsSection` и `PlansSection` в `pages/index.vue` после `IncomeAllocationSection`.

Run: `pnpm --filter @harmofin/web test -- GoalsGrid.test.ts PlansList.test.ts`
Expected: PASS (58 %, 60 %, 42 %).

- [ ] **Step 7: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add savings goals and upcoming obligations landing sections"
```

---

### Task 13: Секция «Нестабильный доход»

**Files:**
- Create: `apps/web/app/components/landing/mockups/IncomeComparison.vue`
- Create: `apps/web/app/components/landing/mockups/IncomeComparison.test.ts`
- Create: `apps/web/app/components/landing/sections/VariableIncomeSection.vue`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `variableIncome` (Task 3), `formatLandingMoney`, `formatLandingSignedMoney` (Task 4), `LandingSection` (Task 6).
- Produces: `IncomeComparison` — две карточки «Планировалось / Получено» с подписанной разницей; `VariableIncomeSection` — `id="income"`.

Эта секция есть в ТЗ §16, но отсутствует в макете — реализуется в визуальном языке кита (две карточки-сравнения).

- [ ] **Step 1: Write the failing test**

`apps/web/app/components/landing/mockups/IncomeComparison.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IncomeComparison from './IncomeComparison.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('IncomeComparison', () => {
  it('compares planned and actual income for both cases', () => {
    const wrapper = mount(IncomeComparison);
    const cards = wrapper.findAll('[data-testid="income-case"]');
    const text = normalize(wrapper.text());

    expect(cards).toHaveLength(2);
    expect(text).toContain('Планировалось');
    expect(text).toContain('100 000 ₽');
    expect(text).toContain('Получено');
    expect(text).toContain('106 000 ₽');
    expect(text).toContain('99 000 ₽');
  });

  it('states the difference in words, not only with colour', () => {
    const wrapper = mount(IncomeComparison);
    const cards = wrapper.findAll('[data-testid="income-case"]');

    expect(normalize(cards[0]?.text() ?? '')).toContain('Больше плана на +6 000 ₽');
    expect(normalize(cards[1]?.text() ?? '')).toContain('Меньше плана на −1 000 ₽');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- IncomeComparison.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Реализовать `IncomeComparison.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { TrendingDown, TrendingUp } from 'lucide-vue-next';

import { formatLandingMoney, formatLandingSignedMoney } from '../format-money.js';
import { variableIncome } from '../../../data/landing.js';

defineOptions({ name: 'IncomeComparison' });

const cases = computed(() =>
  variableIncome.cases.map((item) => {
    const planned = BigInt(variableIncome.plannedMinor);
    const received = BigInt(item.receivedMinor);
    const above = received >= planned;
    const deltaMinor = (above ? received - planned : planned - received).toString();

    return {
      receivedMinor: item.receivedMinor,
      received: formatLandingMoney(item.receivedMinor),
      above,
      delta: formatLandingSignedMoney(deltaMinor, above ? 'plus' : 'minus'),
      summary: above ? 'Больше плана на' : 'Меньше плана на',
    };
  }),
);

const planned = computed(() => formatLandingMoney(variableIncome.plannedMinor));
</script>

<template>
  <ul class="income-comparison">
    <li
      v-for="entry in cases"
      :key="entry.receivedMinor"
      class="income-comparison__case"
      data-testid="income-case"
    >
      <p class="income-comparison__label">Планировалось</p>
      <p class="income-comparison__planned">{{ planned }}</p>

      <p class="income-comparison__label">Получено</p>
      <p class="income-comparison__received">{{ entry.received }}</p>

      <p class="income-comparison__delta" :class="entry.above ? 'is-above' : 'is-below'">
        <TrendingUp v-if="entry.above" :size="16" aria-hidden="true" />
        <TrendingDown v-else :size="16" aria-hidden="true" />
        <span>{{ entry.summary }} {{ entry.delta }}</span>
      </p>
    </li>
  </ul>
</template>
```

Стили: `.income-comparison` — `list-style: none; margin: 0; padding: 0; display: grid; gap: var(--hf-space-4)`, от 768px — две колонки. `.income-comparison__case` — карточка на `var(--hf-color-surface)` с границей и `var(--hf-shadow-xs)`. `.income-comparison__received` — `font-size: var(--hf-font-size-h2)`, `tabular-nums`. `.income-comparison__delta` — flex с `gap: var(--hf-space-2)`; `.is-above` — `color: var(--hf-color-brand)`, `.is-below` — `color: var(--hf-color-action-danger)`; смысл дублируется словами «Больше плана на» / «Меньше плана на», цвет не единственный носитель.

- [ ] **Step 4: Реализовать секцию и подключить**

`VariableIncomeSection.vue` — `LandingSection` с `section-id="income"`, `eyebrow="Нестабильный доход"`, `title="Получили меньше. Получили больше. Бюджет не ломается."`, `description="Плановые значения — это ориентир. HarmoFin работает с фактически полученной суммой."`, тело — `<IncomeComparison />`. Добавить секцию в `pages/index.vue` после `PlansSection`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test -- IncomeComparison.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add variable income landing section"
```

---

### Task 14: Аналитика — три SVG-графика

**Files:**
- Create: `apps/web/app/components/landing/mockups/DonutChart.vue`
- Create: `apps/web/app/components/landing/mockups/DonutChart.test.ts`
- Create: `apps/web/app/components/landing/mockups/CashFlowChart.vue`
- Create: `apps/web/app/components/landing/mockups/CashFlowChart.test.ts`
- Create: `apps/web/app/components/landing/mockups/PlanVsFactBars.vue`
- Create: `apps/web/app/components/landing/mockups/PlanVsFactBars.test.ts`
- Create: `apps/web/app/components/landing/sections/AnalyticsSection.vue`
- Create: `apps/web/app/components/landing/sections/AnalyticsSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `analyticsData` (Task 3), `formatLandingMoney` (Task 4), `LandingSection` (Task 6), `useRevealOnScroll` (Task 5).
- Produces: `DonutChart`, `CashFlowChart`, `PlanVsFactBars` — без пропов, каждый рендерит `<svg role="img">` с текстовым резюме в `aria-label` и видимой легендой; `AnalyticsSection` — `id="analytics"`, монтирует графики после появления секции.

`echarts` здесь не используется — маркетинговая страница не тянет библиотеку графиков.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/mockups/DonutChart.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DonutChart from './DonutChart.vue';

describe('DonutChart', () => {
  it('draws one arc per category with cumulative offsets', () => {
    const wrapper = mount(DonutChart);
    const arcs = wrapper.findAll('[data-testid="donut-arc"]');

    expect(arcs).toHaveLength(6);
    expect(arcs[0]?.attributes('stroke-dasharray')).toBe('90.48 376.99');
    expect(arcs[0]?.attributes('stroke-dashoffset')).toBe('0');
    expect(arcs[1]?.attributes('stroke-dashoffset')).toBe('-90.48');
  });

  it('summarises the chart for screen readers and repeats values in the legend', () => {
    const wrapper = mount(DonutChart);
    const svg = wrapper.get('svg');

    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe(
      'Расходы по категориям: Продукты 24 %, Жильё 21 %, Дети 14 %, Автомобиль 10 %, Досуг 8 %, Прочее 23 %',
    );
    expect(wrapper.findAll('[data-testid="donut-legend-item"]')).toHaveLength(6);
    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).toContain('24 %');
  });
});
```

`apps/web/app/components/landing/mockups/CashFlowChart.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CashFlowChart from './CashFlowChart.vue';

describe('CashFlowChart', () => {
  it('draws one polyline per series across every month', () => {
    const wrapper = mount(CashFlowChart);
    const income = wrapper.get('[data-testid="cash-flow-income"]');
    const expense = wrapper.get('[data-testid="cash-flow-expense"]');

    expect(income.attributes('points')?.split(' ')).toHaveLength(6);
    expect(expense.attributes('points')?.split(' ')).toHaveLength(6);
    expect(income.attributes('points')?.startsWith('20,')).toBe(true);
  });

  it('labels the chart and both series in text', () => {
    const wrapper = mount(CashFlowChart);

    expect(wrapper.get('svg').attributes('aria-label')).toBe(
      'Денежный поток за шесть месяцев: доходы от 98 000 ₽ до 112 000 ₽, расходы от 82 000 ₽ до 96 000 ₽',
    );
    expect(wrapper.text()).toContain('Доходы');
    expect(wrapper.text()).toContain('Расходы');
    expect(wrapper.text()).toContain('Сен');
  });
});
```

`apps/web/app/components/landing/mockups/PlanVsFactBars.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanVsFactBars from './PlanVsFactBars.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('PlanVsFactBars', () => {
  it('shows a plan bar and a fact bar for every group', () => {
    const wrapper = mount(PlanVsFactBars);

    expect(wrapper.findAll('[data-testid="plan-bar"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="fact-bar"]')).toHaveLength(3);
  });

  it('repeats plan and fact amounts as text', () => {
    const wrapper = mount(PlanVsFactBars);
    const text = normalize(wrapper.text());

    expect(text).toContain('Обязательные');
    expect(text).toContain('План 50 000 ₽');
    expect(text).toContain('Факт 52 000 ₽');
  });
});
```

`apps/web/app/components/landing/sections/AnalyticsSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AnalyticsSection from './AnalyticsSection.vue';

beforeEach(() => {
  Reflect.deleteProperty(window, 'IntersectionObserver');
});

describe('AnalyticsSection', () => {
  it('presents the analytics promise from the brief', async () => {
    const wrapper = mount(AnalyticsSection, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('section').attributes('id')).toBe('analytics');
    expect(wrapper.get('h2').text()).toBe('Понимайте не только сегодня, но и всю картину.');
    expect(wrapper.text()).toContain(
      'Смотрите расходы по категориям, периодам, циклам, счетам и конвертам — и переходите от показателя к исходным операциям.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- DonutChart.test.ts CashFlowChart.test.ts PlanVsFactBars.test.ts AnalyticsSection.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `DonutChart.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'DonutChart' });

const RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TONES = [
  'var(--hf-color-brand-bright)',
  'var(--hf-color-primary-bright)',
  'var(--hf-color-status-warning-bright)',
  'var(--hf-color-brand)',
  'var(--hf-color-action-primary)',
  'var(--hf-color-slate-200)',
];

const arcs = computed(() => {
  let cumulative = 0;

  return analyticsData.categories.map((category, index) => {
    const length = ((category.share / 100) * CIRCUMFERENCE).toFixed(2);
    const offset = cumulative === 0 ? '0' : `-${((cumulative / 100) * CIRCUMFERENCE).toFixed(2)}`;
    cumulative += category.share;

    return {
      name: category.name,
      share: category.share,
      color: TONES[index % TONES.length],
      dasharray: `${length} ${CIRCUMFERENCE.toFixed(2)}`,
      dashoffset: offset,
    };
  });
});

const summary = computed(
  () =>
    `Расходы по категориям: ${analyticsData.categories
      .map((category) => `${category.name} ${category.share} %`)
      .join(', ')}`,
);
</script>

<template>
  <figure class="donut-chart">
    <svg class="donut-chart__svg" viewBox="0 0 160 160" role="img" :aria-label="summary">
      <g transform="rotate(-90 80 80)">
        <circle
          v-for="arc in arcs"
          :key="arc.name"
          data-testid="donut-arc"
          cx="80"
          cy="80"
          :r="RADIUS"
          fill="none"
          stroke-width="20"
          :stroke="arc.color"
          :stroke-dasharray="arc.dasharray"
          :stroke-dashoffset="arc.dashoffset"
        />
      </g>
    </svg>

    <figcaption class="donut-chart__legend">
      <ul class="donut-chart__list">
        <li
          v-for="arc in arcs"
          :key="arc.name"
          class="donut-chart__item"
          data-testid="donut-legend-item"
        >
          <span class="donut-chart__swatch" :style="{ background: arc.color }" aria-hidden="true" />
          <span class="donut-chart__name">{{ arc.name }}</span>
          <span class="donut-chart__share">{{ arc.share }} %</span>
        </li>
      </ul>
    </figcaption>
  </figure>
</template>
```

Стили: `.donut-chart` — grid в одну колонку, от 768px — `grid-template-columns: auto minmax(0, 1fr)`, `gap: var(--hf-space-6)`, `align-items: center`, `margin: 0`. `.donut-chart__svg` — `width: 10rem; height: 10rem`. `.donut-chart__list` — `list-style: none; margin: 0; padding: 0; display: grid; gap: var(--hf-space-2)`; элемент — grid `auto 1fr auto`. `.donut-chart__swatch` — квадрат `0.625rem` с `border-radius: 2px`. `.donut-chart__share` — `font-variant-numeric: tabular-nums; color: var(--hf-color-text-muted)`.

- [ ] **Step 4: Реализовать `CashFlowChart.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'CashFlowChart' });

const LEFT = 20;
const RIGHT = 300;
const TOP = 20;
const BOTTOM = 140;

const maxMinor = computed(() =>
  analyticsData.cashFlow.reduce((max, point) => {
    const localMax = Math.max(Number(BigInt(point.incomeMinor)), Number(BigInt(point.expenseMinor)));
    return Math.max(max, localMax);
  }, 0),
);

function buildPoints(key: 'incomeMinor' | 'expenseMinor'): string {
  const step = (RIGHT - LEFT) / (analyticsData.cashFlow.length - 1);

  return analyticsData.cashFlow
    .map((point, index) => {
      const x = LEFT + step * index;
      const ratio = Number(BigInt(point[key])) / maxMinor.value;
      const y = BOTTOM - ratio * (BOTTOM - TOP);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(' ');
}

const incomePoints = computed(() => buildPoints('incomeMinor'));
const expensePoints = computed(() => buildPoints('expenseMinor'));

function range(key: 'incomeMinor' | 'expenseMinor'): string {
  const values = analyticsData.cashFlow.map((point) => BigInt(point[key]));
  const min = values.reduce((acc, value) => (value < acc ? value : acc));
  const max = values.reduce((acc, value) => (value > acc ? value : acc));
  return `от ${formatLandingMoney(min.toString())} до ${formatLandingMoney(max.toString())}`;
}

const summary = computed(
  () =>
    `Денежный поток за шесть месяцев: доходы ${range('incomeMinor')}, расходы ${range(
      'expenseMinor',
    )}`,
);
</script>

<template>
  <figure class="cash-flow">
    <svg class="cash-flow__svg" viewBox="0 0 320 160" role="img" :aria-label="summary">
      <line x1="20" y1="140" x2="300" y2="140" class="cash-flow__axis" />
      <polyline data-testid="cash-flow-income" class="cash-flow__line cash-flow__line--income" :points="incomePoints" />
      <polyline data-testid="cash-flow-expense" class="cash-flow__line cash-flow__line--expense" :points="expensePoints" />
    </svg>

    <figcaption class="cash-flow__meta">
      <ul class="cash-flow__legend">
        <li class="cash-flow__legend-item cash-flow__legend-item--income">Доходы</li>
        <li class="cash-flow__legend-item cash-flow__legend-item--expense">Расходы</li>
      </ul>
      <ul class="cash-flow__months">
        <li v-for="point in analyticsData.cashFlow" :key="point.label">{{ point.label }}</li>
      </ul>
    </figcaption>
  </figure>
</template>
```

Стили: `.cash-flow__line` — `fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round`; `--income` — `stroke: var(--hf-color-brand-bright)`, `--expense` — `stroke: var(--hf-color-primary-bright)` и `stroke-dasharray: 6 4` (форма линии, а не только цвет, различает серии). `.cash-flow__axis` — `stroke: var(--hf-color-border)`. `.cash-flow__legend` и `.cash-flow__months` — `list-style: none; margin: 0; padding: 0; display: flex; justify-content: space-between; font-size: var(--hf-font-size-caption); color: var(--hf-color-text-muted)`; у элементов легенды — маркер-квадрат через `::before` в цвете серии.

- [ ] **Step 5: Реализовать `PlanVsFactBars.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { analyticsData } from '../../../data/landing.js';

defineOptions({ name: 'PlanVsFactBars' });

const maxMinor = computed(() =>
  analyticsData.planVsFact.reduce((max, row) => {
    const localMax = Math.max(Number(BigInt(row.planMinor)), Number(BigInt(row.factMinor)));
    return Math.max(max, localMax);
  }, 0),
);

const rows = computed(() =>
  analyticsData.planVsFact.map((row) => ({
    label: row.label,
    plan: formatLandingMoney(row.planMinor),
    fact: formatLandingMoney(row.factMinor),
    planWidth: `${((Number(BigInt(row.planMinor)) / maxMinor.value) * 100).toFixed(1)}%`,
    factWidth: `${((Number(BigInt(row.factMinor)) / maxMinor.value) * 100).toFixed(1)}%`,
  })),
);
</script>

<template>
  <ul class="plan-fact">
    <li v-for="row in rows" :key="row.label" class="plan-fact__row">
      <p class="plan-fact__label">{{ row.label }}</p>

      <p class="plan-fact__values">
        <span>План {{ row.plan }}</span>
        <span>Факт {{ row.fact }}</span>
      </p>

      <div class="plan-fact__bars">
        <div class="plan-fact__bar plan-fact__bar--plan" data-testid="plan-bar" :style="{ width: row.planWidth }" />
        <div class="plan-fact__bar plan-fact__bar--fact" data-testid="fact-bar" :style="{ width: row.factWidth }" />
      </div>
    </li>
  </ul>
</template>
```

Стили: `.plan-fact` — `list-style: none; margin: 0; padding: 0; display: grid; gap: var(--hf-space-4)`. `.plan-fact__values` — flex, `justify-content: space-between`, `font-size: var(--hf-font-size-small)`, `color: var(--hf-color-text-muted)`, `tabular-nums`. `.plan-fact__bar` — высота `0.5rem`, `border-radius: var(--hf-radius-sm)`; `--plan` — `background: var(--hf-color-primary-soft)`, `--fact` — `background: var(--hf-color-brand-bright)`; полосы идут друг под другом с `gap: var(--hf-space-1)`.

- [ ] **Step 6: Реализовать `AnalyticsSection.vue`**

```vue
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

import LandingSection from '../ui/LandingSection.vue';
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

defineOptions({ name: 'AnalyticsSection' });

const DonutChart = defineAsyncComponent(() => import('../mockups/DonutChart.vue'));
const CashFlowChart = defineAsyncComponent(() => import('../mockups/CashFlowChart.vue'));
const PlanVsFactBars = defineAsyncComponent(() => import('../mockups/PlanVsFactBars.vue'));

const { target, revealed } = useRevealOnScroll();
</script>

<template>
  <LandingSection
    section-id="analytics"
    tone="muted"
    eyebrow="Аналитика"
    title="Понимайте не только сегодня, но и всю картину."
    description="Смотрите расходы по категориям, периодам, циклам, счетам и конвертам — и переходите от показателя к исходным операциям."
  >
    <div ref="target" class="analytics__grid">
      <template v-if="revealed">
        <div class="analytics__card">
          <h3 class="analytics__card-title">Расходы по категориям</h3>
          <DonutChart />
        </div>
        <div class="analytics__card">
          <h3 class="analytics__card-title">Денежный поток</h3>
          <CashFlowChart />
        </div>
        <div class="analytics__card analytics__card--wide">
          <h3 class="analytics__card-title">План и факт</h3>
          <PlanVsFactBars />
        </div>
      </template>
    </div>
  </LandingSection>
</template>

<style scoped>
.analytics__grid {
  display: grid;
  gap: var(--hf-space-4);
  min-height: 18rem;
}

.analytics__card {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.analytics__card-title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

@media (min-width: 1024px) {
  .analytics__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics__card--wide {
    grid-column: 1 / -1;
  }
}
</style>
```

`min-height` у сетки удерживает высоту до появления графиков, чтобы ленивый монтаж не дёргал раскладку.

- [ ] **Step 7: Подключить секцию и запустить тесты**

Добавить `AnalyticsSection` в `pages/index.vue` после `VariableIncomeSection`.

Run: `pnpm --filter @harmofin/web test -- DonutChart.test.ts CashFlowChart.test.ts PlanVsFactBars.test.ts AnalyticsSection.test.ts`
Expected: PASS.

- [ ] **Step 8: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add analytics landing section with SVG charts"
```

---

### Task 15: Секция «Один день с HarmoFin»

**Files:**
- Create: `apps/web/app/components/landing/mockups/StepStrip.vue`
- Create: `apps/web/app/components/landing/mockups/StepStrip.test.ts`
- Create: `apps/web/app/components/landing/sections/HowItWorksSection.vue`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `howItWorksSteps` (Task 3), `LandingSection` (Task 6).
- Produces: `StepStrip` — `<ol>` из пяти шагов с номером, заголовком и подписью; `HowItWorksSection` — `id="how-it-works"` (якорь шапки).

- [ ] **Step 1: Write the failing test**

`apps/web/app/components/landing/mockups/StepStrip.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StepStrip from './StepStrip.vue';

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('StepStrip', () => {
  it('renders five ordered steps in the order from the brief', () => {
    const wrapper = mount(StepStrip);
    const items = wrapper.findAll('ol li');

    expect(items).toHaveLength(5);
    expect(items[0]?.text()).toContain('01');
    expect(items[0]?.text()).toContain('Получили зарплату');
    expect(normalize(items[0]?.text() ?? '')).toContain('+106 000 ₽');
    expect(items[4]?.text()).toContain('Накопления продолжают расти');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- StepStrip.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Реализовать `StepStrip.vue`**

```vue
<script setup lang="ts">
import { howItWorksSteps } from '../../../data/landing.js';

defineOptions({ name: 'StepStrip' });
</script>

<template>
  <ol class="step-strip">
    <li v-for="step in howItWorksSteps" :key="step.index" class="step-strip__item">
      <span class="step-strip__index">{{ step.index }}</span>
      <h3 class="step-strip__title">{{ step.title }}</h3>
      <p class="step-strip__caption">{{ step.caption }}</p>
    </li>
  </ol>
</template>

<style scoped>
.step-strip {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.step-strip__item {
  display: grid;
  gap: var(--hf-space-2);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.step-strip__index {
  color: var(--hf-color-brand);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.08em;
}

.step-strip__title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: var(--hf-font-weight-semibold);
}

.step-strip__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
  font-variant-numeric: tabular-nums;
}

@media (min-width: 768px) {
  .step-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .step-strip {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
```

На мобилке шаги идут вертикальным списком (одна колонка), что и требует ТЗ §18; горизонтальная лента появляется только на широком десктопе.

- [ ] **Step 4: Реализовать секцию и подключить**

`HowItWorksSection.vue` — `LandingSection` с `section-id="how-it-works"`, `eyebrow="Простой сценарий"`, `title="Как это работает в реальной жизни"`, `description="Один день с HarmoFin: от поступления денег до понятного остатка."`, тело — `<StepStrip />`. Добавить секцию в `pages/index.vue` после `AnalyticsSection`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test -- StepStrip.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add how-it-works landing section"
```

---

### Task 16: Секции «Для кого», «Roadmap», «Безопасность»

**Files:**
- Create: `apps/web/app/components/landing/sections/AudienceSection.vue`
- Create: `apps/web/app/components/landing/sections/AudienceSection.test.ts`
- Create: `apps/web/app/components/landing/sections/RoadmapSection.vue`
- Create: `apps/web/app/components/landing/sections/RoadmapSection.test.ts`
- Create: `apps/web/app/components/landing/sections/SecuritySection.vue`
- Create: `apps/web/app/components/landing/sections/SecuritySection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `audienceCards`, `roadmapNow`, `roadmapNext`, `securityCards` (Task 3), `LandingSection`, `LandingCard` (Task 6).
- Produces: `AudienceSection` (`id="features"` — якорь «Возможности»), `RoadmapSection` (`id="roadmap"`), `SecuritySection` (`id="security"`).

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/landing/sections/AudienceSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AudienceSection from './AudienceSection.vue';

describe('AudienceSection', () => {
  it('uses the features anchor and lists all three audiences', () => {
    const wrapper = mount(AudienceSection);

    expect(wrapper.get('section').attributes('id')).toBe('features');
    expect(wrapper.get('h2').text()).toBe(
      'HarmoFin подходит тем, кто хочет управлять деньгами осознанно.',
    );
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Семья',
      'Пара',
      'Один человек',
    ]);
  });

  it('does not promise shared family access in the MVP', () => {
    const wrapper = mount(AudienceSection);

    expect(wrapper.text()).toContain(
      'Сегодня HarmoFin помогает вам управлять собственным бюджетом. В дальнейшем — бюджетом всей семьи.',
    );
  });
});
```

`apps/web/app/components/landing/sections/RoadmapSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RoadmapSection from './RoadmapSection.vue';

describe('RoadmapSection', () => {
  it('separates what exists now from what comes next', () => {
    const wrapper = mount(RoadmapSection);

    expect(wrapper.get('section').attributes('id')).toBe('roadmap');
    const now = wrapper.get('[data-testid="roadmap-now"]');
    const next = wrapper.get('[data-testid="roadmap-next"]');

    expect(now.findAll('li')).toHaveLength(6);
    expect(next.findAll('li')).toHaveLength(6);
    expect(now.text()).toContain('Конверты');
    expect(next.text()).toContain('Банковские интеграции');
    expect(now.text()).not.toContain('Банковские интеграции');
  });
});
```

`apps/web/app/components/landing/sections/SecuritySection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SecuritySection from './SecuritySection.vue';

describe('SecuritySection', () => {
  it('describes access, isolation and audit guarantees', () => {
    const wrapper = mount(SecuritySection);

    expect(wrapper.get('section').attributes('id')).toBe('security');
    expect(wrapper.get('h2').text()).toBe('Ваши финансовые данные — только ваши.');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Защищённый доступ',
      'Изоляция бюджета',
      'История изменений',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- AudienceSection.test.ts RoadmapSection.test.ts SecuritySection.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Реализовать `AudienceSection.vue`**

```vue
<script setup lang="ts">
import { Users, Heart, User } from 'lucide-vue-next';

import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { audienceCards } from '../../../data/landing.js';

defineOptions({ name: 'AudienceSection' });

const icons = [Users, Heart, User];
</script>

<template>
  <LandingSection
    section-id="features"
    eyebrow="Для кого"
    title="HarmoFin подходит тем, кто хочет управлять деньгами осознанно."
    description="Сегодня HarmoFin помогает вам управлять собственным бюджетом. В дальнейшем — бюджетом всей семьи."
  >
    <div class="audience__grid">
      <LandingCard v-for="(card, index) in audienceCards" :key="card.title" :title="card.title">
        <template #icon>
          <component :is="icons[index]" :size="20" />
        </template>
        {{ card.text }}
      </LandingCard>
    </div>
  </LandingSection>
</template>

<style scoped>
.audience__grid {
  display: grid;
  gap: var(--hf-space-4);
}

@media (min-width: 768px) {
  .audience__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: Реализовать `RoadmapSection.vue` и `SecuritySection.vue`**

`RoadmapSection.vue` — `LandingSection` с `section-id="roadmap"`, `tone="muted"`, `eyebrow="Развитие"`, `title="Начинаем с простого. Растём вместе с вами."`; тело — две колонки:

```vue
<div class="roadmap__grid">
  <div class="roadmap__column" data-testid="roadmap-now">
    <h3 class="roadmap__heading">Сейчас</h3>
    <ul class="roadmap__list">
      <li v-for="item in roadmapNow" :key="item" class="roadmap__item">
        <Check :size="16" aria-hidden="true" />
        <span>{{ item }}</span>
      </li>
    </ul>
  </div>

  <div class="roadmap__column" data-testid="roadmap-next">
    <h3 class="roadmap__heading">Дальше</h3>
    <ul class="roadmap__list">
      <li v-for="item in roadmapNext" :key="item" class="roadmap__item roadmap__item--next">
        <Circle :size="16" aria-hidden="true" />
        <span>{{ item }}</span>
      </li>
    </ul>
  </div>
</div>
```

Иконки `Check` и `Circle` — из `lucide-vue-next`; статус «сейчас/дальше» передаётся и заголовком колонки, и формой иконки, не только цветом. Сетка: одна колонка до 768px, две — от 768px, `gap: var(--hf-space-6)`; списки без маркеров, элементы — flex с `gap: var(--hf-space-2)`; `.roadmap__item` — `color: var(--hf-color-text)`, иконка `color: var(--hf-color-brand)`; `.roadmap__item--next` — иконка `color: var(--hf-color-text-muted)`.

`SecuritySection.vue` — `LandingSection` с `section-id="security"`, `eyebrow="Безопасность"`, `title="Ваши финансовые данные — только ваши."`, тело — сетка из трёх `LandingCard` по `securityCards` с иконками `ShieldCheck`, `Lock`, `History` из `lucide-vue-next` (три колонки от 768px).

- [ ] **Step 5: Подключить секции и запустить тесты**

Добавить `AudienceSection`, `RoadmapSection`, `SecuritySection` в `pages/index.vue` после `HowItWorksSection`.

Run: `pnpm --filter @harmofin/web test -- AudienceSection.test.ts RoadmapSection.test.ts SecuritySection.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add audience, roadmap and security landing sections"
```

---

### Task 17: FAQ-аккордеон

**Files:**
- Create: `apps/web/app/components/landing/sections/FaqSection.vue`
- Create: `apps/web/app/components/landing/sections/FaqSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `faqItems` (Task 3), `LandingSection` (Task 6).
- Produces: `FaqSection` — `id="faq"`; каждая кнопка вопроса имеет `aria-expanded` и `aria-controls`, панель — `role="region"` и `aria-labelledby`; одновременно открыт максимум один вопрос.

- [ ] **Step 1: Write the failing test**

`apps/web/app/components/landing/sections/FaqSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FaqSection from './FaqSection.vue';

describe('FaqSection', () => {
  it('renders every question collapsed with accessible wiring', () => {
    const wrapper = mount(FaqSection);
    const buttons = wrapper.findAll('[data-testid="faq-question"]');

    expect(wrapper.get('section').attributes('id')).toBe('faq');
    expect(buttons).toHaveLength(6);
    expect(buttons[0]?.attributes('aria-expanded')).toBe('false');
    expect(buttons[0]?.attributes('aria-controls')).toBe('faq-panel-what-is');
    expect(wrapper.find('#faq-panel-what-is').exists()).toBe(false);
  });

  it('opens a question on activation and labels its panel', async () => {
    const wrapper = mount(FaqSection);
    const button = wrapper.findAll('[data-testid="faq-question"]')[0];

    await button?.trigger('click');

    const panel = wrapper.get('#faq-panel-what-is');
    expect(button?.attributes('aria-expanded')).toBe('true');
    expect(panel.attributes('role')).toBe('region');
    expect(panel.attributes('aria-labelledby')).toBe('faq-question-what-is');
    expect(panel.text()).toContain('веб-приложение для управления личным и семейным бюджетом');
  });

  it('keeps at most one question open', async () => {
    const wrapper = mount(FaqSection);
    const buttons = wrapper.findAll('[data-testid="faq-question"]');

    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');

    expect(buttons[0]?.attributes('aria-expanded')).toBe('false');
    expect(buttons[1]?.attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('[role="region"]')).toHaveLength(1);
  });

  it('closes an open question when it is activated again', async () => {
    const wrapper = mount(FaqSection);
    const button = wrapper.findAll('[data-testid="faq-question"]')[0];

    await button?.trigger('click');
    await button?.trigger('click');

    expect(button?.attributes('aria-expanded')).toBe('false');
    expect(wrapper.findAll('[role="region"]')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- FaqSection.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Реализовать `FaqSection.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';

import LandingSection from '../ui/LandingSection.vue';
import { faqItems } from '../../../data/landing.js';

defineOptions({ name: 'FaqSection' });

const openId = ref<string | null>(null);

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
}
</script>

<template>
  <LandingSection section-id="faq" eyebrow="FAQ" title="Ответы на популярные вопросы.">
    <ul class="faq__list">
      <li v-for="item in faqItems" :key="item.id" class="faq__item">
        <h3 class="faq__heading">
          <button
            :id="`faq-question-${item.id}`"
            type="button"
            class="faq__question"
            data-testid="faq-question"
            :aria-expanded="openId === item.id ? 'true' : 'false'"
            :aria-controls="`faq-panel-${item.id}`"
            @click="toggle(item.id)"
          >
            <span>{{ item.question }}</span>
            <ChevronDown
              class="faq__chevron"
              :class="{ 'faq__chevron--open': openId === item.id }"
              :size="20"
              aria-hidden="true"
            />
          </button>
        </h3>

        <div
          v-if="openId === item.id"
          :id="`faq-panel-${item.id}`"
          class="faq__panel"
          role="region"
          :aria-labelledby="`faq-question-${item.id}`"
        >
          {{ item.answer }}
        </div>
      </li>
    </ul>
  </LandingSection>
</template>

<style scoped>
.faq__list {
  display: grid;
  gap: var(--hf-space-2);
  max-width: 48rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.faq__item {
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
}

.faq__heading {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-medium);
}

.faq__question {
  display: flex;
  gap: var(--hf-space-4);
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 3rem;
  padding: var(--hf-space-4);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.faq__chevron {
  flex: none;
  color: var(--hf-color-text-muted);
  transition: transform var(--hf-transition-fast);
}

.faq__chevron--open {
  transform: rotate(180deg);
}

.faq__panel {
  padding: 0 var(--hf-space-4) var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}
</style>
```

Кнопка — нативный `<button>`, поэтому `Enter` и `Space` работают без дополнительного кода, фокус подсвечивается общим `:focus-visible` из `base.css`.

- [ ] **Step 4: Подключить секцию и запустить тесты**

Добавить `FaqSection` в `pages/index.vue` после `SecuritySection`.

Run: `pnpm --filter @harmofin/web test -- FaqSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add accessible FAQ accordion to the landing page"
```

---

### Task 18: Финальный CTA

**Files:**
- Create: `apps/web/app/components/landing/sections/FinalCtaSection.vue`
- Create: `apps/web/app/components/landing/sections/FinalCtaSection.test.ts`
- Modify: `apps/web/app/pages/index.vue`

**Interfaces:**
- Consumes: `UiButton` (Task 2), `DashboardMockup` (Task 8).
- Produces: `FinalCtaSection` — брендовый блок с `<h2>`, основной кнопкой на `/register` и ссылкой на `#features`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/components/landing/sections/FinalCtaSection.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FinalCtaSection from './FinalCtaSection.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('FinalCtaSection', () => {
  it('closes the page with the brief copy and both actions', () => {
    const wrapper = mount(FinalCtaSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    expect(wrapper.get('h2').text()).toBe('Хватит гадать, сколько можно потратить.');
    expect(wrapper.text()).toContain(
      'Создайте свой бюджет, распределите деньги по назначениям и всегда знайте свой реальный доступный остаток.',
    );

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('#features');
    expect(wrapper.text()).toContain('Без банковской привязки. Без сложной настройки.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- FinalCtaSection.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Реализовать `FinalCtaSection.vue`**

```vue
<script setup lang="ts">
import DashboardMockup from '../mockups/DashboardMockup.vue';
import UiButton from '../../ui/Button.vue';

defineOptions({ name: 'FinalCtaSection' });
</script>

<template>
  <section class="final-cta" aria-labelledby="final-cta-title">
    <div class="final-cta__inner">
      <div class="final-cta__content">
        <h2 id="final-cta-title" class="final-cta__title">
          Хватит гадать, сколько можно потратить.
        </h2>
        <p class="final-cta__description">
          Создайте свой бюджет, распределите деньги по назначениям и всегда знайте свой реальный
          доступный остаток.
        </p>
        <div class="final-cta__actions">
          <UiButton to="/register" variant="brand" size="lg">Начать бесплатно</UiButton>
          <a class="final-cta__secondary" href="#features">Посмотреть возможности</a>
        </div>
        <p class="final-cta__note">Без банковской привязки. Без сложной настройки.</p>
      </div>

      <div class="final-cta__preview">
        <DashboardMockup />
      </div>
    </div>
  </section>
</template>

<style scoped>
.final-cta {
  padding: var(--hf-space-16) var(--hf-space-4);
  background: var(--hf-color-brand-soft);
}

.final-cta__inner {
  display: grid;
  gap: var(--hf-space-8);
  max-width: var(--hf-container-max);
  margin: 0 auto;
}

.final-cta__title {
  margin: 0 0 var(--hf-space-3);
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
  font-weight: var(--hf-font-weight-semibold);
}

.final-cta__description {
  margin: 0 0 var(--hf-space-6);
  max-width: 34rem;
  color: var(--hf-color-text-muted);
}

.final-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  align-items: center;
}

.final-cta__secondary {
  color: var(--hf-color-action-primary);
  text-decoration: none;
}

.final-cta__secondary:hover {
  text-decoration: underline;
}

.final-cta__note {
  margin: var(--hf-space-4) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.final-cta__preview {
  display: none;
}

@media (min-width: 1024px) {
  .final-cta {
    padding: var(--hf-space-20) var(--hf-space-8);
  }

  .final-cta__inner {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
    align-items: center;
  }

  .final-cta__preview {
    display: block;
  }
}
</style>
```

Превью продукта показывается только на десктопе — на мобилке тот же mockup уже есть в Hero, и повторять его во всю высоту экрана незачем.

- [ ] **Step 4: Подключить секцию и запустить тесты**

Добавить `FinalCtaSection` в `pages/index.vue` последним элементом внутри `<main>`, перед `LandingFooter`.

Run: `pnpm --filter @harmofin/web test -- FinalCtaSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing apps/web/app/pages/index.vue
git commit -m "feat(web): add final call-to-action landing section"
```

---

### Task 19: Появление секций при скролле

**Files:**
- Modify: `apps/web/app/components/landing/ui/LandingSection.vue`
- Modify: `apps/web/app/components/landing/ui/LandingSection.test.ts`

**Interfaces:**
- Consumes: `useRevealOnScroll` (Task 5).
- Produces: `LandingSection` добавляет класс `is-revealed` после появления в viewport; до этого содержимое сдвинуто и прозрачно. Все секции, построенные на `LandingSection`, получают анимацию без изменений в своих файлах.

- [ ] **Step 1: Добавить падающий тест в `LandingSection.test.ts`**

Дописать в существующий `describe`:

```ts
  it('reveals itself immediately when IntersectionObserver is unavailable', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const wrapper = mount(LandingSection, {
      props: { sectionId: 'goals', title: 'Цели' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).toContain('is-revealed');
  });

  it('stays hidden until the observer reports an intersection', async () => {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    class TestObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    }
    window.IntersectionObserver = TestObserver as unknown as typeof window.IntersectionObserver;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;

    const wrapper = mount(LandingSection, {
      props: { sectionId: 'plans', title: 'Планы' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).not.toContain('is-revealed');

    callbacks[0]?.([{ isIntersecting: true }]);
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).toContain('is-revealed');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- LandingSection.test.ts`
Expected: FAIL — класс `is-revealed` не выставляется.

- [ ] **Step 3: Подключить композабл в `LandingSection.vue`**

В `<script setup>` добавить:

```ts
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

const { target, revealed } = useRevealOnScroll();
```

В шаблоне навесить `ref` и класс на внутренний контейнер:

```vue
<div ref="target" class="landing-section__inner" :class="{ 'is-revealed': revealed }">
```

В стили добавить:

```css
.landing-section__inner {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  transition:
    opacity 400ms ease-out,
    transform 400ms ease-out;
}

.landing-section__inner.is-revealed {
  opacity: 1;
  transform: none;
}
```

Глобальное правило `prefers-reduced-motion` в `base.css` сводит длительность перехода к 0.01 мс, а `useRevealOnScroll` в этом режиме сразу ставит `revealed = true`, поэтому секции остаются видимыми и без анимации.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS — весь набор тестов веба.

- [ ] **Step 5: Проверки и коммит**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/landing/ui/LandingSection.vue apps/web/app/components/landing/ui/LandingSection.test.ts
git commit -m "feat(web): reveal landing sections on scroll with reduced-motion support"
```

---

### Task 20: Адаптивность, e2e и финальная проверка

**Files:**
- Create: `e2e/landing.spec.ts`
- Modify: `apps/web/app/assets/styles/base.css` (плавный скролл к якорям)
- Modify: файлы секций — только если проверка ширин выявит переполнение

**Interfaces:**
- Consumes: всю страницу из задач 7–19.
- Produces: e2e-покрытие навигации, CTA, FAQ и отсутствия горизонтального переполнения.

- [ ] **Step 1: Добавить плавный скролл с учётом высоты шапки**

В `apps/web/app/assets/styles/base.css` в правило `html` добавить `scroll-behavior: smooth;` (существующий блок `prefers-reduced-motion` уже сбрасывает его на `auto`), а в `tokens.css` — ничего не менять: отступ якоря задан в `LandingSection` через `scroll-margin-top: 5rem`.

- [ ] **Step 2: Написать e2e-спецификацию**

`e2e/landing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('presents the hero promise and the page metadata', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');

    await expect(page).toHaveTitle('HarmoFin — управляйте личными и семейными финансами');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Понимайте свои деньги, а не просто записывайте расходы.',
    );
    expect(consoleErrors).toEqual([]);
  });

  test('navigates to the anchors from the header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.getByRole('link', { name: 'Безопасность' }).first().click();

    await expect(page).toHaveURL(/#security$/);
    await expect(page.locator('#security')).toBeInViewport();
  });

  test('sends both calls to action to the auth routes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Начать бесплатно' }).first()).toHaveAttribute(
      'href',
      '/register',
    );
    await expect(page.getByRole('link', { name: 'Войти' }).first()).toHaveAttribute(
      'href',
      '/login',
    );
  });

  test('operates the FAQ accordion with the keyboard', async ({ page }) => {
    await page.goto('/');

    const question = page.getByRole('button', { name: 'Что такое HarmoFin?' });
    await question.focus();
    await page.keyboard.press('Enter');

    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Что такое HarmoFin?' })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'false');
  });

  test('never overflows horizontally on narrow screens', async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');

      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root ? root.scrollWidth - root.clientWidth : 0;
      });

      expect(overflow, `viewport ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 3: Прогнать ручную проверку ширин**

Запустить `pnpm --filter @harmofin/web dev` и открыть `http://localhost:3000/` на ширинах 320, 390, 768, 1024, 1280, 1440. Для каждой проверить: нет горизонтальной прокрутки, CTA читаемы и не обрезаны, mockup-и не выходят за контейнер, таймлайн и список платежей перестроены вертикально на 320–480, графики не наезжают на легенду. Найденные проблемы чинить в CSS соответствующей секции (менять только медиазапросы и раскладку, не трогая разметку и тексты).

- [ ] **Step 4: Прогнать проверку доступности вручную**

На ширине 1440 пройти страницу только клавиатурой: `Tab` доходит до всех ссылок шапки, обеих CTA, кнопок FAQ; фокус виден на каждом элементе; `Escape` закрывает мобильное меню (на 390). Убедиться, что у графиков есть `aria-label`, а у декоративных блоков — `aria-hidden="true"`.

- [ ] **Step 5: Полный прогон проверок**

```bash
pnpm format:check
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
```

Expected: все команды завершаются успешно. Playwright локально не запускаем — `pnpm test:e2e` отработает в CI.

- [ ] **Step 6: Коммит**

```bash
git add e2e/landing.spec.ts apps/web/app/assets/styles/base.css apps/web/app/components/landing
git commit -m "test(e2e): cover landing navigation, CTA, FAQ and narrow viewports"
```

---

## Проверка покрытия ТЗ

| Раздел ТЗ | Где реализован |
| --- | --- |
| §6 Header | Task 7 |
| §7–8 Hero и mockup | Task 8 |
| §9 Проблема | Task 9 |
| §10 Счета + конверты | Task 9 |
| §11 Можно потратить | Task 10 |
| §12 Финансовый цикл | Task 11 |
| §13 Распределение дохода | Task 11 |
| §14 Накопления | Task 12 |
| §15 Обязательные платежи | Task 12 |
| §16 Нестабильный доход | Task 13 |
| §17 Аналитика (donut, cash flow, plan vs fact) | Task 14 |
| §18 Один день с HarmoFin | Task 15 |
| §19 Для кого | Task 16 |
| §20 Roadmap | Task 16 |
| §21 Безопасность | Task 16 |
| §22 FAQ | Task 17 |
| §23 Финальный CTA | Task 18 |
| §24 Footer | Task 7 |
| §25–26 Визуальное направление и токены | Task 1, Task 6 |
| §27 Responsive | Task 20 (плюс медиазапросы в каждой секции) |
| §28 Animation и reduced motion | Task 5, Task 10, Task 19 |
| §29 Компонентная архитектура | Task 6–18 |
| §30 Данные mockup-ов | Task 3, Task 4 |
| §31 CTA behaviour | Task 2, Task 7, Task 8, Task 18 |
| §32 SEO | Task 7 |
| §33 Accessibility | Task 6, Task 10, Task 14, Task 17, Task 20 |
| §34 Performance | Task 14 (ленивый монтаж, SVG вместо библиотеки), Task 8 (без битмапов) |
| §39 Definition of Done | Task 20 |
