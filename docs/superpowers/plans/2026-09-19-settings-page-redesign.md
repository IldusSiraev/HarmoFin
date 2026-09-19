# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/settings` as a card-based hub (Calm Fintech style) with dedicated sub-pages for password/sessions/general settings, a searchable timezone field, a financial-cycle preview, and removal of the income-allocation-rule UI.

**Architecture:** `/app/settings` becomes a read-mostly hub page (`UiCard` + `UiListRow` rows linking to sub-routes) plus one inline form (financial cycle, with a new `CyclePreview` component). Three new sibling pages (`general.vue`, `password.vue`, `sessions.vue`) carry the actual forms, reusing the existing `ReferencePageLayout`/`UiInput`/`UiSelect`/`UiButton` components and the `PATCH /budgets/:id`, `POST auth/password`, `GET/DELETE auth/sessions` endpoints, all of which already exist. `UiSelect` gains a `searchable` mode for the timezone field. No backend changes.

**Tech Stack:** Nuxt 4 / Vue 3 (`<script setup lang="ts">`), Vitest + `@vue/test-utils` for unit tests, Playwright for e2e, existing `apps/web/app/composables/useApiClient.ts` HTTP client.

**Spec:** [docs/superpowers/specs/2026-09-19-settings-page-redesign-design.md](../specs/2026-09-19-settings-page-redesign-design.md)

## Global Constraints

- Write user-facing UI text in Russian; code identifiers in English (CLAUDE.md).
- Never put authentication tokens in `localStorage`; sessions stay HttpOnly-cookie-based (CLAUDE.md) — none of these tasks touch storage, only existing cookie-based endpoints.
- Controllers/composables must not fabricate endpoints — every call in this plan targets an endpoint that already exists (`PATCH /api/v1/budgets/:id`, `POST /api/v1/auth/password`, `GET/DELETE /api/v1/auth/sessions[/:id]`, `POST /api/v1/budgets/:id/reference-template`).
- Financial correctness: do not change `cycleStartDay`/`periodBoundaryOffset` validation or semantics (spec "Не-цели").
- Keep `UiTooltip`/info-icon pattern (`aria-describedby`, hover + focus, Escape closes) for every new tooltip, matching the existing `UiInput`/`UiSelect` implementation.
- Every new page: `definePageMeta({ middleware: 'auth', layout: 'app' })`.
- Follow existing repo conventions: relative imports with `.js` extension for composables/types, `defineOptions({ name: ... })` on every SFC, scoped styles using `--hf-*` design tokens only (no new hard-coded colors).

---

## Task 1: Searchable mode for `UiSelect`

**Files:**
- Modify: `apps/web/app/components/ui/Select.vue`
- Test: `apps/web/app/components/ui/Select.test.ts`

**Interfaces:**
- Produces: `UiSelect` gains prop `searchable?: boolean` (default `false`). When `true`, renders an accessible combobox (text input + `role="listbox"` popup) instead of a native `<select>`, filtering `options` by case-insensitive label substring, and still emits `update:modelValue` with the option's `value` (unchanged event contract). All other existing props/emits (`modelValue`, `options`, `label`, `hint`, `error`, `tooltip`, `required`, `disabled`, `blur` emit) behave identically to today.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/components/ui/Select.test.ts` currently ends with a single `describe('UiSelect', ...)` block using `import { mount } from '@vue/test-utils';`, `import { describe, expect, it } from 'vitest';` and `import UiSelect from './Select.vue';`. Append a second top-level `describe` block after the existing one, reusing those same imports (no new imports needed):

```ts
describe('searchable mode', () => {
  const options = [
    { value: 'Europe/Moscow', label: 'Europe/Moscow' },
    { value: 'Europe/Paris', label: 'Europe/Paris' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  ];

  function mountSearchable(modelValue = '') {
    return mount(UiSelect, {
      props: { modelValue, name: 'timezone', label: 'Часовой пояс', options, searchable: true },
    });
  }

  it('renders a text combobox instead of a native select', () => {
    const wrapper = mountSearchable();
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.get('input[role="combobox"]').exists()).toBe(true);
  });

  it('filters options by label substring on input', async () => {
    const wrapper = mountSearchable();
    await wrapper.get('input[role="combobox"]').setValue('par');
    const optionTexts = wrapper.findAll('[role="option"]').map((node) => node.text());
    expect(optionTexts).toEqual(['Europe/Paris']);
  });

  it('selecting an option emits its value and shows its label', async () => {
    const wrapper = mountSearchable();
    await wrapper.get('input[role="combobox"]').trigger('focus');
    await wrapper.get('[role="option"]').trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Europe/Moscow']);
    await wrapper.setProps({ modelValue: 'Europe/Moscow' });
    expect(wrapper.get('input[role="combobox"]').element.value).toBe('Europe/Moscow');
  });

  it('ArrowDown then Enter selects the first filtered option', async () => {
    const wrapper = mountSearchable();
    const input = wrapper.get('input[role="combobox"]');
    await input.trigger('focus');
    await input.setValue('tok');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Asia/Tokyo']);
  });

  it('Escape closes the popup and reverts the query to the selected label', async () => {
    const wrapper = mountSearchable('Europe/Paris');
    const input = wrapper.get('input[role="combobox"]');
    await input.trigger('focus');
    await input.setValue('xyz');
    await input.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(input.element.value).toBe('Europe/Paris');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- Select.test.ts`
Expected: FAIL — `input[role="combobox"]` not found (component still only renders a native `<select>`).

- [ ] **Step 3: Implement the searchable mode**

Replace the `<script setup>` block of `apps/web/app/components/ui/Select.vue` with (adds imports/state/handlers, keeps every existing function):

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import UiTooltip from './Tooltip.vue';

defineOptions({ name: 'UiSelect' });

type SelectOption = Readonly<{
  value: string;
  label: string;
  disabled?: boolean;
}>;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: ReadonlyArray<SelectOption>;
    id?: string | undefined;
    name: string;
    label: string;
    placeholder?: string | undefined;
    hint?: string | undefined;
    error?: string | undefined;
    tooltip?: string | undefined;
    required?: boolean;
    disabled?: boolean;
    searchable?: boolean;
  }>(),
  {
    id: undefined,
    placeholder: undefined,
    hint: undefined,
    error: undefined,
    tooltip: undefined,
    required: false,
    disabled: false,
    searchable: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
}>();

function getSelectId() {
  return props.id ?? `${props.name}-select`;
}

function getHintId() {
  return `${getSelectId()}-hint`;
}

function getErrorId() {
  return `${getSelectId()}-error`;
}

function getListboxId() {
  return `${getSelectId()}-listbox`;
}

function getDescribedBy() {
  return (
    [props.hint ? getHintId() : undefined, props.error ? getErrorId() : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function handleChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}

// --- searchable combobox ---
function labelFor(value: string): string {
  return props.options.find((option) => option.value === value)?.label ?? '';
}

const query = ref('');
const open = ref(false);
const activeIndex = ref(0);

watch(
  () => props.modelValue,
  (value) => {
    query.value = labelFor(value);
  },
  { immediate: true },
);

const filteredOptions = computed(() => {
  const search = query.value.trim().toLowerCase();
  if (!search || search === labelFor(props.modelValue).toLowerCase()) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(search));
});

function getOptionId(index: number) {
  return `${getListboxId()}-option-${index}`;
}

function openList() {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = 0;
}

function closeList() {
  open.value = false;
  query.value = labelFor(props.modelValue);
}

function selectOption(option: SelectOption) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  query.value = option.label;
  open.value = false;
}

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  activeIndex.value = 0;
}

function handleComboKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      openList();
      return;
    }
    activeIndex.value = Math.min(activeIndex.value + 1, filteredOptions.value.length - 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === 'Enter') {
    const option = filteredOptions.value[activeIndex.value];
    if (open.value && option) {
      event.preventDefault();
      selectOption(option);
    }
  } else if (event.key === 'Escape') {
    closeList();
  }
}

function handleComboBlur(event: FocusEvent) {
  closeList();
  emit('blur', event);
}
</script>
```

Replace the `<template>` block with:

```vue
<template>
  <div class="ui-select">
    <div class="ui-select__label-row">
      <label class="ui-select__label" :for="getSelectId()">
        {{ label }}<span v-if="required" aria-hidden="true"> *</span>
      </label>
      <UiTooltip v-if="tooltip" :text="tooltip" v-slot="{ describedby }">
        <button
          type="button"
          class="ui-select__tooltip-trigger"
          aria-label="Подсказка"
          :aria-describedby="describedby"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5" />
            <path d="M8 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
          </svg>
        </button>
      </UiTooltip>
    </div>

    <div v-if="searchable" class="ui-select__combobox">
      <input
        :id="getSelectId()"
        class="ui-select__control"
        :class="{ 'ui-select__control--error': error }"
        type="text"
        role="combobox"
        autocomplete="off"
        :name="name"
        :value="query"
        :placeholder="placeholder"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="getListboxId()"
        :aria-activedescendant="open && filteredOptions[activeIndex] ? getOptionId(activeIndex) : undefined"
        :aria-describedby="getDescribedBy()"
        :aria-invalid="error ? 'true' : undefined"
        :aria-required="required || undefined"
        :disabled="disabled"
        @focus="openList"
        @input="handleQueryInput"
        @keydown="handleComboKeydown"
        @blur="handleComboBlur"
      />
      <ul v-if="open" :id="getListboxId()" class="ui-select__listbox" role="listbox">
        <li
          v-for="(option, index) in filteredOptions"
          :id="getOptionId(index)"
          :key="option.value"
          role="option"
          class="ui-select__option"
          :class="{ 'ui-select__option--active': index === activeIndex }"
          :aria-selected="option.value === modelValue"
          @mousedown.prevent="selectOption(option)"
        >
          {{ option.label }}
        </li>
        <li v-if="filteredOptions.length === 0" class="ui-select__option ui-select__option--empty">
          Ничего не найдено
        </li>
      </ul>
    </div>
    <select
      v-else
      :id="getSelectId()"
      class="ui-select__control"
      :class="{ 'ui-select__control--error': error }"
      :value="modelValue"
      :name="name"
      :aria-describedby="getDescribedBy()"
      :aria-invalid="error ? 'true' : undefined"
      :aria-required="required || undefined"
      :required="required"
      :disabled="disabled"
      @change="handleChange"
      @blur="emit('blur', $event)"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>

    <p v-if="hint" :id="getHintId()" class="ui-select__hint">{{ hint }}</p>
    <p v-if="error" :id="getErrorId()" class="ui-select__error">{{ error }}</p>
  </div>
</template>
```

Add to the `<style scoped>` block (append, keep everything already there):

```css
.ui-select__combobox {
  position: relative;
}

.ui-select__listbox {
  position: absolute;
  z-index: var(--hf-z-index-tooltip);
  width: 100%;
  max-height: 16rem;
  margin: var(--hf-space-1) 0 0;
  padding: var(--hf-space-1);
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.ui-select__option {
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-sm);
  cursor: pointer;
}

.ui-select__option--active {
  background: var(--hf-color-action-secondary-hover);
}

.ui-select__option--empty {
  color: var(--hf-color-text-muted);
  cursor: default;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- Select.test.ts`
Expected: PASS (all existing native-`<select>` tests plus the 5 new searchable tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/ui/Select.vue apps/web/app/components/ui/Select.test.ts
git commit -m "feat(web): add searchable mode to UiSelect"
```

---

## Task 2: `CyclePreview` component

**Files:**
- Create: `apps/web/app/components/settings/CyclePreview.vue`
- Test: `apps/web/app/components/settings/CyclePreview.test.ts`

**Interfaces:**
- Consumes: nothing (pure presentational component).
- Produces: `CyclePreview` component, props `{ cycleStartDay: number; periodBoundaryOffset: number }`, no emits. Used by Task 4's `settings.vue`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/settings/CyclePreview.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CyclePreview from './CyclePreview.vue';

describe('CyclePreview', () => {
  it('labels both segments with the computed boundary day', () => {
    const wrapper = mount(CyclePreview, {
      props: { cycleStartDay: 10, periodBoundaryOffset: 15 },
    });
    const text = wrapper.text();
    expect(text).toContain('10–25');
    expect(text).toContain('25–10');
  });

  it('does not clamp the boundary day back into the calendar month', () => {
    const wrapper = mount(CyclePreview, {
      props: { cycleStartDay: 25, periodBoundaryOffset: 15 },
    });
    const text = wrapper.text();
    expect(text).toContain('25–40');
    expect(text).toContain('40–25');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- CyclePreview.test.ts`
Expected: FAIL — cannot find module `./CyclePreview.vue`.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/components/settings/CyclePreview.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SettingsCyclePreview' });

const props = defineProps<{
  cycleStartDay: number;
  periodBoundaryOffset: number;
}>();

const secondPeriodStart = computed(() => props.cycleStartDay + props.periodBoundaryOffset);

// Purely illustrative proportions against a 28-day reference month — not used
// for any date math, so a boundary past day 28 just clamps the bar's width,
// it never distorts the printed day numbers.
const firstSegmentPercent = computed(() =>
  Math.min(Math.max((props.periodBoundaryOffset / 28) * 100, 8), 92),
);
const secondSegmentPercent = computed(() => 100 - firstSegmentPercent.value);

const firstLabel = computed(() => `${props.cycleStartDay}–${secondPeriodStart.value}`);
const secondLabel = computed(() => `${secondPeriodStart.value}–${props.cycleStartDay}`);
const summaryLabel = computed(
  () => `Пример разбивки: первый период ${firstLabel.value}, второй период ${secondLabel.value}.`,
);
</script>

<template>
  <div class="cycle-preview">
    <p class="cycle-preview__caption">Пример разбивки</p>
    <div class="cycle-preview__track" role="img" :aria-label="summaryLabel">
      <div
        class="cycle-preview__segment cycle-preview__segment--first"
        :style="{ width: `${firstSegmentPercent}%` }"
      >
        {{ firstLabel }}
      </div>
      <div
        class="cycle-preview__segment cycle-preview__segment--second"
        :style="{ width: `${secondSegmentPercent}%` }"
      >
        {{ secondLabel }}
      </div>
    </div>
    <div class="cycle-preview__labels" aria-hidden="true">
      <span>первый период</span>
      <span>второй период</span>
    </div>
  </div>
</template>

<style scoped>
.cycle-preview {
  display: grid;
  gap: var(--hf-space-2);
}

.cycle-preview__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.cycle-preview__track {
  display: flex;
  overflow: hidden;
  border-radius: var(--hf-radius-md);
}

.cycle-preview__segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0 var(--hf-space-2);
  color: var(--hf-color-white);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
}

.cycle-preview__segment--first {
  background: var(--hf-color-brand);
}

.cycle-preview__segment--second {
  background: var(--hf-color-brand-bright);
}

.cycle-preview__labels {
  display: flex;
  justify-content: space-between;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- CyclePreview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/settings/CyclePreview.vue apps/web/app/components/settings/CyclePreview.test.ts
git commit -m "feat(web): add financial cycle preview component"
```

---

## Task 3: `useAuth` — password change and session management

**Files:**
- Modify: `apps/web/app/composables/useAuth.ts`
- Test: `apps/web/app/composables/useAuth.test.ts` (new file)

**Interfaces:**
- Consumes: `useApiClient()` (`request<T>(path, options)`), already imported in `useAuth.ts`.
- Produces:
  - `export type SessionView = { id: string; createdAt: string; lastSeenAt: string; idleExpiresAt: string; absoluteExpiresAt: string; userAgent: string | null }`
  - `useAuth()` return object gains: `changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>`, `listSessions(): Promise<SessionView[]>`, `revokeSession(sessionId: string): Promise<void>`, `revokeAllSessions(): Promise<void>`.
  - Used by Task 6 (`password.vue`) and Task 7 (`sessions.vue`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/composables/useAuth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), requestBlob: vi.fn() }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

import { useAuth } from './useAuth.js';

describe('useAuth session and password management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('changePassword posts current and new password', async () => {
    mocks.request.mockResolvedValue({});
    const { changePassword } = useAuth();
    await changePassword({ currentPassword: 'old-password', newPassword: 'new-password-10' });
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/auth/password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password-10' }),
      }),
    );
  });

  it('listSessions requests the sessions list', async () => {
    mocks.request.mockResolvedValue([{ id: 'session-1' }]);
    const { listSessions } = useAuth();
    const result = await listSessions();
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions');
    expect(result).toEqual([{ id: 'session-1' }]);
  });

  it('revokeSession deletes a single session by id', async () => {
    mocks.request.mockResolvedValue(undefined);
    const { revokeSession } = useAuth();
    await revokeSession('session-1');
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions/session-1', { method: 'DELETE' });
  });

  it('revokeAllSessions deletes every session', async () => {
    mocks.request.mockResolvedValue(undefined);
    const { revokeAllSessions } = useAuth();
    await revokeAllSessions();
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions', { method: 'DELETE' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- useAuth.test.ts`
Expected: FAIL — `changePassword`/`listSessions`/`revokeSession`/`revokeAllSessions` are not functions (not yet added to `useAuth`'s return object).

- [ ] **Step 3: Implement the methods**

In `apps/web/app/composables/useAuth.ts`, add after the existing `type MeResponse` block:

```ts
export type SessionView = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  userAgent: string | null;
};
```

Inside `useAuth()`, after the existing `logout` function and before the `return` statement, add:

```ts
  async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    await api.request('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function listSessions(): Promise<SessionView[]> {
    return api.request<SessionView[]>('/api/v1/auth/sessions');
  }

  async function revokeSession(sessionId: string): Promise<void> {
    await api.request(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  async function revokeAllSessions(): Promise<void> {
    await api.request('/api/v1/auth/sessions', { method: 'DELETE' });
  }
```

Add the four new functions to the `return { ... }` object at the end of `useAuth()`:

```ts
  return {
    currentUser,
    currentData,
    loadMe,
    register,
    login,
    requestRecovery,
    confirmRecovery,
    logout,
    changePassword,
    listSessions,
    revokeSession,
    revokeAllSessions,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- useAuth.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/composables/useAuth.ts apps/web/app/composables/useAuth.test.ts
git commit -m "feat(web): add password change and session management to useAuth"
```

---

## Task 4: Rebuild `/app/settings` as a card hub

**Files:**
- Modify: `apps/web/app/pages/app/settings.vue`
- Modify: `apps/web/app/pages/app/settings.test.ts`

**Interfaces:**
- Consumes: `useAuth()` (`currentData`, `loadMe`), `useBudgetReferenceData()` (`getBudget`, `updateBudget`, `initializeTemplate`), `useReferenceDataForm()`, `CyclePreview` (Task 2), `ReferencePageLayout`, `UiCard`, `UiButton`, `UiInput`, `UiStatus`, `UiEmptyState`, Nuxt's `NuxtLink` (implicit global component).
- Produces: hub page with a "Бюджет" card (rows: "Общие настройки" → real link to `/app/settings/general`, "Базовый шаблон" action button), an "Аккаунт" card (rows: Email display, "Пароль" → real link to `/app/settings/password`, "Сессии" → real link to `/app/settings/sessions`), and a "Финансовый цикл" card with its own inline form (`cycleStartDay`, `periodBoundaryOffset`, `CyclePreview`, save button). No income-allocation-rule UI.

Navigable rows use real `<NuxtLink>` anchors (not a button that calls `navigateTo` programmatically) — this is a `<button>`-based row would break middle-click, "open in new tab" and native link semantics for what is, functionally, a page transition. `UiListRow` is not used on this page for that reason: it always renders its default slot inside a `<button>`.

- [ ] **Step 1: Replace the page test**

Read the current `apps/web/app/pages/app/settings.test.ts` first (mock shape for `useAuth`/`useBudgetReferenceData`), then replace its entire contents with:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const mocks = vi.hoisted(() => {
  return {
    auth: {
      currentData: { value: null as unknown },
      loadMe: vi.fn(),
    },
    api: {
      getBudget: vi.fn(),
      updateBudget: vi.fn(),
      initializeTemplate: vi.fn(),
    },
  };
});

vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import SettingsPage from './settings.vue';

const budget = {
  id: 'budget-id',
  workspaceId: 'workspace-id',
  name: 'Семейный бюджет',
  primaryCurrency: 'RUB',
  timezone: 'Europe/Moscow',
  cycleStartDay: 10,
  periodBoundaryOffset: 15,
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: null,
  incomeAllocationTargetEnvelopeId: null,
  status: 'ACTIVE' as const,
};

function mountPage() {
  return mount(SettingsPage, {
    global: {
      // The default NuxtLink auto-stub drops `to`, so href-based assertions
      // below need it forwarded explicitly.
      stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
    },
  });
}

describe('settings hub page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Семейный бюджет', primaryCurrency: 'RUB' }],
        },
      ],
    };
    mocks.auth.loadMe.mockResolvedValue(mocks.auth.currentData.value);
    mocks.api.getBudget.mockResolvedValue(budget);
  });

  it('shows the three cards with links to the sub-pages and the account email', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Бюджет');
    expect(wrapper.text()).toContain('Аккаунт');
    expect(wrapper.text()).toContain('Финансовый цикл');
    expect(wrapper.text()).toContain('owner@example.test');
    expect(wrapper.get('a[href="/app/settings/general"]').exists()).toBe(true);
    expect(wrapper.get('a[href="/app/settings/password"]').exists()).toBe(true);
    expect(wrapper.get('a[href="/app/settings/sessions"]').exists()).toBe(true);
  });

  it('does not show the income allocation rule anywhere on the page', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('распределение дохода');
    expect(wrapper.find('[name="incomeAllocationSourceCategoryId"]').exists()).toBe(false);
  });

  it('saves the financial cycle fields independently and refreshes them', async () => {
    mocks.api.updateBudget.mockResolvedValue({ ...budget, cycleStartDay: 5, periodBoundaryOffset: 20 });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[name="cycleStartDay"]').setValue('5');
    await wrapper.get('[name="periodBoundaryOffset"]').setValue('20');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.api.updateBudget).toHaveBeenCalledWith('budget-id', {
      cycleStartDay: 5,
      periodBoundaryOffset: 20,
    });
    expect(wrapper.text()).toContain('Финансовый цикл сохранён.');
  });

  it('shows a validation error beside the matching cycle field', async () => {
    mocks.api.updateBudget.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'cycleStartDay', message: 'Некорректное число.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Некорректное число.');
    expect(wrapper.get('[name="cycleStartDay"]').attributes('aria-invalid')).toBe('true');
  });

  it('disables the template action while pending and shows the result', async () => {
    let completeRequest: (() => void) | undefined;
    mocks.api.initializeTemplate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeRequest = resolve;
        }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const button = wrapper.get('[data-action="initialize-template"]');
    await button.trigger('click');
    expect(button.attributes('disabled')).toBeDefined();
    completeRequest?.();
    await flushPromises();

    expect(wrapper.text()).toContain('Базовый шаблон создан.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings.test.ts`
Expected: FAIL (current `settings.vue` still renders the old single-form layout with the income rule fields and no sub-page links).

- [ ] **Step 3: Rewrite the page**

Replace the entire contents of `apps/web/app/pages/app/settings.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import CyclePreview from '../../components/settings/CyclePreview.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiCard from '../../components/ui/Card.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type BudgetDto,
  type UpdateBudgetInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppSettingsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const cycleFields = ['cycleStartDay', 'periodBoundaryOffset'] as const;

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(cycleFields);

const loading = ref(true);
const loadError = ref('');
const budget = ref<BudgetDto | null>(null);

const cycleSaving = ref(false);
const cycleSummary = ref('');
const cycleFieldErrors = ref<Partial<Record<(typeof cycleFields)[number], string>>>({});
const cycleForm = reactive({ cycleStartDay: '', periodBoundaryOffset: '' });

const templateSaving = ref(false);
const templateSummary = ref('');

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
const previewCycleStartDay = computed(() => Number(cycleForm.cycleStartDay) || 0);
const previewPeriodBoundaryOffset = computed(() => Number(cycleForm.periodBoundaryOffset) || 0);

function syncCycleForm(nextBudget: BudgetDto) {
  cycleForm.cycleStartDay = String(nextBudget.cycleStartDay);
  cycleForm.periodBoundaryOffset = String(nextBudget.periodBoundaryOffset);
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (!id) return;
    budget.value = await api.getBudget(id);
    syncCycleForm(budget.value);
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getCycleFieldError(field: (typeof cycleFields)[number]) {
  return cycleFieldErrors.value[field];
}

async function saveCycle() {
  const id = budgetId.value;
  if (!id) return;
  cycleSaving.value = true;
  cycleSummary.value = '';
  cycleFieldErrors.value = {};
  const input: UpdateBudgetInput = {
    cycleStartDay: Number(cycleForm.cycleStartDay),
    periodBoundaryOffset: Number(cycleForm.periodBoundaryOffset),
  };
  try {
    budget.value = await api.updateBudget(id, input);
    syncCycleForm(budget.value);
    cycleSummary.value = 'Финансовый цикл сохранён.';
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    cycleFieldErrors.value = mapped.fields;
    cycleSummary.value = mapped.summary;
  } finally {
    cycleSaving.value = false;
  }
}

async function initializeTemplate() {
  const id = budgetId.value;
  if (!id) return;
  templateSaving.value = true;
  templateSummary.value = '';
  try {
    await api.initializeTemplate(id);
    templateSummary.value = 'Базовый шаблон создан.';
  } catch {
    templateSummary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    templateSaving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <template v-if="loading">
    <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
  </template>
  <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
    <template #action>
      <UiButton @click="loadPage">Повторить</UiButton>
    </template>
  </UiEmptyState>
  <UiEmptyState
    v-else-if="!budgetId"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Настройки</template>
    <template #content>
      <div class="settings-page__grid">
        <div class="settings-page__column">
          <UiCard as="section" aria-labelledby="settings-budget-title">
            <template #header><h2 id="settings-budget-title">Бюджет</h2></template>
            <NuxtLink to="/app/settings/general" class="settings-page__row">
              <span>Общие настройки</span>
              <span class="settings-page__row-link">Изменить →</span>
            </NuxtLink>
            <div class="settings-page__static-row">
              <div>
                <p class="settings-page__static-row-title">Базовый шаблон</p>
                <p class="settings-page__hint">Создаёт отсутствующие категории и конверты.</p>
              </div>
              <UiButton
                variant="tertiary"
                size="sm"
                data-action="initialize-template"
                :loading="templateSaving"
                @click="initializeTemplate"
              >
                Создать базовый шаблон
              </UiButton>
            </div>
            <UiStatus v-if="templateSummary" :label="templateSummary" tone="success" aria-live="polite" />
          </UiCard>

          <UiCard as="section" aria-labelledby="settings-account-title">
            <template #header><h2 id="settings-account-title">Аккаунт</h2></template>
            <div class="settings-page__static-row">
              <p class="settings-page__static-row-title">{{ currentData?.user?.email }}</p>
            </div>
            <NuxtLink to="/app/settings/password" class="settings-page__row">
              <span>Пароль</span>
              <span class="settings-page__row-link">Изменить →</span>
            </NuxtLink>
            <NuxtLink to="/app/settings/sessions" class="settings-page__row">
              <span>Сессии</span>
              <span class="settings-page__row-link">Управлять →</span>
            </NuxtLink>
          </UiCard>
        </div>

        <UiCard as="section" aria-labelledby="settings-cycle-title">
          <template #header><h2 id="settings-cycle-title">Финансовый цикл</h2></template>
          <UiStatus
            v-if="cycleSummary"
            :label="cycleSummary"
            :tone="Object.keys(cycleFieldErrors).length ? 'danger' : 'success'"
            aria-live="polite"
          />
          <form class="settings-page__cycle-form" @submit.prevent="saveCycle">
            <UiInput
              v-model="cycleForm.cycleStartDay"
              name="cycleStartDay"
              label="Начало первого периода"
              tooltip="Финансовый месяц — это ваш период планирования денег между двумя поступлениями. Не обязательно начинается 1-го числа: укажите день, который соответствует вашему графику доходов."
              inputmode="numeric"
              :error="getCycleFieldError('cycleStartDay')"
              required
            />
            <UiInput
              v-model="cycleForm.periodBoundaryOffset"
              name="periodBoundaryOffset"
              label="Граница второго периода (дней от начала первого)"
              tooltip="Финансовый месяц делится на два периода — например, от аванса до зарплаты и от зарплаты до аванса. Здесь указывается, через сколько дней после начала первого периода начинается второй."
              inputmode="numeric"
              :error="getCycleFieldError('periodBoundaryOffset')"
              required
            />
            <CyclePreview
              v-if="previewCycleStartDay && previewPeriodBoundaryOffset"
              :cycle-start-day="previewCycleStartDay"
              :period-boundary-offset="previewPeriodBoundaryOffset"
            />
            <p class="settings-page__cycle-note">
              Изменение цикла не меняет даты операций, но пересчитывает их принадлежность к периодам и
              циклам.
            </p>
            <UiButton type="submit" :loading="cycleSaving">Сохранить</UiButton>
          </form>
        </UiCard>
      </div>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.settings-page__grid {
  display: grid;
  gap: var(--hf-space-5);
  grid-template-columns: 1fr;
  align-items: start;
}

.settings-page__column {
  display: grid;
  gap: var(--hf-space-5);
}

.settings-page__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: var(--hf-color-text);
  text-decoration: none;
}

.settings-page__row:hover {
  background: var(--hf-color-surface-subtle);
}

.settings-page__row-link {
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  white-space: nowrap;
}

.settings-page__static-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
}

.settings-page__static-row-title {
  margin: 0;
  color: var(--hf-color-text);
}

.settings-page__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.settings-page__cycle-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.settings-page__cycle-note {
  margin: 0;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

@media (min-width: 48rem) {
  .settings-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/settings.vue apps/web/app/pages/app/settings.test.ts
git commit -m "feat(web): rebuild settings page as a card hub, drop income allocation rule UI"
```

---

## Task 5: `/app/settings/general` sub-page

**Files:**
- Create: `apps/web/app/pages/app/settings/general.vue`
- Create: `apps/web/app/pages/app/settings/general.test.ts`

**Interfaces:**
- Consumes: `useAuth()`, `useBudgetReferenceData()` (`getBudget`, `updateBudget`), `useReferenceDataForm()`, `UiSelect` with `searchable` (Task 1), `ReferencePageLayout`, `UiInput`, `UiButton`, `UiStatus`, `UiEmptyState`, `UiInfoTooltip`.
- Produces: route `/app/settings/general` with a form for `name`, `timezone` (searchable), `allowNegativeBalance`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/app/settings/general.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => {
  return {
    auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
    api: { getBudget: vi.fn(), updateBudget: vi.fn() },
  };
});

vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import GeneralSettingsPage from './general.vue';

const budget = {
  id: 'budget-id',
  workspaceId: 'workspace-id',
  name: 'Семейный бюджет',
  primaryCurrency: 'RUB',
  timezone: 'Europe/Moscow',
  cycleStartDay: 10,
  periodBoundaryOffset: 15,
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: null,
  incomeAllocationTargetEnvelopeId: null,
  status: 'ACTIVE' as const,
};

function mountPage() {
  return mount(GeneralSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings general page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Семейный бюджет', primaryCurrency: 'RUB' }],
        },
      ],
    };
    mocks.auth.loadMe.mockResolvedValue(mocks.auth.currentData.value);
    mocks.api.getBudget.mockResolvedValue(budget);
  });

  it('saves name, timezone and negative-balance without touching the income rule', async () => {
    mocks.api.updateBudget.mockResolvedValue(budget);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[name="name"]').setValue('Новое имя');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.api.updateBudget).toHaveBeenCalledWith('budget-id', {
      name: 'Новое имя',
      timezone: 'Europe/Moscow',
      allowNegativeBalance: false,
    });
    expect(wrapper.text()).toContain('Общие настройки сохранены.');
  });

  it('shows a field error next to the matching control', async () => {
    mocks.api.updateBudget.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'name', message: 'Укажите название.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Укажите название.');
    expect(wrapper.get('[name="name"]').attributes('aria-invalid')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/general.test.ts`
Expected: FAIL — cannot find module `./general.vue`.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/pages/app/settings/general.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiInfoTooltip from '../../../components/ui/InfoTooltip.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiSelect from '../../../components/ui/Select.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { useAuth } from '../../../composables/useAuth.js';
import {
  type BudgetDto,
  type UpdateBudgetInput,
  useBudgetReferenceData,
} from '../../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppSettingsGeneralPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const generalFields = ['name', 'timezone', 'allowNegativeBalance'] as const;

const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(generalFields);

const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const summary = ref('');
const fieldErrors = ref<Partial<Record<(typeof generalFields)[number], string>>>({});
const budget = ref<BudgetDto | null>(null);
const form = reactive({ name: '', timezone: '', allowNegativeBalance: false });

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);

const timezoneOptions = computed(() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [form.timezone || 'UTC'];
  return zones.map((zone) => ({ value: zone, label: zone }));
});

function syncForm(nextBudget: BudgetDto) {
  form.name = nextBudget.name;
  form.timezone = nextBudget.timezone;
  form.allowNegativeBalance = nextBudget.allowNegativeBalance;
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    const id = budgetId.value;
    if (!id) return;
    budget.value = await api.getBudget(id);
    syncForm(budget.value);
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function getFieldError(field: (typeof generalFields)[number]) {
  return fieldErrors.value[field];
}

async function save() {
  const id = budgetId.value;
  if (!id) return;
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  const input: UpdateBudgetInput = {
    name: form.name,
    timezone: form.timezone,
    allowNegativeBalance: form.allowNegativeBalance,
  };
  try {
    budget.value = await api.updateBudget(id, input);
    syncForm(budget.value);
    summary.value = 'Общие настройки сохранены.';
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <template v-if="loading">
    <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
  </template>
  <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
    <template #action>
      <UiButton @click="loadPage">Повторить</UiButton>
    </template>
  </UiEmptyState>
  <UiEmptyState
    v-else-if="!budget"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Общие настройки</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus
        v-if="summary"
        :label="summary"
        :tone="Object.keys(fieldErrors).length ? 'danger' : 'success'"
        aria-live="polite"
      />
      <form class="general-settings-form" @submit.prevent="save">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название бюджета"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-model="form.timezone"
          name="timezone"
          label="Часовой пояс"
          searchable
          :options="timezoneOptions"
          tooltip="Часовой пояс используется для расчёта границ финансового месяца и определения «сегодня» на дашборде, в отчётах и планах."
          :error="getFieldError('timezone')"
          required
        />
        <label class="general-settings-form__checkbox">
          <input v-model="form.allowNegativeBalance" type="checkbox" />
          <span>Разрешить уходить в минус</span>
          <UiInfoTooltip text="Если выключено, HarmoFin не даст сохранить операцию, которая уведёт счёт или конверт в минус." />
        </label>
        <UiButton type="submit" :loading="saving">Сохранить</UiButton>
      </form>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.general-settings-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.general-settings-form__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.general-settings-form__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/general.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/settings/general.vue apps/web/app/pages/app/settings/general.test.ts
git commit -m "feat(web): add /app/settings/general sub-page"
```

---

## Task 6: `/app/settings/password` sub-page

**Files:**
- Create: `apps/web/app/pages/app/settings/password.vue`
- Create: `apps/web/app/pages/app/settings/password.test.ts`

**Interfaces:**
- Consumes: `useAuth()` (`changePassword`, Task 3), `errorMessage` export from `useAuth.ts`, `ReferencePageLayout`, `UiInput`, `UiButton`, `UiStatus`.
- Produces: route `/app/settings/password`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/app/settings/password.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('../../../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useAuth.js')>(
    '../../../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ changePassword: mocks.changePassword }) };
});

import PasswordSettingsPage from './password.vue';

function mountPage() {
  return mount(PasswordSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings password page', () => {
  it('submits current and new password and shows success', async () => {
    mocks.changePassword.mockResolvedValue(undefined);
    const wrapper = mountPage();

    await wrapper.get('[name="currentPassword"]').setValue('old-password');
    await wrapper.get('[name="newPassword"]').setValue('new-password-10');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password-10',
    });
    expect(wrapper.text()).toContain('Пароль изменён.');
    expect((wrapper.get('[name="currentPassword"]').element as HTMLInputElement).value).toBe('');
  });

  it('shows a field error next to the matching control on failure', async () => {
    mocks.changePassword.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'currentPassword', message: 'Неверный пароль.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();

    await wrapper.get('[name="currentPassword"]').setValue('wrong-password');
    await wrapper.get('[name="newPassword"]').setValue('new-password-10');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Неверный пароль.');
    expect(wrapper.get('[name="currentPassword"]').attributes('aria-invalid')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/password.test.ts`
Expected: FAIL — cannot find module `./password.vue`.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/pages/app/settings/password.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsPasswordPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { changePassword } = useAuth();
const currentPassword = ref('');
const newPassword = ref('');
const saving = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});

async function save() {
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    await changePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value });
    currentPassword.value = '';
    newPassword.value = '';
    summary.value = 'Пароль изменён.';
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Пароль</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus
        v-if="summary"
        :label="summary"
        :tone="Object.keys(fieldErrors).length ? 'danger' : 'success'"
        aria-live="polite"
      />
      <form class="password-settings-form" @submit.prevent="save">
        <UiInput
          v-model="currentPassword"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          label="Текущий пароль"
          :error="fieldErrors.currentPassword"
          required
        />
        <UiInput
          v-model="newPassword"
          name="newPassword"
          type="password"
          autocomplete="new-password"
          label="Новый пароль"
          hint="Минимум 10 символов."
          :error="fieldErrors.newPassword"
          required
        />
        <UiButton type="submit" :loading="saving">Сохранить</UiButton>
      </form>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.password-settings-form {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 28rem;
  margin-top: var(--hf-space-4);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/password.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/settings/password.vue apps/web/app/pages/app/settings/password.test.ts
git commit -m "feat(web): add /app/settings/password sub-page"
```

---

## Task 7: `/app/settings/sessions` sub-page

**Files:**
- Create: `apps/web/app/pages/app/settings/sessions.vue`
- Create: `apps/web/app/pages/app/settings/sessions.test.ts`

**Interfaces:**
- Consumes: `useAuth()` (`loadMe`, `listSessions`, `revokeSession`, `revokeAllSessions`, Task 3), `navigateTo` (`#imports` — the alias the test config stubs; see `apps/web/app/test/nuxt-imports.ts`, which already provides no-op `definePageMeta`/`navigateTo`), `ReferencePageLayout`, `UiButton`, `UiConfirmDialog`, `UiStatus`.
- Produces: route `/app/settings/sessions`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/app/settings/sessions.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadMe: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock('../../../composables/useAuth.js', () => ({
  useAuth: () => ({
    loadMe: mocks.loadMe,
    listSessions: mocks.listSessions,
    revokeSession: mocks.revokeSession,
    revokeAllSessions: mocks.revokeAllSessions,
  }),
}));

// '#imports' is aliased in vitest.config.ts to apps/web/app/test/nuxt-imports.ts,
// which already stubs definePageMeta/navigateTo — override just navigateTo here
// so its calls are inspectable, keeping every other stub from that file intact.
vi.mock('#imports', async () => {
  const actual = await vi.importActual<typeof import('#imports')>('#imports');
  return { ...actual, navigateTo: mocks.navigateTo };
});

import SessionsSettingsPage from './sessions.vue';

const sessions = [
  {
    id: 'session-1',
    createdAt: '2026-09-01T10:00:00.000Z',
    lastSeenAt: '2026-09-19T09:00:00.000Z',
    idleExpiresAt: '2026-09-20T09:00:00.000Z',
    absoluteExpiresAt: '2026-10-01T10:00:00.000Z',
    userAgent: 'Chrome on Windows',
  },
];

function mountPage() {
  return mount(SessionsSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings sessions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockResolvedValue(sessions);
  });

  it('lists sessions with device info', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Chrome on Windows');
  });

  it('revoking a session that is not the current one reloads the list without navigating away', async () => {
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.loadMe.mockResolvedValue({});
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('button[data-action="revoke-session"]').trigger('click');
    await flushPromises();

    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('revoking the current session redirects to login', async () => {
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.loadMe.mockRejectedValue(new Error('unauthorized'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('button[data-action="revoke-session"]').trigger('click');
    await flushPromises();

    expect(mocks.navigateTo).toHaveBeenCalledWith('/login');
  });

  it('confirming "sign out everywhere" revokes all sessions and redirects to login', async () => {
    mocks.revokeAllSessions.mockResolvedValue(undefined);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="revoke-all"]').trigger('click');
    await wrapper.get('[data-confirm]').trigger('click');
    await flushPromises();

    expect(mocks.revokeAllSessions).toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/sessions.test.ts`
Expected: FAIL — cannot find module `./sessions.vue`.

- [ ] **Step 3: Implement the page**

Create `apps/web/app/pages/app/settings/sessions.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { type SessionView, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsSessionsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { loadMe, listSessions, revokeSession, revokeAllSessions } = useAuth();

const sessions = ref<SessionView[]>([]);
const loading = ref(true);
const loadError = ref('');
const revokingId = ref<string | null>(null);
const revokingAll = ref(false);
const confirmingRevokeAll = ref(false);

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

async function loadSessions() {
  loading.value = true;
  loadError.value = '';
  try {
    sessions.value = await listSessions();
  } catch {
    loadError.value = 'Не удалось загрузить список сессий. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

// listSessions() has no way to say which row is this browser's own session
// (the session cookie is HttpOnly), so after revoking one we re-authenticate:
// if that now fails, the row we just revoked was our own.
async function revoke(sessionId: string) {
  revokingId.value = sessionId;
  try {
    await revokeSession(sessionId);
    try {
      await loadMe();
    } catch {
      await navigateTo('/login');
      return;
    }
    await loadSessions();
  } finally {
    revokingId.value = null;
  }
}

async function confirmRevokeAll() {
  revokingAll.value = true;
  try {
    await revokeAllSessions();
    await navigateTo('/login');
  } finally {
    revokingAll.value = false;
    confirmingRevokeAll.value = false;
  }
}

onMounted(() => {
  void loadSessions();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Сессии</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus v-if="loading" label="Загрузка сессий…" tone="info" aria-live="polite" />
      <UiStatus v-else-if="loadError" :label="loadError" tone="danger" aria-live="polite" />
      <template v-else>
        <ul class="sessions-list">
          <li v-for="session in sessions" :key="session.id" class="sessions-list__row">
            <div>
              <p class="sessions-list__device">{{ session.userAgent ?? 'Неизвестное устройство' }}</p>
              <p class="sessions-list__meta">
                Вход: {{ formatDate(session.createdAt) }} · Активность:
                {{ formatDate(session.lastSeenAt) }}
              </p>
            </div>
            <UiButton
              variant="tertiary"
              size="sm"
              data-action="revoke-session"
              :loading="revokingId === session.id"
              @click="revoke(session.id)"
            >
              Завершить
            </UiButton>
          </li>
        </ul>
        <UiButton variant="danger" data-action="revoke-all" @click="confirmingRevokeAll = true">
          Выйти отовсюду
        </UiButton>
      </template>
    </template>
  </ReferencePageLayout>
  <UiConfirmDialog
    :open="confirmingRevokeAll"
    title="Выйти отовсюду?"
    description="Это завершит все сессии, включая текущую — вы будете разлогинены и перенаправлены на страницу входа."
    confirm-label="Выйти отовсюду"
    cancel-label="Отмена"
    variant="danger"
    :loading="revokingAll"
    @confirm="confirmRevokeAll"
    @cancel="confirmingRevokeAll = false"
  />
</template>

<style scoped>
.sessions-list {
  display: grid;
  gap: var(--hf-space-3);
  margin: var(--hf-space-4) 0;
  padding: 0;
  list-style: none;
}

.sessions-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
}

.sessions-list__device {
  margin: 0;
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}

.sessions-list__meta {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- pages/app/settings/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/settings/sessions.vue apps/web/app/pages/app/settings/sessions.test.ts
git commit -m "feat(web): add /app/settings/sessions sub-page"
```

---

## Task 8: Fix e2e specs that configured the income rule through the old settings UI

**Files:**
- Modify: `e2e/stage-3b.spec.ts`
- Modify: `e2e/operations.spec.ts`

**Interfaces:**
- Consumes: `page.evaluate` + in-browser `fetch` against `http://localhost:3001` (existing pattern already used in `e2e/transfers.spec.ts:89-111`).
- Produces: `configureIncomeAllocationRule(page)` keeps the exact same name/signature in both files (call sites unchanged) but no longer depends on the removed settings-page UI.

- [ ] **Step 1: Replace `configureIncomeAllocationRule` in `e2e/stage-3b.spec.ts`**

Replace the existing function (currently lines 193-200):

```ts
async function configureIncomeAllocationRule(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = 'http://localhost:3001/api/v1';
    const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
      response.json(),
    )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
    const budgetId = me.workspaces[0]?.budgets[0]?.id;
    if (!budgetId) throw new Error('Missing budget id');

    const categories = (await fetch(`${api}/budgets/${budgetId}/categories?type=INCOME`, {
      credentials: 'include',
    }).then((response) => response.json())) as Array<{ id: string; name: string }>;
    const envelopes = (await fetch(`${api}/budgets/${budgetId}/envelopes`, {
      credentials: 'include',
    }).then((response) => response.json())) as Array<{ id: string; name: string }>;
    const category = categories.find((item) => item.name === 'Шабашка');
    const envelope = envelopes.find((item) => item.name === 'Свободные');
    if (!category || !envelope) throw new Error('Missing template category or envelope');

    const csrf = (await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
      response.json(),
    )) as { csrfToken: string };
    await fetch(`${api}/budgets/${budgetId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      body: JSON.stringify({
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: category.id,
        incomeAllocationTargetEnvelopeId: envelope.id,
      }),
    });
  });
}
```

- [ ] **Step 2: Apply the identical replacement in `e2e/operations.spec.ts`**

Replace the existing function there (currently lines 222-229) with the same body as Step 1.

- [ ] **Step 3: Run the affected e2e specs**

Run: `pnpm --filter @harmofin/web dev` in one terminal and `pnpm --filter @harmofin/api dev` in another (or rely on Playwright's own `webServer` config), then:

```bash
pnpm test:e2e -- stage-3b.spec.ts operations.spec.ts
```

Expected: PASS — both specs reach the income-allocation-proposal assertions without visiting `/app/settings`'s old form.

- [ ] **Step 4: Run the full unit test suite and the web app's build once more for the whole feature**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web build`
Expected: all PASS — confirms Tasks 1-8 compose cleanly (no dangling import of the removed income-rule fields anywhere, `settings/` route files build correctly alongside `settings.vue`).

- [ ] **Step 5: Commit**

```bash
git add e2e/stage-3b.spec.ts e2e/operations.spec.ts
git commit -m "test(e2e): configure income allocation rule via API instead of the removed settings UI"
```
