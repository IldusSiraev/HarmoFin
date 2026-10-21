# Редизайн раздела «Конверты» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести страницу «Конверты» и её диалоги («Детали», «Переложить», «Распределить деньги», «Правила пополнения») на макет владельца в стиле Calm Fintech, добавив цвет типов конвертов и заметные статусы.

**Architecture:** Только `apps/web`. Сначала токены цветов и пять небольших общих компонентов (`EnvelopeTypeIcon`, тон у `UiProgress`, `UiAttentionRow`, `UiAmountHero`, `UiBeforeAfter`), затем экраны по одному, каждый со своими тестами. Данные — существующие API (`listEnvelopes`, `getDashboard`, `listFundingRules`, preview/confirm, move); браузер не считает деньги, кроме предпросмотра «было → стало» в «Переложить» на минорных единицах `bigint`.

**Tech Stack:** Nuxt 4 / Vue 3.5, TypeScript strict, Vitest + `@vue/test-utils` + happy-dom, `@lucide/vue`, CSS-токены `tokens.css`. Playwright — только CI.

**Spec:** [docs/superpowers/specs/2026-10-21-envelopes-redesign-design.md](../specs/2026-10-21-envelopes-redesign-design.md)

## Global Constraints

- Изменения только в `apps/web`, `e2e/` и `docs/`; API, расчёты, OpenAPI, Prisma не меняются.
- Деньги — строки минорных единиц с сервера; суммы не складываются и не вычитаются в браузере. Единственное исключение — предпросмотр `UiBeforeAfter` в «Переложить» (`bigint`), который сервер проверяет при сохранении.
- Цвет — только токены `--hf-*`; новые цвета — только токены типов конвертов из спеки §1.1. Контраст текста/иконки ≥ 4.5:1 в светлой и тёмной теме.
- Цвет типа — только плашка иконки и заполнение прогресса; суммы, названия и текст карточки цвет типа не получают.
- Каждый статус — текст + иконка, не только цвет.
- Icon-only кнопки — `aria-label` и `tooltip`; касание ≥ 44px; видимый фокус; подписи и ошибки у полей.
- Тексты интерфейса — русский по глоссарию (`распределить`, `Отложено`, `Не распределено`, `Переложить`); имена в коде — английские.
- Новых npm-зависимостей нет.
- Существующие `data-testid` сохраняются, если в задаче не сказано иначе (на них опираются unit- и E2E-тесты).
- Local Playwright не запускать; E2E выполняет CI.
- Не создавать worktree, не делать push; субагенты не коммитят — stage-only, коммитит главная сессия после ревью.
- Не трогать `identity/logo_description.png`.

## Как запускать проверки

- Focused web-тесты: из `apps/web` — `pnpm exec vitest run <path>` (фильтр `pnpm --filter … test -- <path>` в этом репозитории игнорирует путь).
- Полный web: `pnpm --filter @harmofin/web test`; типы: `pnpm --filter @harmofin/web typecheck`; lint: из `apps/web` — `npx eslint <files>`; формат: `npx prettier --check <files>`.

---

### Task 1: Токены типов конвертов, `EnvelopeTypeIcon`, тон `UiProgress`, гайдлайны

**Files:**
- Modify: `apps/web/app/assets/styles/tokens.css`
- Create: `apps/web/app/components/envelopes/EnvelopeTypeIcon.vue`
- Create: `apps/web/app/components/envelopes/EnvelopeTypeIcon.test.ts`
- Modify: `apps/web/app/components/ui/Progress.vue`
- Modify: `apps/web/app/components/ui/Progress.test.ts`
- Modify: `apps/web/app/components/envelopes/envelope-plan-kind.ts` (+ `envelope-plan-kind.test.ts`)
- Modify: `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md`

**Interfaces:**
- Produces: CSS-токены `--hf-color-envelope-{current|mandatory|savings|reserve|custom}` и `--hf-color-envelope-{…}-soft`; `envelopeTone(envelopeType: string): EnvelopeTone` и `type EnvelopeTone = 'current' | 'mandatory' | 'savings' | 'reserve' | 'custom'` в `envelope-plan-kind.ts`; `<EnvelopeTypeIcon :envelope-type="string" size?="'sm' | 'md'" />`; `UiProgress` prop `tone?: EnvelopeTone | 'warning' | 'danger'`.

- [ ] **Step 1: Падающие тесты**

`envelope-plan-kind.test.ts` — добавить:

```ts
import { envelopeTone } from './envelope-plan-kind.js';

describe('envelopeTone', () => {
  it('сопоставляет тип конверта с тоном', () => {
    expect(envelopeTone('CURRENT_EXPENSES')).toBe('current');
    expect(envelopeTone('MANDATORY_EXPENSES')).toBe('mandatory');
    expect(envelopeTone('SAVINGS_GOAL')).toBe('savings');
    expect(envelopeTone('RESERVE')).toBe('reserve');
    expect(envelopeTone('CUSTOM')).toBe('custom');
    expect(envelopeTone('UNKNOWN')).toBe('custom');
  });
});
```

`EnvelopeTypeIcon.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeTypeIcon from './EnvelopeTypeIcon.vue';

describe('EnvelopeTypeIcon', () => {
  it('ставит класс тона и скрывает иконку от скринридера', () => {
    const wrapper = mount(EnvelopeTypeIcon, { props: { envelopeType: 'SAVINGS_GOAL' } });
    expect(wrapper.classes()).toContain('envelope-type-icon--savings');
    expect(wrapper.classes()).toContain('envelope-type-icon--md');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('малый размер', () => {
    const wrapper = mount(EnvelopeTypeIcon, { props: { envelopeType: 'RESERVE', size: 'sm' } });
    expect(wrapper.classes()).toContain('envelope-type-icon--sm');
    expect(wrapper.classes()).toContain('envelope-type-icon--reserve');
  });
});
```

`Progress.test.ts` — добавить:

```ts
it('тон задаёт класс заполнения', () => {
  const wrapper = mount(UiProgress, {
    props: { value: '50', max: '100', label: 'Цель', tone: 'savings' },
  });
  expect(wrapper.find('.ui-progress__fill').classes()).toContain('ui-progress__fill--savings');
});

it('без тона — прежний вид', () => {
  const wrapper = mount(UiProgress, { props: { value: '50', max: '100', label: 'Цель' } });
  expect(wrapper.find('.ui-progress__fill').classes()).toEqual(['ui-progress__fill']);
});
```

(импорт `UiProgress`/`mount` — как уже сделано в файле.)

- [ ] **Step 2: Убедиться, что падают**

Run (из `apps/web`): `pnpm exec vitest run app/components/envelopes/EnvelopeTypeIcon.test.ts app/components/envelopes/envelope-plan-kind.test.ts app/components/ui/Progress.test.ts`
Expected: FAIL — нет `envelopeTone`, нет компонента, нет класса тона.

- [ ] **Step 3: Токены**

В `tokens.css` в светлом блоке рядом с палитрой:

```css
  /* Envelope type hues: icon tile + progress fill only (Calm Fintech §«Цвет типов»). */
  --hf-color-envelope-current: var(--hf-color-brand);
  --hf-color-envelope-current-soft: var(--hf-color-brand-soft);
  --hf-color-envelope-mandatory: var(--hf-color-primary-strong);
  --hf-color-envelope-mandatory-soft: var(--hf-color-primary-soft);
  --hf-color-envelope-savings: #7c5cc4;
  --hf-color-envelope-savings-soft: #efeafa;
  --hf-color-envelope-reserve: #4f5bd5;
  --hf-color-envelope-reserve-soft: #eceefb;
  --hf-color-envelope-custom: var(--hf-color-slate-500);
  --hf-color-envelope-custom-soft: #eef1f4;
```

В блоке `[data-theme='dark']`:

```css
  --hf-color-envelope-current: #4dc9c1;
  --hf-color-envelope-savings: #b49cf0;
  --hf-color-envelope-savings-soft: rgb(124 92 196 / 22%);
  --hf-color-envelope-reserve: #98a1f2;
  --hf-color-envelope-reserve-soft: rgb(79 91 213 / 22%);
  --hf-color-envelope-custom-soft: rgb(255 255 255 / 8%);
```

(`mandatory` и `custom` в тёмной теме следуют переопределённым `primary-strong`/`slate-500`; `current-soft` — `brand-soft`.)

Проверить контраст каждой пары «цвет на своём `-soft`» и «цвет на `--hf-color-surface`» (светлая `#ffffff`, тёмная `#10203a`) по формуле WCAG 2.x relative luminance — небольшим node-скриптом во временном каталоге вне репозитория. Требование ≥ 3:1 для иконки (нетекстовый элемент) и ≥ 4.5:1 там, где цвет используется для текста (в этом плане цвет типа текстом не используется). Если пара не проходит — сдвинуть значение и записать итоговые числа в отчёт.

- [ ] **Step 4: `envelopeTone` и компонент**

В `envelope-plan-kind.ts`:

```ts
export type EnvelopeTone = 'current' | 'mandatory' | 'savings' | 'reserve' | 'custom';

const TONES: Record<string, EnvelopeTone> = {
  CURRENT_EXPENSES: 'current',
  MANDATORY_EXPENSES: 'mandatory',
  SAVINGS_GOAL: 'savings',
  RESERVE: 'reserve',
};

export function envelopeTone(envelopeType: string): EnvelopeTone {
  return TONES[envelopeType] ?? 'custom';
}
```

`EnvelopeTypeIcon.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { envelopeTone, planIcon } from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopeTypeIcon' });

const props = withDefaults(defineProps<{ envelopeType: string; size?: 'sm' | 'md' }>(), {
  size: 'md',
});

const icon = computed(() => planIcon({ envelopeType: props.envelopeType }));
const tone = computed(() => envelopeTone(props.envelopeType));
</script>

<template>
  <span
    class="envelope-type-icon"
    :class="[`envelope-type-icon--${tone}`, `envelope-type-icon--${size}`]"
    aria-hidden="true"
  >
    <component :is="icon" :size="size === 'sm' ? 16 : 20" />
  </span>
</template>

<style scoped>
.envelope-type-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--hf-radius-md);
}

.envelope-type-icon--md {
  width: 2.5rem;
  height: 2.5rem;
}

.envelope-type-icon--sm {
  width: 2rem;
  height: 2rem;
}

.envelope-type-icon--current {
  background: var(--hf-color-envelope-current-soft);
  color: var(--hf-color-envelope-current);
}

.envelope-type-icon--mandatory {
  background: var(--hf-color-envelope-mandatory-soft);
  color: var(--hf-color-envelope-mandatory);
}

.envelope-type-icon--savings {
  background: var(--hf-color-envelope-savings-soft);
  color: var(--hf-color-envelope-savings);
}

.envelope-type-icon--reserve {
  background: var(--hf-color-envelope-reserve-soft);
  color: var(--hf-color-envelope-reserve);
}

.envelope-type-icon--custom {
  background: var(--hf-color-envelope-custom-soft);
  color: var(--hf-color-envelope-custom);
}
</style>
```

`planIcon` принимает `Pick<EnvelopePlanDto, 'envelopeType'>` — объект `{ envelopeType }` подходит.

- [ ] **Step 5: Тон в `UiProgress`**

```ts
import type { EnvelopeTone } from '../envelopes/envelope-plan-kind.js';

const props = defineProps<{
  value: string;
  max: string;
  label: string;
  tone?: EnvelopeTone | 'warning' | 'danger' | undefined;
}>();
```

Шаблон: `<div class="ui-progress__fill" :class="tone ? `ui-progress__fill--${tone}` : undefined" …>`. Стили:

```css
.ui-progress__fill--current { background: var(--hf-color-envelope-current); }
.ui-progress__fill--mandatory { background: var(--hf-color-envelope-mandatory); }
.ui-progress__fill--savings { background: var(--hf-color-envelope-savings); }
.ui-progress__fill--reserve { background: var(--hf-color-envelope-reserve); }
.ui-progress__fill--custom { background: var(--hf-color-envelope-custom); }
.ui-progress__fill--warning { background: var(--hf-color-status-warning-bright); }
.ui-progress__fill--danger { background: var(--hf-color-danger-strong); }
```

(по одной декларации на строку в реальном файле — как требует Prettier.)

Если импорт типа из `../envelopes/` в `ui/` нарушает правило lint о направлении импортов — объявить тот же union-тип прямо в `Progress.vue`.

- [ ] **Step 6: Гайдлайны**

В `2026-09-17-calm-fintech-visual-guidelines.md` после раздела «Палитра» добавить раздел:

```markdown
## Цвет типов конвертов и заметные статусы

Решение владельца 2026-10-21: интерфейс не должен быть только бирюзово-чёрным. Цвет добавляется двумя способами, и только ими.

**Цвет типа конверта** — плашка иконки (фон `-soft`, иконка цветом) и заполнение полосы прогресса. Суммы, названия и текст цвет типа не получают.

| Тип | Токен | Светлая | Тёмная |
|---|---|---|---|
| На текущие траты | `--hf-color-envelope-current` | brand `#1BA39C` / brand-soft | `#4DC9C1` |
| Обязательные платежи | `--hf-color-envelope-mandatory` | primary-strong `#2C5B8A` / primary-soft | `#6FB1E6` |
| Накопления | `--hf-color-envelope-savings` | `#7C5CC4` / `#EFEAFA` | `#B49CF0` |
| Резерв | `--hf-color-envelope-reserve` | `#4F5BD5` / `#ECEEFB` | `#98A1F2` |
| Свой конверт | `--hf-color-envelope-custom` | slate-500 / `#EEF1F4` | slate-500 (dark) |

**Заметный статус** — то, что пользователь должен увидеть, окрашивается целиком: мягкий фон, граница, иконка и действие цвета статуса, плюс текст. `warning` (янтарный) — нужно пополнить / не хватает на обязательные; `danger` (красный) — перерасход, не хватает денег на счетах; `info` (синий) — не распределено, остаток прошлого периода; `success` — «в порядке», «+» в истории. Компонент — `UiAttentionRow`.
```

(Подставить итоговые значения, если Step 3 их сдвинул.)

- [ ] **Step 7: Тесты проходят**

Run: `pnpm exec vitest run app/components/envelopes app/components/ui/Progress.test.ts` (из `apps/web`), затем `npx eslint` и `npx prettier --check` на изменённых файлах.
Expected: PASS, чисто.

- [ ] **Step 8: Stage**

```bash
git add apps/web/app/assets/styles/tokens.css apps/web/app/components/envelopes/EnvelopeTypeIcon.vue apps/web/app/components/envelopes/EnvelopeTypeIcon.test.ts apps/web/app/components/envelopes/envelope-plan-kind.ts apps/web/app/components/envelopes/envelope-plan-kind.test.ts apps/web/app/components/ui/Progress.vue apps/web/app/components/ui/Progress.test.ts docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md
```

Коммит (главная сессия): `feat(web): цвета типов конвертов и иконка типа`.

---

### Task 2: `UiAttentionRow`, `UiAmountHero`, `UiBeforeAfter`

**Files:**
- Create: `apps/web/app/components/ui/AttentionRow.vue` (+ `AttentionRow.test.ts`)
- Create: `apps/web/app/components/ui/AmountHero.vue` (+ `AmountHero.test.ts`)
- Create: `apps/web/app/components/ui/BeforeAfter.vue` (+ `BeforeAfter.test.ts`)

**Interfaces:**
- Produces:
  - `<UiAttentionRow tone="info|warning|danger" title description? action-label? action-to? @action />` — если задан `actionTo`, действие — `NuxtLink`, иначе `button`, эмитит `action`.
  - `<UiAmountHero label amount-minor note? >` + слот `aside`.
  - `<UiBeforeAfter :rows="Array<{ label: string; beforeMinor: string; afterMinor: string }>" />`.

- [ ] **Step 1: Падающие тесты**

`AttentionRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiAttentionRow from './AttentionRow.vue';

describe('UiAttentionRow', () => {
  it('показывает тон, заголовок, описание и кнопку действия', async () => {
    const wrapper = mount(UiAttentionRow, {
      props: { tone: 'warning', title: 'Не хватает · 10 ₽', description: 'Два платежа', actionLabel: 'Покрыть' },
    });
    expect(wrapper.classes()).toContain('ui-attention-row--warning');
    expect(wrapper.text()).toContain('Не хватает · 10 ₽');
    expect(wrapper.text()).toContain('Два платежа');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('action')).toHaveLength(1);
  });

  it('со ссылкой рендерит NuxtLink', () => {
    const wrapper = mount(UiAttentionRow, {
      props: { tone: 'info', title: 'Не распределено', actionLabel: 'Распределить', actionTo: '/app' },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    expect(wrapper.find('a').attributes('href')).toBe('/app');
  });

  it('без действия кнопки нет', () => {
    const wrapper = mount(UiAttentionRow, { props: { tone: 'danger', title: 'Перерасход' } });
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
```

`AmountHero.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiAmountHero from './AmountHero.vue';

describe('UiAmountHero', () => {
  it('показывает подпись, сумму, пояснение и слот aside', () => {
    const wrapper = mount(UiAmountHero, {
      props: { label: 'Осталось', amountMinor: '3335000', note: 'до 24 октября' },
      slots: { aside: '<span data-testid="aside">ok</span>' },
    });
    expect(wrapper.text()).toContain('Осталось');
    expect(wrapper.text()).toMatch(/33\s335,00/);
    expect(wrapper.text()).toContain('до 24 октября');
    expect(wrapper.find('[data-testid="aside"]').exists()).toBe(true);
  });
});
```

`BeforeAfter.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiBeforeAfter from './BeforeAfter.vue';

describe('UiBeforeAfter', () => {
  it('показывает строки «было → стало»', () => {
    const wrapper = mount(UiBeforeAfter, {
      props: {
        rows: [
          { label: 'Отпуск', beforeMinor: '14850000', afterMinor: '14000000' },
          { label: 'Резерв', beforeMinor: '6200000', afterMinor: '7050000' },
        ],
      },
    });
    const rows = wrapper.findAll('[data-testid="before-after-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Отпуск');
    expect(rows[0]!.text()).toMatch(/148\s500,00.*140\s000,00/);
  });
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm exec vitest run app/components/ui/AttentionRow.test.ts app/components/ui/AmountHero.test.ts app/components/ui/BeforeAfter.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Компоненты**

`AttentionRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { AlertOctagon, AlertTriangle, ArrowRight, Info } from '@lucide/vue';

defineOptions({ name: 'UiAttentionRow' });

const props = defineProps<{
  tone: 'info' | 'warning' | 'danger';
  title: string;
  description?: string | undefined;
  actionLabel?: string | undefined;
  actionTo?: string | undefined;
}>();
const emit = defineEmits<{ action: [] }>();

const icon = computed(
  () => ({ info: Info, warning: AlertTriangle, danger: AlertOctagon })[props.tone],
);
</script>

<template>
  <div class="ui-attention-row" :class="`ui-attention-row--${tone}`">
    <span class="ui-attention-row__icon" aria-hidden="true">
      <component :is="icon" :size="18" />
    </span>
    <div class="ui-attention-row__text">
      <p class="ui-attention-row__title">{{ title }}</p>
      <p v-if="description" class="ui-attention-row__description">{{ description }}</p>
    </div>
    <template v-if="actionLabel">
      <NuxtLink v-if="actionTo" :to="actionTo" class="ui-attention-row__action">
        {{ actionLabel }}
        <ArrowRight :size="16" aria-hidden="true" />
      </NuxtLink>
      <button v-else type="button" class="ui-attention-row__action" @click="emit('action')">
        {{ actionLabel }}
        <ArrowRight :size="16" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.ui-attention-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--tone-border);
  border-radius: var(--hf-radius-md);
  background: var(--tone-soft);
}

.ui-attention-row--info {
  --tone: var(--hf-color-primary-strong);
  --tone-soft: var(--hf-color-primary-soft);
  --tone-border: color-mix(in srgb, var(--hf-color-primary-strong) 28%, transparent);
}

.ui-attention-row--warning {
  --tone: var(--hf-color-status-warning);
  --tone-soft: var(--hf-color-warning-soft);
  --tone-border: color-mix(in srgb, var(--hf-color-status-warning-bright) 40%, transparent);
}

.ui-attention-row--danger {
  --tone: var(--hf-color-text-danger);
  --tone-soft: var(--hf-color-danger-soft);
  --tone-border: color-mix(in srgb, var(--hf-color-danger-strong) 32%, transparent);
}

.ui-attention-row__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
  color: var(--tone);
}

.ui-attention-row__text {
  flex: 1 1 auto;
  min-width: 0;
}

.ui-attention-row__title {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.ui-attention-row__description {
  margin: var(--hf-space-1) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-attention-row__action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--hf-space-1);
  min-height: 44px;
  padding: 0 var(--hf-space-2);
  border: 0;
  background: none;
  color: var(--tone);
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
  cursor: pointer;
}

.ui-attention-row__action:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
```

Если `color-mix` не используется в проекте и lint/browserslist против — заменить границу на `var(--tone)` с `opacity` через отдельный псевдоэлемент либо на `--hf-color-border`; решение записать в отчёт. Если `--hf-color-text-muted`/`--hf-color-focus-ring` называются иначе — взять фактические имена из `tokens.css`.

`AmountHero.vue`:

```vue
<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'UiAmountHero' });

defineProps<{ label: string; amountMinor: string; note?: string | undefined }>();
</script>

<template>
  <div class="ui-amount-hero">
    <div class="ui-amount-hero__main">
      <p class="ui-amount-hero__label">{{ label }}</p>
      <p class="ui-amount-hero__amount">
        <FinanceMoney :minor-units="amountMinor" currency="RUB" :scale="2" />
      </p>
      <p v-if="note" class="ui-amount-hero__note">{{ note }}</p>
    </div>
    <div v-if="$slots.aside" class="ui-amount-hero__aside"><slot name="aside" /></div>
  </div>
</template>

<style scoped>
.ui-amount-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-5);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.ui-amount-hero__label,
.ui-amount-hero__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-amount-hero__amount {
  margin: var(--hf-space-1) 0;
  font-size: var(--hf-font-size-h1);
  font-weight: var(--hf-font-weight-semibold);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
</style>
```

(Если `--hf-font-size-h1` нет — взять размер заголовка страницы из `ReferencePageLayout.vue`.)

`BeforeAfter.vue`:

```vue
<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'UiBeforeAfter' });

defineProps<{ rows: ReadonlyArray<{ label: string; beforeMinor: string; afterMinor: string }> }>();
</script>

<template>
  <dl class="ui-before-after">
    <div v-for="row in rows" :key="row.label" class="ui-before-after__row" data-testid="before-after-row">
      <dt class="ui-before-after__label">{{ row.label }}</dt>
      <dd class="ui-before-after__values">
        <span class="ui-before-after__before">
          <FinanceMoney :minor-units="row.beforeMinor" currency="RUB" :scale="2" />
        </span>
        <ArrowRight :size="16" aria-label="станет" />
        <strong><FinanceMoney :minor-units="row.afterMinor" currency="RUB" :scale="2" /></strong>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.ui-before-after {
  display: grid;
  margin: 0;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.ui-before-after__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
  padding: var(--hf-space-2) 0;
}

.ui-before-after__row + .ui-before-after__row {
  border-top: 1px solid var(--hf-color-border);
}

.ui-before-after__label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-before-after__values {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.ui-before-after__before {
  color: var(--hf-color-text-muted);
}
</style>
```

- [ ] **Step 4: Тесты, lint, формат**

Run: `pnpm exec vitest run app/components/ui`; `npx eslint` / `npx prettier --check` на новых файлах.
Expected: PASS, чисто.

- [ ] **Step 5: Stage**

```bash
git add apps/web/app/components/ui/AttentionRow.vue apps/web/app/components/ui/AttentionRow.test.ts apps/web/app/components/ui/AmountHero.vue apps/web/app/components/ui/AmountHero.test.ts apps/web/app/components/ui/BeforeAfter.vue apps/web/app/components/ui/BeforeAfter.test.ts
```

Коммит: `feat(web): строки внимания, крупная сумма и предпросмотр «было → стало»`.

---

### Task 3: Страница «Конверты» — шапка, сводка, остаток прошлого периода

**Files:**
- Create: `apps/web/app/components/envelopes/EnvelopesSummary.vue` (+ `EnvelopesSummary.test.ts`)
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.vue`
- Modify: `apps/web/app/components/dashboard/PeriodDecisionCard.vue` (только оформление)
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.target.test.ts` (мок `getDashboard` уже есть)
- Modify: `apps/web/app/pages/app/envelopes/index.v2.test.ts` (мок `getDashboard`)

**Interfaces:**
- Consumes: `UiAttentionRow` (Task 2); `useEnvelopePlanV2().getDashboard(budgetId)` → `DashboardV2Response`; `useFundingEntry().offer({ sourceKind: 'FREE' })`, `useFundingEntry().confirmedCount`.
- Produces: `<EnvelopesSummary :dashboard="DashboardV2Response" @distribute />`; в `EnvelopesPlanView` — `dashboard: Ref<DashboardV2Response | null>`, загружается вместе со списком и после `confirmedCount`/изменений.

- [ ] **Step 1: Падающий тест `EnvelopesSummary`**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopesSummary from './EnvelopesSummary.vue';

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    period: { start: '2026-10-10', end: '2026-10-24', periodId: 'p1' },
    spendable: { state: 'READY', amountMinor: '3335000' },
    cashMinor: '30748531',
    mandatoryBalanceMinor: '5163531',
    otherProtectedMinor: '21050000',
    freeToAssignMinor: '1200000',
    mandatoryGapMinor: '1036469',
    unbackedMinor: '0',
    warnings: [
      {
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        message: 'Два платежа до 20 октября',
        amountMinor: '1036469',
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        level: 'ALERT',
        actionPath: '/app/envelopes?cover=mandatory',
      },
    ],
    ...overrides,
  };
}

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('EnvelopesSummary', () => {
  it('показывает серверные значения без вычислений', () => {
    const wrapper = mount(EnvelopesSummary, { props: { dashboard: dashboard() as never }, global: { stubs } });
    const text = wrapper.text();
    expect(text).toContain('Можно потратить');
    expect(text).toMatch(/33\s350,00/);
    expect(text).toContain('до 24 октября');
    expect(text).toMatch(/51\s635,31/);
    expect(text).toMatch(/210\s500,00/);
    expect(text).toMatch(/307\s485,31/);
  });

  it('строки внимания: «Не распределено» эмитит distribute, «Не хватает» ведёт по actionPath', async () => {
    const wrapper = mount(EnvelopesSummary, { props: { dashboard: dashboard() as never }, global: { stubs } });
    const free = wrapper.find('[data-testid="summary-free"]');
    expect(free.classes()).toContain('ui-attention-row--info');
    await free.find('button').trigger('click');
    expect(wrapper.emitted('distribute')).toHaveLength(1);
    const gap = wrapper.find('[data-testid="summary-gap"]');
    expect(gap.classes()).toContain('ui-attention-row--warning');
    expect(gap.find('a').attributes('href')).toBe('/app/envelopes?cover=mandatory');
  });

  it('нулевые суммы скрывают строки, NEEDS_PERIOD_SETUP показывает настройку', () => {
    const wrapper = mount(EnvelopesSummary, {
      props: {
        dashboard: dashboard({
          freeToAssignMinor: '0',
          mandatoryGapMinor: '0',
          warnings: [],
          spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null },
        }) as never,
      },
      global: { stubs },
    });
    expect(wrapper.find('[data-testid="summary-free"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="summary-gap"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Лимит на период не настроен');
  });

  it('CASH_SHORTFALL — красная строка', () => {
    const wrapper = mount(EnvelopesSummary, {
      props: {
        dashboard: dashboard({
          unbackedMinor: '500000',
          warnings: [
            { kind: 'COVERAGE', code: 'CASH_SHORTFALL', message: 'Денег на счетах меньше, чем отложено', amountMinor: '500000', envelopeId: null, periodId: null, balanceMinor: null, actionPath: '/app/envelopes' },
          ],
        }) as never,
      },
      global: { stubs },
    });
    expect(wrapper.find('[data-testid="summary-shortfall"]').classes()).toContain('ui-attention-row--danger');
  });
});
```

(`level: 'INFO'` у `MANDATORY_GAP` → тон `info`; добавить такой кейс аналогично второму тесту.)

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm exec vitest run app/components/envelopes/EnvelopesSummary.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: `EnvelopesSummary.vue`**

Разметка по спеке §2.2: `UiCard` с сеткой из трёх зон (`grid-template-columns: 1.1fr 1fr 1.4fr` на ≥ 1024px, столбик ниже).

- Зона 1: подпись «Можно потратить», `FinanceMoney` крупно (`--hf-font-size-h1`), пояснение «Остаток текущего периода · до {formatPlainDate(period.end) без года}». При `spendable.state === 'NEEDS_PERIOD_SETUP'` — «Лимит на период не настроен» и `NuxtLink` «Настроить» на `/app` (там настраивается лимит).
- Зона 2: `dl` из трёх строк «Обязательные платежи» (`mandatoryBalanceMinor`), «Накопления и другие» (`otherProtectedMinor`), «На счетах» (`cashMinor`), подзаголовок зоны «Отложено на обязательные и накопления».
- Зона 3: `UiAttentionRow` с `data-testid`:
  - `summary-free` — `tone="info"`, `title="Не распределено · {money(freeToAssignMinor)}"`, `description="Доход ещё не разложен по конвертам"`, `action-label="Распределить"`, `@action="emit('distribute')"`; виден при `freeToAssignMinor` > 0 (проверка строкой: `/[1-9]/.test(value) && !value.startsWith('-')`).
  - `summary-gap` — предупреждение `MANDATORY_GAP` из `warnings`: тон `warning` при `level === 'ALERT'`, иначе `info`; `title="Не хватает на обязательные · {money(warning.amountMinor)}"`, `description=warning.message`, `action-label="Покрыть"`, `action-to=warning.actionPath`.
  - `summary-shortfall` — предупреждение `CASH_SHORTFALL`: `tone="danger"`, `title="Не хватает денег на счетах · {money(amountMinor)}"`, `description=message`, `action-label="Разобраться"`, `action-to=actionPath`.
  - Если ни одной строки нет — зона 3 показывает тихий текст «Всё распределено» с иконкой `CircleCheck` (success).
- `money` — `formatMoneyText` из `envelope-plan-kind.ts`.

- [ ] **Step 4: Встроить в `EnvelopesPlanView`**

- В `load()` параллельно со списком: `planV2.getDashboard(props.budgetId)` в отдельном `try` → `dashboard.value`; ошибка → `dashboard.value = null`, `summaryError.value = true`.
- Перечитывать дашборд после `onTargetChanged`, после переноса (`onMoved` / результат `EnvelopeMovePanel`), после архивации и при изменении `useFundingEntry().confirmedCount` (`watch`).
- Шапка (`ReferencePageLayout`):
  - `#kicker`: `Конверты · {range}` где `range` — «10–24 октября» из `dashboard.period` (`formatPlainDate` двух дат: если месяц один — «10–24 октября», иначе «25 октября – 9 ноября»; функция `periodRangeText(start, end)` в `envelope-plan-kind.ts` с unit-тестом на оба случая); без дашборда — «Справочники».
  - `#description`: «Распределяйте деньги по целям, не перемещая их между счетами.»
  - `#actions`: «Задать правила» — `UiButton variant="secondary"` с иконкой `Settings2` и текстом; «Создать конверт» — primary с иконкой `Plus`. `data-action` сохранить.
- Под шапкой: `EnvelopesSummary` (если `dashboard`), иначе при `summaryError` — `UiAttentionRow tone="info" title="Сводка недоступна" action-label="Повторить"` → перечитать дашборд.
- Под сводкой: `PeriodDecisionCard` с props из `dashboard` (как в `pages/app/index.vue`, `hideTarget: true`), `@changed` → перечитать список и дашборд.
- `@distribute` → `useFundingEntry().offer({ sourceKind: 'FREE' })`.
- Блок `actionNote` (подсказки из query) оставить.

- [ ] **Step 5: Оформление `PeriodDecisionCard`**

Только стили и обёртки, без изменения логики, текстов и `data-testid`:
- строка остатка (`PERIOD_LEFTOVER`): фон `--hf-color-primary-soft`, граница `primary-strong` 28%, плашка с иконкой `CalendarClock` (`primary-strong`) слева; основное действие «В следующий период» — `UiButton variant="secondary"`; остальные действия — текстовые кнопки цвета `--hf-color-primary-strong`;
- строка перерасхода (`PERIOD_DEFICIT`): те же правила в тоне `danger` (`--hf-color-danger-soft`, `--hf-color-text-danger`);
- на < 768px действия переносятся под текст.

Проверить, что `PeriodDecisionCard.test.ts` (если есть) и `pages/app/index.test.ts` проходят без изменений ожиданий.

- [ ] **Step 6: Тесты страницы**

В `EnvelopesPlanView.target.test.ts` и `pages/app/envelopes/index.v2.test.ts` мок `getDashboard` уже есть или добавить (`mockResolvedValue(dashboard(...))`). Добавить в `index.v2.test.ts`:

```ts
it('сводка: показывает «Можно потратить» и строку «Не распределено»', async () => {
  // mocks.v2.getDashboard.mockResolvedValue(<объект как в EnvelopesSummary.test.ts>)
  // mount страницы как в соседних тестах файла, flushPromises
  // expect(text).toContain('Можно потратить'); expect(find('[data-testid="summary-free"]').exists()).toBe(true)
});

it('ошибка сводки не ломает список', async () => {
  // mocks.v2.getDashboard.mockRejectedValue(new Error('down'))
  // список конвертов отрисован, есть текст «Сводка недоступна»
});
```

(Тело — по образцу соседних тестов этого файла: те же фабрики `plan(...)`, тот же `mount` и `flushPromises`; заполнить конкретными вызовами при реализации.)

- [ ] **Step 7: Прогон**

Run: `pnpm exec vitest run app/components/envelopes app/components/dashboard app/pages/app` (из `apps/web`); eslint/prettier на изменённых файлах; `pnpm --filter @harmofin/web typecheck`.
Expected: PASS.

- [ ] **Step 8: Stage**

`git add` изменённых и новых файлов задачи. Коммит: `feat(web): сводка и действия на странице конвертов`.

---

### Task 4: Список конвертов — поиск, группы, карточка с прогрессом и метками

**Files:**
- Modify: `apps/web/app/components/envelopes/EnvelopePlanRow.vue` (+ `EnvelopePlanRow.test.ts`)
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.vue`
- Modify: `apps/web/app/components/envelopes/envelope-plan-kind.ts` (+ тест): `planProgress`
- Modify: `apps/web/app/pages/app/envelopes/index.v2.test.ts`

**Interfaces:**
- Consumes: `EnvelopeTypeIcon`, `UiProgress` с `tone` (Task 1); `dashboard` из Task 3.
- Produces:

```ts
export interface PlanProgress {
  value: string; // minor string
  max: string;   // minor string
  label: string; // подпись над полосой
  tone: EnvelopeTone;
}
export interface PlanBadge { tone: 'warning' | 'danger'; text: string }
export function planProgress(
  envelope: EnvelopePlanDto,
  mandatory: { balanceMinor: string; dueMinor: string } | null,
): PlanProgress | null;
export function planBadge(
  envelope: EnvelopePlanDto,
  mandatoryGapMinor: string | null,
): PlanBadge | null;
```

`EnvelopePlanRow` получает новые props `progress: PlanProgress | null`, `badge: PlanBadge | null`.

- [ ] **Step 1: Падающие тесты `planProgress` / `planBadge`**

```ts
describe('planProgress', () => {
  const base = { id: 'e', name: 'X', periodSlot: null, targetAmountMinor: null, comment: null, fundedMinor: '0', spentMinor: '0', balanceMinor: '0', archivedAt: null };

  it('текущие траты: потрачено из отложенного текущего периода', () => {
    const env = { ...base, envelopeType: 'CURRENT_EXPENSES', periods: [
      { periodId: 'old', startsOn: '2026-09-25', endsOn: '2026-10-09', fundedMinor: '1', spentMinor: '1', balanceMinor: '0', current: false },
      { periodId: 'p', startsOn: '2026-10-10', endsOn: '2026-10-24', fundedMinor: '6500000', spentMinor: '3165000', balanceMinor: '3335000', current: true },
    ] };
    expect(planProgress(env, null)).toEqual({ value: '3165000', max: '6500000', label: 'Потрачено из отложенного', tone: 'current' });
  });

  it('обязательные: остаток к ближайшим платежам', () => {
    const env = { ...base, envelopeType: 'MANDATORY_EXPENSES', balanceMinor: '5163531' };
    expect(planProgress(env, { balanceMinor: '5163531', dueMinor: '6200000' })).toEqual({ value: '5163531', max: '6200000', label: 'Покрыто ближайших платежей', tone: 'mandatory' });
    expect(planProgress(env, { balanceMinor: '1', dueMinor: '0' })).toBeNull();
  });

  it('цель: остаток к цели (цель в рублях)', () => {
    const env = { ...base, envelopeType: 'SAVINGS_GOAL', balanceMinor: '14850000', targetAmountMinor: '280000' };
    expect(planProgress(env, null)).toEqual({ value: '14850000', max: '28000000', label: 'Цель', tone: 'savings' });
  });

  it('без цели — нет полосы', () => {
    expect(planProgress({ ...base, envelopeType: 'RESERVE' }, null)).toBeNull();
  });
});

describe('planBadge', () => {
  const base = { id: 'e', name: 'X', periodSlot: null, targetAmountMinor: null, comment: null, fundedMinor: '0', spentMinor: '0', archivedAt: null };

  it('перерасход — danger', () => {
    expect(planBadge({ ...base, envelopeType: 'CUSTOM', balanceMinor: '-320000' }, null)).toEqual({ tone: 'danger', text: expect.stringMatching(/^Перерасход 3\s200,00/) });
  });

  it('обязательные с нехваткой — warning', () => {
    expect(planBadge({ ...base, envelopeType: 'MANDATORY_EXPENSES', balanceMinor: '100' }, '1036469')).toEqual({ tone: 'warning', text: expect.stringMatching(/^Нужно пополнить на 10\s364,69/) });
  });

  it('иначе нет метки', () => {
    expect(planBadge({ ...base, envelopeType: 'MANDATORY_EXPENSES', balanceMinor: '100' }, '0')).toBeNull();
  });
});
```

(Тип конверта в тестах приводится `as EnvelopePlanDto`.)

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm exec vitest run app/components/envelopes/envelope-plan-kind.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация функций**

```ts
export interface PlanProgress { value: string; max: string; label: string; tone: EnvelopeTone }
export interface PlanBadge { tone: 'warning' | 'danger'; text: string }

const hasPositive = (minor: string) => /[1-9]/.test(minor) && !minor.startsWith('-');

export function planProgress(
  envelope: EnvelopePlanDto,
  mandatory: { balanceMinor: string; dueMinor: string } | null,
): PlanProgress | null {
  const tone = envelopeTone(envelope.envelopeType);
  if (envelope.envelopeType === 'CURRENT_EXPENSES') {
    const current = envelope.periods?.find((period) => period.current);
    if (!current || !hasPositive(current.fundedMinor)) return null;
    return { value: current.spentMinor, max: current.fundedMinor, label: 'Потрачено из отложенного', tone };
  }
  if (envelope.envelopeType === 'MANDATORY_EXPENSES') {
    if (!mandatory || !hasPositive(mandatory.dueMinor)) return null;
    return { value: mandatory.balanceMinor, max: mandatory.dueMinor, label: 'Покрыто ближайших платежей', tone };
  }
  const target = envelope.targetAmountMinor === null ? null : decimalToMinor(envelope.targetAmountMinor);
  if (target === null || !hasPositive(target)) return null;
  return { value: envelope.balanceMinor, max: target, label: 'Цель', tone };
}

export function planBadge(envelope: EnvelopePlanDto, mandatoryGapMinor: string | null): PlanBadge | null {
  if (balanceSign(envelope.balanceMinor) === 'negative') {
    return { tone: 'danger', text: `Перерасход ${formatMoneyText(envelope.balanceMinor.slice(1))}` };
  }
  if (envelope.envelopeType === 'MANDATORY_EXPENSES' && mandatoryGapMinor && hasPositive(mandatoryGapMinor)) {
    return { tone: 'warning', text: `Нужно пополнить на ${formatMoneyText(mandatoryGapMinor)}` };
  }
  return null;
}
```

(Функции расположить после `balanceSign`/`formatMoneyText`/`decimalToMinor`; `slice(1)` снимает знак минуса строки — это форматирование, не арифметика.)

- [ ] **Step 4: Карточка `EnvelopePlanRow`**

Сохранить: `UiListRow` с `label` (aria) и `@select`, слот `actions`, `data-testid="plan-row-scope"`, `highlight`. Новая раскладка содержимого (сетка: `minmax(14rem, 1.4fr) minmax(10rem, 1fr) minmax(12rem, 1.2fr)`; на < 1024px — столбик):

```vue
<template #leading><EnvelopeTypeIcon :envelope-type="envelope.envelopeType" /></template>

<span class="plan-row__identity">
  <span class="plan-row__title">{{ envelope.name }}</span>
  <span class="plan-row__muted" data-testid="plan-row-scope">{{ caption }}</span>
</span>
<span class="plan-row__amount">
  <span class="plan-row__label">Осталось</span>
  <FinanceMoney class="plan-row__balance" :minor-units="envelope.balanceMinor" currency="RUB" :scale="2" />
  <span class="plan-row__muted">Отложено {{ money(envelope.fundedMinor) }} · потрачено {{ money(envelope.spentMinor) }}</span>
</span>
<span class="plan-row__progress">
  <template v-if="progress">
    <span class="plan-row__progress-head">
      <span>{{ progress.label }}</span><span>{{ percentText }}</span>
    </span>
    <UiProgress :value="progress.value" :max="progress.max" :label="progressAria" :tone="progress.tone" />
  </template>
  <span v-if="badge" class="plan-row__badge" :class="`plan-row__badge--${badge.tone}`" data-testid="plan-row-badge">
    <AlertTriangle v-if="badge.tone === 'warning'" :size="14" aria-hidden="true" />
    <AlertOctagon v-else :size="14" aria-hidden="true" />
    {{ badge.text }}
  </span>
  <span v-else-if="highlight" class="plan-row__badge plan-row__badge--warning">{{ highlight }}</span>
</span>
```

- `caption`: периодный — «Лимит на {первую|вторую} половину периода» (по `periodSlot`), с целью — «Цель {money(target)}», иначе `planScopeNote`.
- `percentText` — тот же целочисленный процент, что в `UiProgress` (вынести расчёт процента в экспорт `progressPercent(value, max): number` из `Progress.vue`-соседнего модуля `ui/progress-percent.ts` и использовать в обоих местах; тест на 0/50/100/clamp).
- `progressAria` — «{label}: {percent} %».
- Бейдж: фон `-soft` тона, текст `--hf-color-status-warning` / `--hf-color-text-danger`, радиус `--hf-radius-sm`.
- Карточка — `UiCard`-подобная поверхность: фон `surface`, граница, радиус `--hf-card-radius`, тень `--hf-shadow-card`; отступ между карточками `--hf-space-3`.

- [ ] **Step 5: Список в `EnvelopesPlanView`**

- Заголовок `h2` «Все конверты» + счётчик «{N} активных»; справа `UiInput` `name="envelope-search"` `label="Найти конверт"` `hide-label` с иконкой `Search` (слот `icon`), `v-model="search"`.
- `visibleGroups` — `groups` с фильтром `name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))`; пустой результат — `UiEmptyState` «Ничего не найдено».
- `aria-live="polite"` элемент с текстом «Найдено {n} конвертов» при непустом поиске.
- Заголовок группы: `title` + пояснение (`planScopeNote` первого типа группы; для «На период» — «{Первая|Вторая} половина периода · {range}», если в группе один слот, иначе только `planScopeNote`).
- Для каждой строки передать `:progress="planProgress(envelope, mandatoryProgress)"` и `:badge="planBadge(envelope, dashboard?.mandatoryGapMinor ?? null)"`, где `mandatoryProgress = dashboard ? { balanceMinor: dashboard.mandatoryBalanceMinor, dueMinor: dashboard.mandatoryDueMinor } : null`.

- [ ] **Step 6: Тесты**

- `EnvelopePlanRow.test.ts`: обновить под новую разметку (сохранить проверки aria-label, `@select`, `plan-row-scope`); добавить: прогресс рисуется при `progress`, бейдж `danger`/`warning` рисуется с текстом и иконкой, при `null` — нет.
- `index.v2.test.ts`: поиск — ввести «отп» в `[name="envelope-search"]` → видна только строка «Отпуск», есть текст «Найдено 1»; пустой поиск — все строки.

Run: `pnpm exec vitest run app/components/envelopes app/pages/app/envelopes app/components/ui`.
Expected: PASS.

- [ ] **Step 7: Stage**

Коммит: `feat(web): карточки конвертов с цветом типа, прогрессом и поиском`.

---

### Task 5: Детали конверта

**Files:**
- Modify: `apps/web/app/components/envelopes/EnvelopePlanDialog.vue`
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.target.test.ts` (и/или новый `EnvelopePlanDialog.test.ts`)

**Interfaces:**
- Consumes: `UiAmountHero` (Task 2), `planBadge` (Task 4). Новый prop `badge: PlanBadge | null` передаёт `EnvelopesPlanView` (тот же расчёт, что для строки).
- Produces: метка статуса `data-testid="plan-dialog-status"`.

- [ ] **Step 1: Падающий тест** (новый `EnvelopePlanDialog.test.ts`, моки `useEnvelopePlanV2().getEnvelopeHistory` как в соседних тестах):

```ts
it('крупная сумма и статус «Конверт в порядке» без метки', async () => {
  // mount EnvelopePlanDialog { budgetId, envelope: envelope('env-a','Еда'), badge: null }
  // expect(find('[data-testid="plan-dialog-status"]').text()).toBe('Конверт в порядке')
});
it('перерасход — статус danger', async () => {
  // badge: { tone: 'danger', text: 'Перерасход 1 000,00 ₽' } → текст «Перерасход», класс --danger
});
it('история: знак суммы по виду записи', async () => {
  // getEnvelopeHistory → items [{kind:'ASSIGNMENT', amountMinor:'1200000', effectiveOn:'2026-10-21'}, {kind:'SPENDING', amountMinor:'465000', effectiveOn:'2026-10-12'}]
  // первая строка содержит «+12 000,00», вторая «−4 650,00»; у первой класс success
});
```

Заполнить тела по образцу `EnvelopesPlanView.target.test.ts` (фабрика `envelope`, `flushPromises`, `attachTo: document.body`, поиск по `document`).

Перед реализацией проверить, приходит ли в истории `amountMinor` со знаком; если сервер уже отдаёт отрицательные расходы — знак брать из строки, а не добавлять второй.

- [ ] **Step 2: Убедиться, что падает.** `pnpm exec vitest run app/components/envelopes/EnvelopePlanDialog.test.ts` → FAIL.

- [ ] **Step 3: Реализация** по спеке §3:
- `UiModal :title="envelope.name"`, подзаголовок (если `UiModal` не поддерживает — первая строка тела мелким текстом) = `caption` как в карточке.
- `UiAmountHero label="Осталось" :amount-minor="envelope.balanceMinor"`, слот `aside` — метка статуса (`success` «Конверт в порядке» с `Check`, `warning` «Нужно пополнить», `danger` «Перерасход»), `data-testid="plan-dialog-status"`.
- Тело: на ≥ 768px две колонки (`dl` слева, история справа), иначе одна.
- История: строка — плашка 32px с иконкой (`ArrowDownToLine` ASSIGNMENT, `ArrowLeftRight` MOVEMENT, `ShoppingCart` SPENDING), заголовок (`KIND_LABELS`), дата, сумма со знаком; «+» — `--hf-color-status-success` (или фактический токен success-текста).
- Переключатель «Показать отменённые записи» — `role="switch"` + `aria-checked`, сохранить `data-testid="history-toggle-deleted"`.
- Футер: «Переложить» primary с `ArrowLeftRight`; «Изменить цель периода», «Изменить» (`Pencil`), «Операции конверта» (`Calendar`) secondary; «Архивировать» (`Archive`) tertiary. `data-testid` сохранить.
- `EnvelopesPlanView` передаёт `:badge="detailed ? planBadge(detailed, dashboard?.mandatoryGapMinor ?? null) : null"`.

- [ ] **Step 4: Прогон** `pnpm exec vitest run app/components/envelopes app/pages/app/envelopes` → PASS; eslint/prettier/typecheck.

- [ ] **Step 5: Stage.** Коммит: `feat(web): детали конверта в новом оформлении`.

---

### Task 6: «Переложить»

**Files:**
- Modify: `apps/web/app/components/envelopes/EnvelopeMovePanel.vue`
- Modify: тест панели (найти: `grep -rln "EnvelopeMovePanel" apps/web/app --include=*.test.ts`)

**Interfaces:**
- Consumes: `UiAmountHero`, `UiBeforeAfter` (Task 2), `EnvelopeTypeIcon` (Task 1), `decimalToMinor` из `envelope-plan-kind.ts`.
- Produces: `data-testid="move-recipient-pill-<id>"` для пилюль; `data-testid="move-preview"` для предпросмотра.

- [ ] **Step 1: Падающие тесты** (в существующем тест-файле панели):

```ts
it('источник не предлагается получателем', async () => {
  // source = 'env-a'; envelopes = [env-a, env-b, env-c]
  // нет [data-testid="move-recipient-pill-env-a"]; есть pill env-b
});
it('предпросмотр «было → стало» для источника и получателя', async () => {
  // source balance '14850000', выбрать pill env-b (balance '6200000'), ввести сумму '8500'
  // [data-testid="move-preview"] содержит «148 500,00 → 140 000,00» и «62 000,00 → 70 500,00»
});
it('некорректная сумма скрывает предпросмотр', async () => {
  // сумма 'abc' → нет [data-testid="move-preview"]
});
it('в свободные: вторая строка «Свободные деньги» без суммы «было»', async () => {
  // direction envelope-free: предпросмотр содержит только строку источника
});
```

(Фабрики и монтирование — как в существующем тесте панели.)

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** по спеке §4:
- подзаголовок «Источник: {source.name}»; `UiAmountHero label="Сейчас в конверте" :amount-minor="sourceAvailableMinor"` (то же значение, что сейчас ограничивает сумму);
- направление — существующие radio в виде сегментов (обёртка с фоном `surface-subtle`, выбранный сегмент — `surface` + тень), подписи: «В другой конверт», «Из свободных сюда», «В свободные» (поменять только текст `'free-envelope'` на «Из свободных сюда»);
- получатель: пилюли первых 5 конвертов из `envelopes` без источника (`EnvelopeTypeIcon size="sm"` + имя; выбранная — граница/фон brand) и `UiSelect searchable` со всеми получателями без источника;
- предпросмотр: `computed` — `amount = decimalToMinor(text.replace(',', '.'))`; если `null` или `0` — не показывать. `before`/`after` через `BigInt`: источник `before - amount`, получатель `before + amount` (для «Из свободных сюда» источник — свободные: показывать только строку получателя; для «В свободные» — только строку источника). Результат в строку `toString()`.
- `FinanceMoneyInput` с подсказкой «Можно переложить до {money(sourceAvailableMinor)}».

- [ ] **Step 4: Прогон** focused-тестов панели и `app/components/envelopes` → PASS; eslint/prettier/typecheck.

- [ ] **Step 5: Stage.** Коммит: `feat(web): «Переложить» с предпросмотром и быстрым выбором получателя`.

---

### Task 7: «Распределить деньги»

**Files:**
- Modify: `apps/web/app/components/funding/FundingReviewSheet.vue`
- Modify: `apps/web/app/components/funding/FundingReviewSheet.test.ts`

**Interfaces:**
- Consumes: `UiAmountHero`, `UiAttentionRow` (Task 2), `EnvelopeTypeIcon` (Task 1). Данные строк — существующий preview (тип конверта брать из строки preview; если в строке нет `envelopeType`, сопоставить по `envelopeId` со списком `listEnvelopes`, который компонент уже знает, иначе — иконка `custom`).

- [ ] **Step 1: Падающие тесты** (в существующем файле, по его фабрикам):

```ts
it('крупная сумма «Можно распределить» и пометка о счетах', async () => {
  // текст содержит «Можно распределить» и «Деньги остаются на ваших счетах»
});
it('строка очереди: номер, иконка типа, причина и поле суммы с доступной подписью', async () => {
  // первая строка: «1», .envelope-type-icon--mandatory, label поля «Сумма для Обязательные платежи»
});
it('нехватка на обязательные — warning-строка', async () => {
  // preview с нехваткой → [data-testid="funding-gap"] имеет класс ui-attention-row--warning
});
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** по спеке §5: подзаголовок, `UiAmountHero` с `aside`-меткой `info`, шапка таблицы «Очередь / Предложенная сумма», строки с номером, `EnvelopeTypeIcon size="sm"`, названием, причиной, `FinanceMoneyInput hide-label`; «До нужной суммы» / «Весь остаток» — пилюли под строкой с фокусом (существующие обработчики); `UiAttentionRow data-testid="funding-gap"`; закреплённый футер. Логику, тексты кнопок и `data-testid` сохранить.

Если `FinanceMoneyInput` не поддерживает `hideLabel` — пробросить его в `UiInput` (prop уже есть у `UiInput`), добавив prop в `FinanceMoneyInput`.

- [ ] **Step 4: Прогон** `pnpm exec vitest run app/components/funding` → PASS; eslint/prettier/typecheck.

- [ ] **Step 5: Stage.** Коммит: `feat(web): «Распределить деньги» в новом оформлении`.

---

### Task 8: «Правила пополнения» в новом оформлении

**Files:**
- Modify: `apps/web/app/components/funding-rules/FundingRulesEditor.vue`, `FundingRuleCard.vue`
- Modify: `apps/web/app/components/funding-rules/FundingRulesEditor.test.ts`

**Interfaces:**
- Consumes: `EnvelopeTypeIcon` (Task 1). Существующие `data-testid` и поведение не меняются.
- Produces: `data-testid="rules-save-status"` — статус нижней панели.

- [ ] **Step 1: Падающие тесты**

```ts
it('статус нижней панели: сохранено / есть изменения', async () => {
  const wrapper = await mountEditor();
  expect(wrapper.find('[data-testid="rules-save-status"]').text()).toBe('Все изменения сохранены');
  await wrapper.find('[data-testid="rule-down-a"]').trigger('click');
  expect(wrapper.find('[data-testid="rules-save-status"]').text()).toBe('Есть несохранённые изменения');
});

it('карточка показывает иконку типа конверта', async () => {
  const wrapper = await mountEditor();
  expect(wrapper.find('[data-testid="rule-card-b"] .envelope-type-icon--savings').exists()).toBe(true);
});
```

- [ ] **Step 2: FAIL.**

- [ ] **Step 3: Реализация** по спеке §6:
- секции — `UiCard` с заголовком: плашка-иконка 40px (`ArrowDownToLine`, `ListOrdered`, `Wallet`, фон `surface-subtle`), `h2`, подзаголовок (тексты подсказок: «Сначала заполняется правило №1, затем следующее.», «Эти конверты не получают автоматического предложения.», для предложения — «Выберите, какой доход предлагать направить в конверт.»), ⓘ остаётся;
- переключатель предложения — в правой части заголовка секции;
- карточка очереди на ≥ 1024px — одна строка: ручка, номер в кружке (`background: var(--hf-color-navy)`, белый текст; в тёмной теме `--hf-color-slate-900` фон и `--hf-color-slate-50` текст), `EnvelopeTypeIcon size="sm"`, название + метка дохода, `UiSelect`, поле, ↑/↓; ниже 1024px — текущая раскладка;
- «Вне очереди» — сетка 2 колонки (≥ 768px), карточки с `border-style: dashed`;
- нижняя панель: слева `data-testid="rules-save-status"` — `CircleCheck` + «Все изменения сохранены» (success) или `AlertTriangle` + «Есть несохранённые изменения» (warning).

- [ ] **Step 4: Прогон** `pnpm exec vitest run app/components/funding-rules app/pages/app/envelopes` → PASS; eslint/prettier/typecheck.

- [ ] **Step 5: Stage.** Коммит: `feat(web): «Правила пополнения» в новом оформлении`.

---

### Task 9: E2E-селекторы и итоговая проверка

**Files:**
- Modify (при необходимости): `e2e/envelope-v2-*.spec.ts`, `e2e/envelope-v2-funding-rules.spec.ts`, `e2e/reference-data.spec.ts`

- [ ] **Step 1: Сверка селекторов.** Для каждого E2E-файла, который обращается к странице конвертов, деталям, «Переложить», «Распределить деньги» или правилам (`grep -ln "envelope\|Распредел\|Переложить\|rules" e2e/*.spec.ts`), проверить по реальной разметке, что каждый `getByTestId`/`getByRole`/`getByText` по-прежнему находит элемент (тексты кнопок, роли, testid). Исправить только сломанные селекторы; сценарии не менять. Записать список изменённых строк в отчёт.
- [ ] **Step 2: Полный прогон** (корень): `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. Expected: всё зелёное.
- [ ] **Step 3: Stage.** Коммит: `test(e2e): селекторы после редизайна конвертов` (если были изменения).
- [ ] **Step 4: Ревью.** UI/UX (гайдлайны + доступность + обе темы по коду), QA, финальное. E2E — в CI после push по решению владельца.
