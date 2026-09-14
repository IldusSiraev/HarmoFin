# App UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать приложению `/app` два недостающих примитива обратной связи (тост и скелетон), переоформленную оболочку с добавлением операции из любого экрана и главную, собранную вокруг показателя «Можно потратить».

**Architecture:** Тосты живут в модуле-синглтоне `useToast()`, контейнер монтируется один раз в `layouts/app.vue`. Диалоги добавления операции и перевода переезжают из страницы главной в layout через `useOperationDialogs()`, поэтому кнопка «+ Добавить» работает на всех экранах. Главная перестаёт быть набором карточек и выстраивается в порядок «показатель → предупреждения → обязательства → конверты → счета», используя единственный существующий запрос `GET /budgets/{id}/summary`.

**Tech Stack:** Nuxt 4.5.2, Vue 3.5.42 (`<script setup lang="ts">`), TypeScript strict, Vitest + happy-dom + @vue/test-utils, Playwright, `@lucide/vue`, CSS custom properties (`--hf-*`), без CSS-фреймворка и без Pinia.

**Spec:** `docs/superpowers/specs/2026-09-14-app-ui-foundation-design.md` (входные документы, из которых он аргументирует: `docs/superpowers/specs/HarmoFin — UI-UX Blueprint для Frontend Agent.md`, `docs/superpowers/specs/HarmoFin — UX workflow, основные страницы и UI-компоненты.md`, эскизы `identity/UI design.png`)

## Global Constraints

- Node.js 24.20.0, pnpm 11.24.0. Ветку ответвлять от `main` — PR #17 (`feat/landing-redesign`) уже влит, новые токены в базе есть.
- Команды: `pnpm --filter @harmofin/web test`, `... lint`, `... typecheck`, `... build`, `pnpm format`, `pnpm test:e2e` (Playwright только в CI, локально не запускать).
- Prettier: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`. После правок — `pnpm format`.
- ESLint: `eslint.configs.recommended` + `typescript-eslint` + `vue/flat/recommended`; `@typescript-eslint/no-explicit-any: error`; `vue/multi-word-component-names: error` — имя каждого компонента из двух слов через `defineOptions({ name: '...' })`; `no-irregular-whitespace` активен.
- TypeScript strict, включая `noUncheckedIndexedAccess` и `exactOptionalPropertyTypes`: индексация массива даёт `T | undefined`, пиши код без непроверенной индексации.
- В `.vue` локальные `.ts`-модули импортируются с расширением `.js` (`import { useAuth } from '../../composables/useAuth.js'`).
- Цвета, отступы, радиусы, тени, типографика — только токенами `--hf-*`. `apps/web/app/assets/styles/tokens.css` содержит тест-страж: каждый использованный `var(--hf-color-…)` должен быть там определён.
- Токены `--hf-color-*-bright` не используются как фон под белым текстом и не являются единственным носителем статуса.
- Деньги форматируются существующими `FinanceMoney` / `formatMinorUnits`; фронтенд не считает суммы — они приходят с сервера.
- Тексты интерфейса на русском, идентификаторы, имена файлов и коммиты на английском.
- Под Vitest `#imports` резолвится в `apps/web/app/test/nuxt-imports.ts`, `#components` — в `apps/web/app/test/nuxt-components.ts` (там `NuxtLink` рендерится как `<a href>`). Нужен новый автоимпорт в тестах — добавляй его в эти стабы, а не мокай в каждом файле.
- В денежных ассертах неразрывные пробелы пишутся escape-последовательностями ` ` / ` `, никогда литеральным невидимым символом.
- Не перезаписывай существующие тестовые файлы: у `Button`, `BalanceList`, `PeriodLimitCard`, `UpcomingObligations`, `pages/app/index.vue` тесты уже есть — новые случаи добавляются в них.
- Backend и OpenAPI не трогаем: всё нужное отдаёт `GET /api/v1/budgets/{budgetId}/summary`.

### Формы данных, на которые опирается план

```ts
type DashboardWarning = { subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: string };
type DashboardBalance = { id: string; name: string; balanceMinor: string };

type DashboardSummaryDto = {
  cycle: { start: string; end: string };
  period: { id: 'FIRST' | 'SECOND'; start: string; end: string };
  totalAccountMoneyMinor: string;
  accounts: DashboardBalance[];
  envelopes: DashboardBalance[];
  unallocatedIncomeMinor: string;
  periodLimit:
    | {
        state: 'available';
        envelopeId: string;
        limitMinor: string;
        spentMinor: string;
        remainingMinor: string;
        daysUntilBoundary: number;
        averageRemainingDailyLimitMinor: string;
      }
    | { state: 'unavailable' };
  warnings: DashboardWarning[];
  upcomingObligations: UpcomingObligationDto[];
};
```

---

### Task 1: `useToast` — очередь тостов

**Files:**
- Create: `apps/web/app/composables/useToast.ts`
- Create: `apps/web/app/composables/useToast.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `useToast(): { toasts: Readonly<Ref<ToastItem[]>>; push(input: ToastInput): string; dismiss(id: string): void; clear(): void }`, где `type ToastTone = 'success' | 'error' | 'info'`, `type ToastInput = { tone: ToastTone; title: string; description?: string; durationMs?: number }`, `type ToastItem = ToastInput & { id: string }`. Очередь общая на приложение (модульный синглтон): вызов из формы и контейнер в layout видят один и тот же список.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/composables/useToast.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToast } from './useToast.js';

beforeEach(() => {
  vi.useFakeTimers();
  useToast().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToast', () => {
  it('shares one queue across call sites', () => {
    const producer = useToast();
    const consumer = useToast();

    producer.push({ tone: 'success', title: 'Операция сохранена' });

    expect(consumer.toasts.value).toHaveLength(1);
    expect(consumer.toasts.value[0]?.title).toBe('Операция сохранена');
    expect(consumer.toasts.value[0]?.tone).toBe('success');
  });

  it('keeps every pushed toast until it is dismissed', () => {
    const { toasts, push, dismiss } = useToast();

    const first = push({ tone: 'info', title: 'Первый' });
    push({ tone: 'error', title: 'Второй' });
    expect(toasts.value).toHaveLength(2);

    dismiss(first);

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.title).toBe('Второй');
  });

  it('removes a toast once its lifetime elapses', () => {
    const { toasts, push } = useToast();

    push({ tone: 'success', title: 'Счёт создан' });
    expect(toasts.value).toHaveLength(1);

    vi.advanceTimersByTime(6000);

    expect(toasts.value).toHaveLength(0);
  });

  it('honours an explicit lifetime', () => {
    const { toasts, push } = useToast();

    push({ tone: 'error', title: 'Не удалось сохранить', durationMs: 12_000 });

    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(1);

    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(0);
  });

  it('gives every toast its own id', () => {
    const { push } = useToast();

    expect(push({ tone: 'info', title: 'Раз' })).not.toBe(push({ tone: 'info', title: 'Два' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- useToast.test.ts`
Expected: FAIL — `Cannot find module './useToast.js'`.

- [ ] **Step 3: Write the composable**

`apps/web/app/composables/useToast.ts`:

```ts
import { readonly, ref, type Ref } from 'vue';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
}

export interface ToastItem extends ToastInput {
  id: string;
}

const DEFAULT_DURATION_MS = 6000;

// Module-level state on purpose: a form deep in a page pushes a toast that a
// container mounted in the layout renders. Both call useToast().
const items = ref<ToastItem[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function dismiss(id: string): void {
  clearTimer(id);
  items.value = items.value.filter((item) => item.id !== id);
}

function push(input: ToastInput): string {
  nextId += 1;
  const id = `toast-${nextId}`;
  items.value = [...items.value, { ...input, id }];
  timers.set(
    id,
    setTimeout(() => {
      dismiss(id);
    }, input.durationMs ?? DEFAULT_DURATION_MS),
  );
  return id;
}

function clear(): void {
  for (const id of timers.keys()) clearTimer(id);
  items.value = [];
}

export function useToast(): {
  toasts: Readonly<Ref<ToastItem[]>>;
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
} {
  return { toasts: readonly(items) as Readonly<Ref<ToastItem[]>>, push, dismiss, clear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- useToast.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/composables/useToast.ts apps/web/app/composables/useToast.test.ts
git commit -m "feat(web): add a shared toast queue composable"
```

---

### Task 2: `UiToast` и `UiToastStack`

**Files:**
- Create: `apps/web/app/components/ui/Toast.vue`
- Create: `apps/web/app/components/ui/ToastStack.vue`
- Create: `apps/web/app/components/ui/ToastStack.test.ts`
- Modify: `apps/web/app/layouts/app.vue`

**Interfaces:**
- Consumes: `useToast()` из Task 1.
- Produces: `UiToastStack` без пропов — монтируется один раз в `layouts/app.vue` и рисует текущую очередь. `UiToast` принимает `toast: ToastItem` и эмитит `dismiss: [id: string]`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/ui/ToastStack.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UiToastStack from './ToastStack.vue';
import { useToast } from '../../composables/useToast.js';

beforeEach(() => {
  vi.useFakeTimers();
  useToast().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UiToastStack', () => {
  it('announces toasts politely without stealing focus', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'success', title: 'Операция сохранена', description: '2 450 ₽' });
    await wrapper.vm.$nextTick();

    const region = wrapper.get('[data-testid="toast-stack"]');
    expect(region.attributes('role')).toBe('status');
    expect(region.attributes('aria-live')).toBe('polite');
    expect(wrapper.text()).toContain('Операция сохранена');
    expect(wrapper.text()).toContain('2 450 ₽');
  });

  it('renders several toasts at once', async () => {
    const wrapper = mount(UiToastStack);
    const { push } = useToast();
    push({ tone: 'info', title: 'Первый' });
    push({ tone: 'error', title: 'Второй' });
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(2);
  });

  it('dismisses a toast from its close button', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'info', title: 'Закрой меня' });
    await wrapper.vm.$nextTick();

    const close = wrapper.get('[data-testid="toast-dismiss"]');
    expect(close.attributes('aria-label')).toBe('Закрыть уведомление');

    await close.trigger('click');

    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(0);
  });

  it('marks the tone in text, not only in colour', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'error', title: 'Не удалось сохранить' });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="toast"]').text()).toContain('Ошибка');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- ToastStack.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Write `Toast.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue';

import type { ToastItem } from '../../composables/useToast.js';

defineOptions({ name: 'UiToast' });

const props = defineProps<{ toast: ToastItem }>();
defineEmits<{ dismiss: [id: string] }>();

const toneLabel = computed(() => {
  if (props.toast.tone === 'success') return 'Готово';
  if (props.toast.tone === 'error') return 'Ошибка';
  return 'Информация';
});

const toneIcon = computed(() => {
  if (props.toast.tone === 'success') return CircleCheck;
  if (props.toast.tone === 'error') return CircleAlert;
  return Info;
});
</script>

<template>
  <article class="ui-toast" :class="`ui-toast--${toast.tone}`" data-testid="toast">
    <component :is="toneIcon" class="ui-toast__icon" :size="20" aria-hidden="true" />
    <div class="ui-toast__body">
      <p class="ui-toast__tone">{{ toneLabel }}</p>
      <p class="ui-toast__title">{{ toast.title }}</p>
      <p v-if="toast.description" class="ui-toast__description">{{ toast.description }}</p>
    </div>
    <button
      type="button"
      class="ui-toast__dismiss"
      data-testid="toast-dismiss"
      aria-label="Закрыть уведомление"
      @click="$emit('dismiss', toast.id)"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.ui-toast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--hf-space-3);
  align-items: start;
  width: min(24rem, 100%);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.ui-toast--success .ui-toast__icon {
  color: var(--hf-color-brand);
}

.ui-toast--error .ui-toast__icon {
  color: var(--hf-color-action-danger);
}

.ui-toast--info .ui-toast__icon {
  color: var(--hf-color-action-primary);
}

.ui-toast__body {
  display: grid;
  gap: var(--hf-space-1);
}

.ui-toast__tone {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ui-toast__title {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
}

.ui-toast__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.ui-toast__dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  margin: calc(var(--hf-space-2) * -1);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
}
</style>
```

- [ ] **Step 4: Write `ToastStack.vue`**

```vue
<script setup lang="ts">
import UiToast from './Toast.vue';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'UiToastStack' });

const { toasts, dismiss } = useToast();
</script>

<template>
  <div
    class="ui-toast-stack"
    data-testid="toast-stack"
    role="status"
    aria-live="polite"
    aria-relevant="additions"
  >
    <UiToast v-for="toast in toasts" :key="toast.id" :toast="toast" @dismiss="dismiss" />
  </div>
</template>

<style scoped>
.ui-toast-stack {
  position: fixed;
  right: var(--hf-space-4);
  bottom: var(--hf-space-4);
  left: var(--hf-space-4);
  z-index: 90;
  display: grid;
  gap: var(--hf-space-3);
  justify-items: center;
  pointer-events: none;
}

.ui-toast-stack > * {
  pointer-events: auto;
}

@media (min-width: 768px) {
  .ui-toast-stack {
    left: auto;
    justify-items: end;
  }
}
</style>
```

`z-index: 90` намеренно ниже шапки (`100`) и модалок: тост не должен перекрывать открытый диалог.

- [ ] **Step 5: Mount the stack in the layout**

В `apps/web/app/layouts/app.vue` добавить импорт `import UiToastStack from '../components/ui/ToastStack.vue';` и разместить `<UiToastStack />` последним элементом внутри `.app-layout`, после `.app-layout__body`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @harmofin/web test -- ToastStack.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 7: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/ui/Toast.vue apps/web/app/components/ui/ToastStack.vue apps/web/app/components/ui/ToastStack.test.ts apps/web/app/layouts/app.vue
git commit -m "feat(web): render application toasts from the app layout"
```

---

### Task 3: `UiSkeleton`

**Files:**
- Create: `apps/web/app/components/ui/Skeleton.vue`
- Create: `apps/web/app/components/ui/Skeleton.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `UiSkeleton` с пропами `variant?: 'text' | 'card' | 'row'` (по умолчанию `'text'`) и `count?: number` (по умолчанию `1`). Декоративен: корень несёт `aria-hidden="true"`, о загрузке сообщает контейнер-потребитель через `aria-busy`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/ui/Skeleton.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiSkeleton from './Skeleton.vue';

describe('UiSkeleton', () => {
  it('is hidden from assistive technology', () => {
    const wrapper = mount(UiSkeleton);

    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });

  it('renders one placeholder by default and the requested number otherwise', () => {
    expect(mount(UiSkeleton).findAll('[data-testid="skeleton-item"]')).toHaveLength(1);
    expect(
      mount(UiSkeleton, { props: { count: 3 } }).findAll('[data-testid="skeleton-item"]'),
    ).toHaveLength(3);
  });

  it('applies the requested variant', () => {
    const wrapper = mount(UiSkeleton, { props: { variant: 'card' } });

    expect(wrapper.get('[data-testid="skeleton-item"]').classes()).toContain(
      'ui-skeleton__item--card',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- Skeleton.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'UiSkeleton' });

const props = withDefaults(
  defineProps<{ variant?: 'text' | 'card' | 'row'; count?: number }>(),
  { variant: 'text', count: 1 },
);

const placeholders = computed(() => Array.from({ length: Math.max(1, props.count) }, (_, i) => i));
</script>

<template>
  <div class="ui-skeleton" aria-hidden="true">
    <span
      v-for="index in placeholders"
      :key="index"
      class="ui-skeleton__item"
      :class="`ui-skeleton__item--${variant}`"
      data-testid="skeleton-item"
    />
  </div>
</template>

<style scoped>
.ui-skeleton {
  display: grid;
  gap: var(--hf-space-3);
}

.ui-skeleton__item {
  display: block;
  border-radius: var(--hf-radius-md);
  background: linear-gradient(
    90deg,
    var(--hf-color-slate-200) 25%,
    var(--hf-color-page-background) 37%,
    var(--hf-color-slate-200) 63%
  );
  background-size: 400% 100%;
  animation: ui-skeleton-shimmer 1.4s ease infinite;
}

.ui-skeleton__item--text {
  height: 1rem;
}

.ui-skeleton__item--row {
  height: 3rem;
}

.ui-skeleton__item--card {
  height: 9rem;
  border-radius: var(--hf-radius-lg);
}

@keyframes ui-skeleton-shimmer {
  to {
    background-position: -400% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton__item {
    animation: none;
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- Skeleton.test.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/ui/Skeleton.vue apps/web/app/components/ui/Skeleton.test.ts
git commit -m "feat(web): add a skeleton placeholder primitive"
```

---

### Task 4: `useOperationDialogs` — общее состояние диалогов

**Files:**
- Create: `apps/web/app/composables/useOperationDialogs.ts`
- Create: `apps/web/app/composables/useOperationDialogs.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `useOperationDialogs(): { openDialog: Readonly<Ref<OperationDialog>>; openOperation(): void; openTransfer(): void; close(): void }`, где `type OperationDialog = 'none' | 'operation' | 'transfer'`. Состояние — модульный синглтон: кнопка в шапке открывает диалог, смонтированный в layout.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/composables/useOperationDialogs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { useOperationDialogs } from './useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
});

describe('useOperationDialogs', () => {
  it('starts closed', () => {
    expect(useOperationDialogs().openDialog.value).toBe('none');
  });

  it('shares its state across call sites', () => {
    const trigger = useOperationDialogs();
    const host = useOperationDialogs();

    trigger.openOperation();

    expect(host.openDialog.value).toBe('operation');
  });

  it('keeps at most one dialog open', () => {
    const { openDialog, openOperation, openTransfer } = useOperationDialogs();

    openOperation();
    openTransfer();

    expect(openDialog.value).toBe('transfer');
  });

  it('closes', () => {
    const { openDialog, openTransfer, close } = useOperationDialogs();

    openTransfer();
    close();

    expect(openDialog.value).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- useOperationDialogs.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Write the composable**

```ts
import { readonly, ref, type Ref } from 'vue';

export type OperationDialog = 'none' | 'operation' | 'transfer';

// Module-level: the header button and the dialogs live in different components.
const openDialog = ref<OperationDialog>('none');

export function useOperationDialogs(): {
  openDialog: Readonly<Ref<OperationDialog>>;
  openOperation: () => void;
  openTransfer: () => void;
  close: () => void;
} {
  return {
    openDialog: readonly(openDialog) as Readonly<Ref<OperationDialog>>,
    openOperation: () => {
      openDialog.value = 'operation';
    },
    openTransfer: () => {
      openDialog.value = 'transfer';
    },
    close: () => {
      openDialog.value = 'none';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- useOperationDialogs.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/composables/useOperationDialogs.ts apps/web/app/composables/useOperationDialogs.test.ts
git commit -m "feat(web): share operation dialog state across the app shell"
```

---

### Task 5: Глобальная кнопка «+ Добавить»

**Files:**
- Create: `apps/web/app/components/app/AppAddMenu.vue`
- Create: `apps/web/app/components/app/AppAddMenu.test.ts`
- Modify: `apps/web/app/components/app/AppHeader.vue`
- Modify: `apps/web/app/components/app/AppSidebar.vue`

**Interfaces:**
- Consumes: `useOperationDialogs()` из Task 4, `UiButton` (`apps/web/app/components/ui/Button.vue`, пропы `variant: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'brand'`, `size`, `to?`).
- Produces: `AppAddMenu` без пропов — кнопка «+ Добавить», раскрывающая список «Доход», «Расход», «Перевод». «Доход» и «Расход» открывают диалог операции, «Перевод» — диалог перевода.

Диалог операции один на оба типа: существующий `AddOperationModal` сам спрашивает тип внутри формы. Пункты «Доход» и «Расход» ведут в него же — это осознанно, отдельный проп типа добавим позже, когда форма научится принимать предустановленный тип.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/app/AppAddMenu.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AppAddMenu from './AppAddMenu.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
});

describe('AppAddMenu', () => {
  it('keeps the menu closed until the trigger is used', () => {
    const wrapper = mount(AppAddMenu);
    const trigger = wrapper.get('[data-testid="add-menu-trigger"]');

    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-controls')).toBe('app-add-menu');
    expect(wrapper.find('#app-add-menu').exists()).toBe(false);
  });

  it('opens the operation dialog from the expense item', async () => {
    const wrapper = mount(AppAddMenu);
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="add-menu-expense"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('operation');
    expect(wrapper.find('#app-add-menu').exists()).toBe(false);
  });

  it('opens the transfer dialog from the transfer item', async () => {
    const wrapper = mount(AppAddMenu);
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="add-menu-transfer"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('transfer');
  });

  it('closes on Escape', async () => {
    const wrapper = mount(AppAddMenu, { attachTo: document.body });
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="add-menu-trigger"]').attributes('aria-expanded')).toBe(
      'false',
    );
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- AppAddMenu.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowLeftRight, Minus, Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

defineOptions({ name: 'AppAddMenu' });

const { openOperation, openTransfer } = useOperationDialogs();
const open = ref(false);

function toggle(): void {
  open.value = !open.value;
}

function chooseOperation(): void {
  open.value = false;
  openOperation();
}

function chooseTransfer(): void {
  open.value = false;
  openTransfer();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="app-add-menu">
    <UiButton
      variant="brand"
      size="md"
      data-testid="add-menu-trigger"
      :aria-expanded="open ? 'true' : 'false'"
      aria-controls="app-add-menu"
      aria-haspopup="menu"
      @click="toggle"
    >
      <Plus :size="18" aria-hidden="true" />
      Добавить
    </UiButton>

    <div v-if="open" id="app-add-menu" class="app-add-menu__list" role="menu">
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-income"
        @click="chooseOperation"
      >
        <Plus :size="16" aria-hidden="true" />
        Доход
      </button>
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-expense"
        @click="chooseOperation"
      >
        <Minus :size="16" aria-hidden="true" />
        Расход
      </button>
      <button
        type="button"
        role="menuitem"
        class="app-add-menu__item"
        data-testid="add-menu-transfer"
        @click="chooseTransfer"
      >
        <ArrowLeftRight :size="16" aria-hidden="true" />
        Перевод
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-add-menu {
  position: relative;
}

.app-add-menu__list {
  position: absolute;
  right: 0;
  z-index: 110;
  display: grid;
  min-width: 12rem;
  margin-top: var(--hf-space-2);
  padding: var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
}

.app-add-menu__item {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 2.75rem;
  padding: 0 var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  text-align: left;
}

.app-add-menu__item:hover {
  background: var(--hf-color-action-secondary-hover);
}
</style>
```

- [ ] **Step 4: Place the menu in the shell**

В `AppHeader.vue` вставить `<AppAddMenu class="app-header__add" />` между `.app-header__wordmark` и `<AppUserMenu />`, добавив импорт. В `AppSidebar.vue` разместить `<AppAddMenu />` под названием продукта, до списка разделов, — на десктопе шапка скрыта (`@media (min-width: 1024px) { .app-layout__header { display: none } }`), поэтому без этого кнопка исчезнет на широких экранах.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test -- AppAddMenu.test.ts AppSidebar.test.ts`
Expected: PASS; существующий `AppSidebar.test.ts` остаётся зелёным.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/app
git commit -m "feat(web): add a global add-operation menu to the app shell"
```

---

### Task 6: Диалоги операции и перевода переезжают в layout

**Files:**
- Modify: `apps/web/app/layouts/app.vue`
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`
- Create: `apps/web/app/components/app/AppOperationDialogs.vue`
- Create: `apps/web/app/components/app/AppOperationDialogs.test.ts`

**Interfaces:**
- Consumes: `useOperationDialogs()` (Task 4), `useToast()` (Task 1), существующие `AddOperationModal` и `AddTransferModal` из `apps/web/app/components/dashboard/`.
- Produces: `AppOperationDialogs` без пропов — монтирует обе модалки по состоянию из `useOperationDialogs()` и эмитит `saved: []`, когда операция или перевод сохранены, чтобы страница могла перезагрузить свои данные.

Модалки остаются в папке `components/dashboard/` — перенос файлов сюда не входит: он раздул бы диff и затронул их собственные тесты.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/app/AppOperationDialogs.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/AddOperationModal.vue', () => ({
  default: {
    name: 'AddOperationModal',
    props: ['open'],
    emits: ['close', 'saved'],
    template:
      '<div v-if="open" data-testid="operation-modal"><button data-testid="operation-saved" @click="$emit(\'saved\')"></button></div>',
  },
}));

vi.mock('../dashboard/AddTransferModal.vue', () => ({
  default: {
    name: 'AddTransferModal',
    props: ['open'],
    emits: ['close', 'saved'],
    template: '<div v-if="open" data-testid="transfer-modal"></div>',
  },
}));

import AppOperationDialogs from './AppOperationDialogs.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useToast } from '../../composables/useToast.js';

beforeEach(() => {
  useOperationDialogs().close();
  useToast().clear();
});

describe('AppOperationDialogs', () => {
  it('shows nothing while no dialog is requested', () => {
    const wrapper = mount(AppOperationDialogs);

    expect(wrapper.find('[data-testid="operation-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="transfer-modal"]').exists()).toBe(false);
  });

  it('opens the requested dialog', async () => {
    const wrapper = mount(AppOperationDialogs);

    useOperationDialogs().openTransfer();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="transfer-modal"]')).toBeTruthy();
  });

  it('reports a save, closes the dialog and announces it', async () => {
    const wrapper = mount(AppOperationDialogs);
    useOperationDialogs().openOperation();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="operation-saved"]').trigger('click');

    expect(wrapper.emitted('saved')).toHaveLength(1);
    expect(useOperationDialogs().openDialog.value).toBe('none');
    expect(useToast().toasts.value[0]?.title).toBe('Операция сохранена');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- AppOperationDialogs.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import AddOperationModal from '../dashboard/AddOperationModal.vue';
import AddTransferModal from '../dashboard/AddTransferModal.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppOperationDialogs' });

const emit = defineEmits<{ saved: [] }>();

const { openDialog, close } = useOperationDialogs();
const { push } = useToast();

const operationOpen = computed(() => openDialog.value === 'operation');
const transferOpen = computed(() => openDialog.value === 'transfer');

function handleSaved(title: string): void {
  close();
  push({ tone: 'success', title });
  emit('saved');
}
</script>

<template>
  <div class="app-operation-dialogs">
    <AddOperationModal
      :open="operationOpen"
      @close="close"
      @saved="handleSaved('Операция сохранена')"
    />
    <AddTransferModal :open="transferOpen" @close="close" @saved="handleSaved('Перевод сохранён')" />
  </div>
</template>
```

Перед реализацией открой `apps/web/app/components/dashboard/AddOperationModal.vue` и `AddTransferModal.vue` и сверь фактические имена пропа и событий. Если событие сохранения называется иначе, используй фактическое имя и отметь это в отчёте — тестовые заглушки выше нужно будет привести к тому же контракту.

- [ ] **Step 4: Mount it in the layout and strip the page**

В `layouts/app.vue` добавить `<AppOperationDialogs />` рядом с `<UiToastStack />`.

В `pages/app/index.vue` удалить импорты `AddOperationModal`, `AddTransferModal`, `QuickActionBar`, состояния `operationModalOpen` / `transferModalOpen` и их обработчики, а также разметку этих модалок. Кнопку «Обновить» из `QuickActionBar` перенести в заголовок страницы как иконочную кнопку с `aria-label="Обновить данные"`. Перезагрузку после сохранения обеспечивает layout: страница больше не знает о диалогах.

Чтобы главная обновлялась после сохранения из шапки, в `layouts/app.vue` пробрось событие вниз через provide/inject не нужно — вместо этого `pages/app/index.vue` подписывается на изменение состояния диалога:

```ts
import { watch } from 'vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

const { openDialog } = useOperationDialogs();

watch(openDialog, (value, previous) => {
  if (value === 'none' && previous !== 'none') void load();
});
```

где `load()` — существующая функция загрузки сводки на странице.

- [ ] **Step 5: Update the dashboard page test**

В `apps/web/app/pages/app/index.test.ts` оба существующих случая должны остаться зелёными. Добавить третий:

```ts
  it('reloads the summary after a dialog closes', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(1);

    const dialogs = useOperationDialogs();
    dialogs.openOperation();
    await wrapper.vm.$nextTick();
    dialogs.close();
    await flushPromises();

    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
  });
```

с импортом `import { useOperationDialogs } from '../../composables/useOperationDialogs.js';` и сбросом состояния в существующем `beforeEach`: `useOperationDialogs().close();`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @harmofin/web test -- AppOperationDialogs.test.ts index.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/app apps/web/app/layouts/app.vue apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): move operation dialogs into the app layout"
```

---

### Task 7: Нижняя навигация на мобильных

**Files:**
- Create: `apps/web/app/components/app/AppBottomNav.vue`
- Create: `apps/web/app/components/app/AppBottomNav.test.ts`
- Modify: `apps/web/app/layouts/app.vue`

**Interfaces:**
- Consumes: `useOperationDialogs()` (Task 4).
- Produces: `AppBottomNav` без пропов — «Главная» (`/app`), «Операции» (`/app/operations`), центральная кнопка «+», «Ещё» (эмитит `more: []`, чтобы layout открыл существующее мобильное меню).

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/app/AppBottomNav.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AppBottomNav from './AppBottomNav.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const mountNav = () => mount(AppBottomNav, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

beforeEach(() => {
  useOperationDialogs().close();
});

describe('AppBottomNav', () => {
  it('links to the two most used sections', () => {
    const hrefs = mountNav()
      .findAll('a')
      .map((link) => link.attributes('href'));

    expect(hrefs).toEqual(['/app', '/app/operations']);
  });

  it('opens the operation dialog from the central button', async () => {
    const wrapper = mountNav();

    await wrapper.get('[data-testid="bottom-nav-add"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('operation');
  });

  it('asks the shell to open the rest of the navigation', async () => {
    const wrapper = mountNav();

    await wrapper.get('[data-testid="bottom-nav-more"]').trigger('click');

    expect(wrapper.emitted('more')).toHaveLength(1);
  });

  it('labels icon-only controls', () => {
    const wrapper = mountNav();

    expect(wrapper.get('[data-testid="bottom-nav-add"]').attributes('aria-label')).toBe(
      'Добавить операцию',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- AppBottomNav.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { House, Menu, Plus, Receipt } from '@lucide/vue';

import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

defineOptions({ name: 'AppBottomNav' });

defineEmits<{ more: [] }>();

const { openOperation } = useOperationDialogs();
</script>

<template>
  <nav class="app-bottom-nav" aria-label="Основные разделы">
    <NuxtLink to="/app" class="app-bottom-nav__item">
      <House :size="20" aria-hidden="true" />
      <span>Главная</span>
    </NuxtLink>

    <NuxtLink to="/app/operations" class="app-bottom-nav__item">
      <Receipt :size="20" aria-hidden="true" />
      <span>Операции</span>
    </NuxtLink>

    <button
      type="button"
      class="app-bottom-nav__add"
      data-testid="bottom-nav-add"
      aria-label="Добавить операцию"
      @click="openOperation"
    >
      <Plus :size="24" aria-hidden="true" />
    </button>

    <button
      type="button"
      class="app-bottom-nav__item"
      data-testid="bottom-nav-more"
      @click="$emit('more')"
    >
      <Menu :size="20" aria-hidden="true" />
      <span>Ещё</span>
    </button>
  </nav>
</template>

<style scoped>
.app-bottom-nav {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 95;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  padding: var(--hf-space-2) var(--hf-space-2) calc(var(--hf-space-2) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

.app-bottom-nav__item {
  display: grid;
  gap: var(--hf-space-1);
  justify-items: center;
  min-height: 2.75rem;
  border: 0;
  background: transparent;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-decoration: none;
}

.app-bottom-nav__item.router-link-active {
  color: var(--hf-color-action-primary);
}

.app-bottom-nav__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  justify-self: center;
  border: 0;
  border-radius: 50%;
  background: var(--hf-color-action-brand);
  color: var(--hf-color-white);
  box-shadow: var(--hf-shadow-md);
}

@media (min-width: 1024px) {
  .app-bottom-nav {
    display: none;
  }
}
</style>
```

- [ ] **Step 4: Wire it into the layout**

В `layouts/app.vue` смонтировать `<AppBottomNav @more="mobileMenuOpen = true" />`. Мобильное меню сейчас живёт внутри `AppHeader` — вынеси `AppMobileMenu` из `AppHeader.vue` в layout вместе с состоянием `mobileMenuOpen`, чтобы им управляли обе точки входа (бургер в шапке и «Ещё» в нижней навигации). Кнопку-бургер в шапке оставь, прокинув наружу событие `toggle`.

Добавь основному контенту нижний отступ, чтобы панель не перекрывала последний блок: в `.app-layout__main` — `padding-bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom))`, а внутри `@media (min-width: 1024px)` верни обычный `padding`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS — все существующие тесты остаются зелёными.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
git add apps/web/app/components/app apps/web/app/layouts/app.vue
git commit -m "feat(web): add mobile bottom navigation to the app shell"
```

---

### Task 8: `AvailableBudgetCard`

**Files:**
- Create: `apps/web/app/components/dashboard/AvailableBudgetCard.vue`
- Create: `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`
- Delete: `apps/web/app/components/dashboard/PeriodLimitCard.vue`, `apps/web/app/components/dashboard/PeriodLimitCard.test.ts`

**Interfaces:**
- Consumes: типы `DashboardSummaryDto['periodLimit']` и `DashboardSummaryDto['period']`, компонент `FinanceMoney`.
- Produces: `AvailableBudgetCard` с пропами `periodLimit: DashboardSummaryDto['periodLimit']` и `period: DashboardSummaryDto['period']`.

Пороговые состояния, считаются от данных сервера, без собственной денежной арифметики сверх процента:

| Состояние | Условие |
| --- | --- |
| `unavailable` | `periodLimit.state === 'unavailable'` |
| `negative` | остаток меньше нуля |
| `critical` | остаток больше либо равен нулю и не больше дневного ориентира |
| `warning` | потрачено ≥ 80 % лимита и состояние не `critical` |
| `normal` | остальные случаи |

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableBudgetCard from './AvailableBudgetCard.vue';

const period = { id: 'SECOND' as const, start: '2026-09-25', end: '2026-10-09' };

const available = {
  state: 'available' as const,
  envelopeId: 'envelope-id',
  limitMinor: '6300000',
  spentMinor: '4120000',
  remainingMinor: '2180000',
  daysUntilBoundary: 7,
  averageRemainingDailyLimitMinor: '311400',
};

const normalize = (value: string): string => value.replace(/[   ]/g, ' ');

describe('AvailableBudgetCard', () => {
  it('leads with the amount the user can still spend', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('21 800,00 ₽');
    expect(text).toContain('Осталось 7 дней');
    expect(text).toContain('3 114,00 ₽');
    expect(text).toContain('25.09');
    expect(text).toContain('09.10');
  });

  it('exposes spending progress to assistive technology', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const bar = wrapper.get('[role="progressbar"]');

    expect(bar.attributes('aria-valuenow')).toBe('65');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe(
      'Потрачено 41 200,00 ₽ из лимита 63 000,00 ₽',
    );
  });

  it('names its state in words, not only in colour', () => {
    const warning = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '5100000', remainingMinor: '1200000' },
        period,
      },
    });
    expect(normalize(warning.text())).toContain('Лимит периода почти исчерпан');

    const critical = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6100000', remainingMinor: '200000' },
        period,
      },
    });
    expect(normalize(critical.text())).toContain('Остатка хватит меньше чем на день');

    const negative = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6500000', remainingMinor: '-200000' },
        period,
      },
    });
    expect(normalize(negative.text())).toContain('Лимит периода превышен');
  });

  it('explains an unconfigured period instead of showing a fake zero', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { periodLimit: { state: 'unavailable' }, period },
    });

    expect(wrapper.text()).toContain('Конверт текущего периода не настроен');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- AvailableBudgetCard.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import type { DashboardSummaryDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'AvailableBudgetCard' });

const props = defineProps<{
  periodLimit: DashboardSummaryDto['periodLimit'];
  period: DashboardSummaryDto['period'];
}>();

type CardState = 'normal' | 'warning' | 'critical' | 'negative' | 'unavailable';

const details = computed(() => (props.periodLimit.state === 'available' ? props.periodLimit : null));

const state = computed<CardState>(() => {
  const limit = details.value;
  if (!limit) return 'unavailable';

  const remaining = Number(BigInt(limit.remainingMinor));
  const daily = Number(BigInt(limit.averageRemainingDailyLimitMinor));
  const total = Number(BigInt(limit.limitMinor));
  const spent = Number(BigInt(limit.spentMinor));

  if (remaining < 0) return 'negative';
  if (remaining <= daily) return 'critical';
  if (total > 0 && spent / total >= 0.8) return 'warning';
  return 'normal';
});

const stateLabel = computed(() => {
  if (state.value === 'negative') return 'Лимит периода превышен';
  if (state.value === 'critical') return 'Остатка хватит меньше чем на день';
  if (state.value === 'warning') return 'Лимит периода почти исчерпан';
  return 'В пределах лимита';
});

const spentPercent = computed(() => {
  const limit = details.value;
  if (!limit) return 0;
  const total = Number(BigInt(limit.limitMinor));
  if (total <= 0) return 0;
  return Math.min(100, Math.round((Number(BigInt(limit.spentMinor)) / total) * 100));
});

function formatDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

const periodLabel = computed(() => `${formatDay(props.period.start)} – ${formatDay(props.period.end)}`);

const progressLabel = computed(() => {
  const limit = details.value;
  if (!limit) return '';
  const spent = formatMinorUnits(limit.spentMinor, 'RUB', 2);
  const total = formatMinorUnits(limit.limitMinor, 'RUB', 2);
  return `Потрачено ${spent} из лимита ${total}`;
});
</script>

<template>
  <section class="available-budget" :class="`available-budget--${state}`" aria-labelledby="available-budget-title">
    <p class="available-budget__period">Период {{ periodLabel }}</p>
    <h2 id="available-budget-title" class="available-budget__label">Можно потратить</h2>

    <template v-if="details">
      <p class="available-budget__amount">
        <FinanceMoney :minor-units="details.remainingMinor" currency="RUB" :scale="2" />
      </p>

      <div
        class="available-budget__track"
        role="progressbar"
        :aria-label="progressLabel"
        :aria-valuenow="spentPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="available-budget__fill" :style="{ width: `${spentPercent}%` }" />
      </div>

      <p class="available-budget__state">{{ stateLabel }}</p>

      <dl class="available-budget__rows">
        <div>
          <dt>Потрачено</dt>
          <dd><FinanceMoney :minor-units="details.spentMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Лимит</dt>
          <dd><FinanceMoney :minor-units="details.limitMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Осталось {{ details.daysUntilBoundary }} дней</dt>
          <dd>
            ≈
            <FinanceMoney
              :minor-units="details.averageRemainingDailyLimitMinor"
              currency="RUB"
              :scale="2"
            />
            / день
          </dd>
        </div>
      </dl>
    </template>

    <p v-else class="available-budget__empty">
      Конверт текущего периода не настроен. Создайте его в разделе «Конверты», чтобы видеть
      доступный остаток.
    </p>
  </section>
</template>
```

`progressLabel` собирается тем же форматтером, что использует `FinanceMoney`, — в `aria-label` должны попасть отформатированные суммы, а не минорные единицы.

Стили: карточка на `var(--hf-color-surface)` с `var(--hf-radius-lg)`, границей `var(--hf-color-border)` и `var(--hf-shadow-sm)`; сумма — `var(--hf-font-size-display)` с `font-variant-numeric: tabular-nums`; полоса высотой `0.625rem` на `var(--hf-color-slate-200)`, заливка по состоянию: `normal` и `warning` — `var(--hf-color-brand-bright)`, `critical` — `var(--hf-color-status-warning-bright)`, `negative` — `var(--hf-color-status-danger-bright)`. Цвет заливки дублируется словами в `.available-budget__state`.

- [ ] **Step 4: Swap it into the dashboard and delete the old card**

В `pages/app/index.vue` заменить `<PeriodLimitCard :period-limit="summary.periodLimit" />` на `<AvailableBudgetCard :period-limit="summary.periodLimit" :period="summary.period" />`, поправив импорт.

```bash
git rm apps/web/app/components/dashboard/PeriodLimitCard.vue apps/web/app/components/dashboard/PeriodLimitCard.test.ts
```

Существующий тест страницы (`index.test.ts`) ожидает строку `'Остаток:75,00 ₽'` — она принадлежала старой карточке. Замени это ожидание на `expect(text).toContain('Можно потратить')` и `expect(text).toContain('75,00 ₽')`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test -- AvailableBudgetCard.test.ts index.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/dashboard apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): lead the dashboard with an available-to-spend card"
```

---

### Task 9: `DashboardWarnings`

**Files:**
- Create: `apps/web/app/components/dashboard/DashboardWarnings.vue`
- Create: `apps/web/app/components/dashboard/DashboardWarnings.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`

**Interfaces:**
- Consumes: `DashboardWarning`, `DashboardBalance`, `FinanceMoney`.
- Produces: `DashboardWarnings` с пропами `warnings: ReadonlyArray<DashboardWarning>`, `accounts: ReadonlyArray<DashboardBalance>`, `envelopes: ReadonlyArray<DashboardBalance>`, `unallocatedIncomeMinor: string`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/dashboard/DashboardWarnings.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardWarnings from './DashboardWarnings.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const accounts = [{ id: 'account-id', name: 'Основная карта', balanceMinor: '-450000' }];
const envelopes = [{ id: 'envelope-id', name: 'Ремонт', balanceMinor: '-120000' }];

const mountWarnings = (props: Record<string, unknown>) =>
  mount(DashboardWarnings, { props, global: { stubs: { NuxtLink: NuxtLinkStub } } });

const normalize = (value: string): string => value.replace(/[   ]/g, ' ');

describe('DashboardWarnings', () => {
  it('renders nothing when there is nothing to warn about', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
    });

    expect(wrapper.find('[data-testid="dashboard-warnings"]').exists()).toBe(false);
  });

  it('names the account behind a warning and links to its section', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ACCOUNT', id: 'account-id', balanceMinor: '-450000' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Основная карта');
    expect(text).toContain('-4 500,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/accounts');
  });

  it('links an envelope warning to the envelopes section', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ENVELOPE', id: 'envelope-id', balanceMinor: '-120000' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
    });

    expect(normalize(wrapper.text())).toContain('Ремонт');
    expect(wrapper.get('a').attributes('href')).toBe('/app/envelopes');
  });

  it('reports unallocated income as its own warning', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '1200000',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Доход не распределён');
    expect(text).toContain('12 000,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/operations');
  });

  it('survives a warning whose subject is missing from the lists', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ACCOUNT', id: 'unknown-id', balanceMinor: '-100' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
    });

    expect(wrapper.text()).toContain('Счёт');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- DashboardWarnings.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

Требования к реализации:

- Корневой элемент `<section data-testid="dashboard-warnings" aria-labelledby="dashboard-warnings-title">` рендерится только если есть хотя бы одно предупреждение или `unallocatedIncomeMinor` больше нуля; иначе компонент возвращает пустоту (`v-if` на корне).
- Заголовок `<h2 id="dashboard-warnings-title">Требует внимания</h2>`.
- Каждая строка: иконка (`TriangleAlert` для отрицательных остатков, `Info` для нераспределённого дохода, обе `aria-hidden="true"`), текст и сумма через `FinanceMoney`, ссылка «Посмотреть» на `/app/accounts`, `/app/envelopes` или `/app/operations`.
- Имя ищется по `id` в переданных списках; если не нашлось — подставляется родовое слово «Счёт» или «Конверт». Не используй прямую индексацию массива: `noUncheckedIndexedAccess` даст `T | undefined`; применяй `accounts.find((item) => item.id === warning.id)?.name ?? 'Счёт'`.
- Смысл строки передаётся текстом, цвет — только усиление.

- [ ] **Step 4: Place it on the dashboard**

В `pages/app/index.vue` вставить `<DashboardWarnings ... />` сразу после `AvailableBudgetCard` и до `UpcomingObligations`, передав `summary.warnings`, `summary.accounts`, `summary.envelopes`, `summary.unallocatedIncomeMinor`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test -- DashboardWarnings.test.ts index.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/dashboard apps/web/app/pages/app/index.vue
git commit -m "feat(web): surface dashboard warnings as their own block"
```

---

### Task 10: Порядок блоков, скелетоны и обновление главной

**Files:**
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes: `AvailableBudgetCard` (Task 8), `DashboardWarnings` (Task 9), `UiSkeleton` (Task 3), существующие `UpcomingObligations` и `BalanceList`.
- Produces: главную в порядке «заголовок → доступная сумма → предупреждения → обязательства → конверты → счета» со скелетонами во время загрузки.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/web/app/pages/app/index.test.ts`:

```ts
  it('orders the dashboard around the available amount', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    const headings = wrapper.findAll('h2').map((heading) => heading.text());
    expect(headings.slice(0, 3)).toEqual(['Можно потратить', 'Ближайшие обязательства', 'Конверты']);
    expect(headings[3]).toBe('Счета');
  });

  it('shows skeletons while the summary is loading', async () => {
    let resolveSummary: (value: typeof summary) => void = () => {};
    api.getDashboardSummary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );

    const wrapper = mount(DashboardPage);
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="dashboard-loading"]').attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('[data-testid="skeleton-item"]').length).toBeGreaterThan(0);

    resolveSummary(summary);
    await flushPromises();

    expect(wrapper.find('[data-testid="dashboard-loading"]').exists()).toBe(false);
  });
```

Первый случай выполняется при пустом `summary.warnings` (как в существующей фикстуре), поэтому блок предупреждений не рендерится и в списке заголовков не появляется.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- index.test.ts`
Expected: FAIL — порядок заголовков другой, скелетонов нет.

- [ ] **Step 3: Rebuild the page body**

Разметка внутри страницы:

```vue
<div v-if="loading" data-testid="dashboard-loading" aria-busy="true" class="dashboard__loading">
  <UiSkeleton variant="card" />
  <UiSkeleton variant="row" :count="3" />
  <UiSkeleton variant="card" :count="2" />
</div>

<template v-else-if="summary">
  <AvailableBudgetCard :period-limit="summary.periodLimit" :period="summary.period" />
  <DashboardWarnings
    :warnings="summary.warnings"
    :accounts="summary.accounts"
    :envelopes="summary.envelopes"
    :unallocated-income-minor="summary.unallocatedIncomeMinor"
  />
  <UpcomingObligations :items="summary.upcomingObligations" />
  <BalanceList title="Конверты" :items="summary.envelopes" :warnings="summary.warnings" subject="ENVELOPE" />
  <BalanceList title="Счета" :items="summary.accounts" :warnings="summary.warnings" subject="ACCOUNT" />
</template>
```

Конверты идут раньше счетов: по контракту главный вопрос — назначение денег, а не их местонахождение. На ширине от 1024px конверты и счета встают в две колонки (`grid-template-columns: repeat(2, minmax(0, 1fr))`), остальные блоки занимают всю ширину.

Заголовок страницы: приветствие, под ним цикл датами (`summary.cycle.start` – `summary.cycle.end` в формате `ДД.ММ`), справа иконочная кнопка обновления с `aria-label="Обновить данные"`, вызывающая существующую `load()`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test -- index.test.ts`
Expected: PASS — включая два существующих случая.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
git add apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): reorder the dashboard and show skeletons while it loads"
```

---

### Task 11: Тост после сохранения на существующих страницах

**Files:**
- Modify: `apps/web/app/pages/app/accounts.vue`
- Modify: `apps/web/app/pages/app/envelopes.vue`
- Modify: `apps/web/app/pages/app/categories.vue`
- Modify: `apps/web/app/pages/app/accounts.test.ts`

**Interfaces:**
- Consumes: `useToast()` (Task 1).
- Produces: ничего для последующих задач.

Три справочные страницы сегодня показывают результат инлайновой строкой (`summary.value = 'Счёт создан.'`). Строка остаётся — она полезна рядом с формой, — но теперь то же сообщение уходит и в тост, чтобы результат был виден, если пользователь уже проскроллил страницу.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/web/app/pages/app/accounts.test.ts`:

```ts
  it('announces a created account through a toast', async () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-action="create-account"]').trigger('click');
    await wrapper.get('#account-name').setValue('Новый счёт');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(useToast().toasts.value.at(-1)?.title).toBe('Счёт создан');
  });
```

с импортом `import { useToast } from '../../composables/useToast.js';` и `useToast().clear();` в существующем `beforeEach`. Перед написанием проверь фактические селекторы формы в `accounts.vue` — приведённые здесь взяты из текущей разметки, но если они разошлись, используй настоящие и отметь это в отчёте.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- accounts.test.ts`
Expected: FAIL — очередь тостов пуста.

- [ ] **Step 3: Push toasts from the three pages**

В каждой из трёх страниц рядом с присваиванием инлайнового сообщения добавить `push({ tone: 'success', title: '…' })`, взяв `const { push } = useToast();` в `<script setup>`. Тексты без точки в конце: «Счёт создан», «Счёт обновлён», «Конверт создан», «Конверт обновлён», «Категория создана», «Категория обновлена». Для ошибок сохранения — `push({ tone: 'error', title: 'Не удалось сохранить', description: <текст ошибки с сервера> })`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/pages/app
git commit -m "feat(web): announce reference-data changes with toasts"
```

---

### Task 12: Визуальное обновление оболочки

**Files:**
- Modify: `apps/web/app/components/app/AppSidebar.vue`
- Modify: `apps/web/app/components/app/AppSidebarSection.vue`
- Modify: `apps/web/app/components/app/AppHeader.vue`
- Modify: `apps/web/app/components/app/AppMobileMenu.vue`
- Modify: `apps/web/app/components/app/AppSidebar.test.ts`

**Interfaces:**
- Consumes: токены `--hf-*` и компоненты оболочки из задач 5 и 7.
- Produces: ничего для последующих задач — это визуальный проход.

Оболочка сейчас написана под старую палитру: активный пункт почти не выделен, вертикальный ритм задан вручную, сенсорные цели меньше 44 px. Задача приводит её к новому киту, не меняя разметку навигации и не трогая набор разделов.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/web/app/components/app/AppSidebar.test.ts` (файл существует — дописывай в него, не перезаписывай):

```ts
  it('marks the active section for assistive technology, not only with colour', () => {
    const wrapper = mount(AppSidebar, {
      global: {
        stubs: {
          NuxtLink: {
            props: { to: { type: String, required: true } },
            template: '<a :href="to" :class="to === \'/app\' ? \'router-link-active\' : \'\'"><slot /></a>',
          },
        },
      },
    });

    const active = wrapper.get('a[href="/app"]');
    expect(active.attributes('aria-current')).toBe('page');
  });
```

Если существующие случаи в файле монтируют `AppSidebar` иначе, повтори их способ монтирования — важно лишь, чтобы новый случай проверял `aria-current`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- AppSidebar.test.ts`
Expected: FAIL — атрибута `aria-current` нет.

- [ ] **Step 3: Rework the shell styles**

- В `AppSidebar.vue` навесить на пункты `:aria-current="isActive ? 'page' : undefined"` через `useRoute().path`; активный пункт получает фон `var(--hf-color-brand-soft)`, цвет `var(--hf-color-brand)` и вес `var(--hf-font-weight-semibold)`.
- Высота каждого пункта — не меньше `2.75rem`, горизонтальный отступ `var(--hf-space-3)`, радиус `var(--hf-radius-md)`, расстояние между пунктами `var(--hf-space-1)`.
- Заголовки групп в `AppSidebarSection.vue` — `var(--hf-font-size-caption)`, `var(--hf-color-text-muted)`, `letter-spacing: 0.08em`, `text-transform: uppercase`.
- В `AppHeader.vue` заменить хардкод тени `0 1px 2px rgb(13 27 42 / 4%)` на `var(--hf-shadow-xs)`; высота контейнера — `4.5rem`, отступы — `var(--hf-space-4) var(--hf-space-5)`.
- В `AppMobileMenu.vue` привести пункты к тем же размерам и активному состоянию, что и в сайдбаре.
- Проверить: после правок `pnpm --filter @harmofin/web test -- tokens.test.ts` остаётся зелёным, то есть ни один новый `var(--hf-color-…)` не остался неопределённым.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/app
git commit -m "feat(web): restyle the app shell on the new design tokens"
```

---

### Task 13: E2E и финальная проверка

**Files:**
- Create: `e2e/app-shell.spec.ts`
- Modify: `apps/web/app/layouts/app.vue` (только если проход по ширинам выявит переполнение)

**Interfaces:**
- Consumes: всю оболочку и главную из задач 1–12.
- Produces: e2e-покрытие глобального добавления операции, тоста и порядка блоков на мобильной ширине.

- [ ] **Step 1: Write the e2e spec**

Создать `e2e/app-shell.spec.ts`. Регистрацию и базовый шаблон повторить по образцу `e2e/stage-3b.spec.ts` (там есть готовые `registerAndReachApp` и `initializeTemplate` — скопируй их в новый файл, спеки в этом проекте не делят общий helper-модуль).

Сценарии:

```ts
test('adds an operation from a page other than the dashboard', async ({ page }) => {
  await registerAndReachApp(page, 'shell');
  await initializeTemplate(page);

  await page.goto('/app/operations');
  await page.getByTestId('add-menu-trigger').click();
  await page.getByTestId('add-menu-expense').click();

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('shows a toast after a reference record is created', async ({ page }) => {
  await registerAndReachApp(page, 'toast');
  await initializeTemplate(page);

  await page.goto('/app/accounts');
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Карта для тоста');
  await page.getByLabel('Начальный баланс').fill('1 000,00');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
});

test('keeps the dashboard order and bottom navigation on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndReachApp(page, 'phone');
  await initializeTemplate(page);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Можно потратить' })).toBeVisible();
  await expect(page.getByTestId('bottom-nav-add')).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement;
    return root ? root.scrollWidth - root.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Run the full local gate**

```bash
pnpm format:check
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
```

Expected: всё зелёное. Playwright локально не запускать — он идёт в CI.

- [ ] **Step 3: Walk the widths in a browser**

Открыть `pnpm dev` и проверить `/app` и `/app/operations` на 320, 390, 768, 1024, 1280 и 1440: нет горизонтального переполнения, нижняя навигация видна только ниже 1024px, кнопка «+ Добавить» доступна на каждой ширине (в шапке или в сайдбаре), нижняя панель не перекрывает последний блок. Найденные проблемы чинить в CSS соответствующего компонента.

- [ ] **Step 4: Walk the keyboard**

На ширине 1440 пройти `Tab` по оболочке: кнопка «+ Добавить» открывается с клавиатуры, пункты меню достижимы, `Escape` закрывает меню, тост закрывается с клавиатуры, фокус нигде не теряется.

- [ ] **Step 5: Commit**

```bash
git add e2e/app-shell.spec.ts apps/web/app
git commit -m "test(e2e): cover the global add menu, toasts and the mobile dashboard"
```

---

## Проверка покрытия спека

| Раздел спека | Где реализован |
| --- | --- |
| `UiToast` + `useToast()`, очередь, автоскрытие, `role="status"`, осмысленный текст | Task 1, Task 2, Task 11 |
| `UiSkeleton` с вариантами и `prefers-reduced-motion` | Task 3, использован в Task 10 |
| Кнопка «+ Добавить» на всех экранах | Task 4, Task 5 |
| Диалоги переезжают в layout, `QuickActionBar` убирается, «Обновить» в заголовке | Task 6, Task 10 |
| Нижняя навигация с центральной «+» и «Ещё» | Task 7 |
| Оболочка на новом ките: ритм, типографика, активный пункт, цели 44 px | Task 12 |
| `AvailableBudgetCard` с состояниями и доступным прогрессом | Task 8 |
| `DashboardWarnings` с именами по `id` и ссылками | Task 9 |
| Порядок блоков главной, скелетоны загрузки, ошибка с «Повторить» | Task 10 (ошибка и «Повторить» уже есть на странице и покрыты существующим тестом) |
| Тесты: юнит на примитивы, состояния карточки, оболочку; e2e на тост, глобальное добавление, мобильную главную | Task 1–13 |
| Не трогаем backend, не вводим Pinia, не переименовываем маршруты | Соблюдено во всех задачах |

Блок «Последние операции» спек явно отложил до этапа переоформления журнала — в плане его нет намеренно.
