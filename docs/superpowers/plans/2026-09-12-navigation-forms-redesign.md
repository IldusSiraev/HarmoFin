# Navigation, Forms & UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-nav with a desktop sidebar (adding the missing "Переводы" entry), move every reference-page create/edit form into a modal, add a compact disclosure filter panel, add optional icon-triggered field/button tooltips, unify page spacing via a shared layout component, and tighten control density on desktop.

**Architecture:** Build small shared UI primitives first (`UiTooltip`, `ReferencePageLayout`, `FilterPanel`, `AppSidebar`), wire the new navigation shell into `app.vue`, then migrate each affected page (`accounts`, `envelopes`, `categories`, `plans`, `transfers`, `operations`, `analytics`) to the new primitives one at a time. No backend, API, or business-logic changes — this is purely `apps/web` presentation layer.

**Tech Stack:** Nuxt 4 / Vue 3 (`<script setup>`, Composition API), Vitest + `@vue/test-utils` for unit tests, existing `tokens.css` design tokens.

**Spec:** [docs/superpowers/specs/2026-09-12-navigation-forms-redesign-design.md](../specs/2026-09-12-navigation-forms-redesign-design.md)

## Global Constraints

- UI text and copy: Russian. Code identifiers, CSS class names, file names: English.
- Every interactive control keeps a visible focus indicator and keyboard operability (Tab/Shift+Tab/Enter/Escape); nothing relies on hover alone to convey information.
- Touch targets stay ≥44px on mobile/tablet (<1024px); desktop (≥1024px) may use the new denser control heights defined in Task 17.
- No changes to Prisma, API contracts, financial calculations, or auth — this plan only touches `apps/web/app`.
- Run `pnpm --filter @harmofin/web lint`, `pnpm --filter @harmofin/web typecheck`, and the relevant Vitest files after each task; fix before moving on.
- Do not fabricate commands — only the ones already verified in the repo (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @harmofin/web vitest run <path>`) are used below.

---

## File Structure

New files:

```
apps/web/app/components/ui/Tooltip.vue
apps/web/app/components/ui/Tooltip.test.ts
apps/web/app/components/ui/ReferencePageLayout.vue
apps/web/app/components/ui/ReferencePageLayout.test.ts
apps/web/app/components/ui/FilterPanel.vue
apps/web/app/components/ui/FilterPanel.test.ts
apps/web/app/components/ui/Select.test.ts
apps/web/app/components/ui/Modal.test.ts
apps/web/app/components/app/AppSidebar.vue
apps/web/app/components/app/AppSidebar.test.ts
apps/web/app/components/app/AppSidebarSection.vue
```

Modified files (by task): `Input.vue`, `Select.vue`, `Button.vue`, `Modal.vue`, `AppHeader.vue`, `AppMobileMenu.vue`, `layouts/app.vue`, `pages/app/accounts.vue`, `pages/app/envelopes.vue`, `pages/app/categories.vue`, `pages/app/plans.vue`, `pages/app/transfers.vue`, `pages/app/operations.vue`, `pages/app/analytics.vue`, `components/plans/PlanForm.vue`, `components/finance/FinanceMoneyInput.vue`, `tokens.css`, plus the corresponding page `*.test.ts` files (`accounts`, `envelopes`, `categories`, `plans`, `transfers`, `operations`, `analytics`) for the `attachTo: document.body` change.

Deleted: `apps/web/app/components/app/AppNavigation.vue` (Task 9, folded into the sidebar wiring task).

---

### Task 1: `UiTooltip` component

**Files:**
- Create: `apps/web/app/components/ui/Tooltip.vue`
- Test: `apps/web/app/components/ui/Tooltip.test.ts`

**Interfaces:**
- Produces: `UiTooltip` — props `{ text?: string | undefined }`; default slot receives scoped prop `{ describedby: string | undefined }`. When `text` is falsy, renders the default slot with no wrapper and no behavior (zero overhead). When `text` is truthy, wraps the slot in a `position: relative` span that shows a `role="tooltip"` bubble on `mouseenter`/`focusin`, hides it on `mouseleave`/`focusout`/`Escape`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/ui/Tooltip.test.ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiTooltip from './Tooltip.vue';

describe('UiTooltip', () => {
  it('renders the trigger with no wrapper when no text is given', () => {
    const wrapper = mount(UiTooltip, {
      slots: { default: '<button type="button">i</button>' },
    });

    expect(wrapper.find('.ui-tooltip').exists()).toBe(false);
    expect(wrapper.get('button').text()).toBe('i');
  });

  it('shows the bubble on focus and hides it on blur', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка про поле' },
      slots: { default: '<button type="button">i</button>' },
    });

    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Подсказка про поле');
    await wrapper.get('.ui-tooltip').trigger('focusout');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it('closes on Escape', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: { default: '<button type="button">i</button>' },
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
    await wrapper.get('.ui-tooltip').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it('connects the trigger to the bubble via aria-describedby', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: {
        default: `<template #default="{ describedby }">
          <button type="button" :aria-describedby="describedby">i</button>
        </template>`,
      },
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(
      wrapper.get('[role="tooltip"]').attributes('id'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Tooltip.test.ts`
Expected: FAIL — `Tooltip.vue` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/web/app/components/ui/Tooltip.vue -->
<script setup lang="ts">
import { ref, useId } from 'vue';

defineOptions({ name: 'UiTooltip' });

const props = defineProps<{
  text?: string | undefined;
}>();

const id = useId();
const open = ref(false);

function show() {
  if (props.text) open.value = true;
}

function hide() {
  open.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}

function getBubbleId() {
  return props.text ? `ui-tooltip-${id}` : undefined;
}
</script>

<template>
  <span
    v-if="text"
    class="ui-tooltip"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @keydown="handleKeydown"
  >
    <slot :describedby="getBubbleId()" />
    <span v-if="open" :id="getBubbleId()" role="tooltip" class="ui-tooltip__bubble">{{
      text
    }}</span>
  </span>
  <slot v-else />
</template>

<style scoped>
.ui-tooltip {
  position: relative;
  display: inline-flex;
}

.ui-tooltip__bubble {
  position: absolute;
  bottom: calc(100% + var(--hf-space-2));
  left: 50%;
  z-index: var(--hf-z-index-tooltip);
  width: max-content;
  max-width: 16rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  color: var(--hf-tooltip-color);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-tooltip-background);
  font-size: 0.8125rem;
  font-weight: var(--hf-font-weight-regular);
  line-height: 1.4;
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
```

Add the two new tokens this component uses to `apps/web/app/assets/styles/tokens.css` (inside `:root`, near the other z-index/overlay tokens):

```css
--hf-z-index-tooltip: 150;
--hf-tooltip-background: var(--hf-color-brand-navy);
--hf-tooltip-color: var(--hf-color-white);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Tooltip.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/Tooltip.vue apps/web/app/components/ui/Tooltip.test.ts apps/web/app/assets/styles/tokens.css
git commit -m "feat(web): add UiTooltip primitive for optional field/button hints"
```

---

### Task 2: `tooltip` prop on `UiInput`

**Files:**
- Modify: `apps/web/app/components/ui/Input.vue`
- Test: `apps/web/app/components/ui/Input.test.ts`

**Interfaces:**
- Consumes: `UiTooltip` from Task 1 (`{ text?: string }`, scoped slot `{ describedby }`).
- Produces: `UiInput` gains prop `tooltip?: string | undefined` (default `undefined`). When set, renders an info-icon button next to the label; the icon only exists in the DOM when `tooltip` is truthy.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/components/ui/Input.test.ts`:

```ts
it('only renders a tooltip trigger when the tooltip prop is set', async () => {
  const withoutTooltip = mount(UiInput, {
    props: { modelValue: '', name: 'name', label: 'Название' },
  });
  expect(withoutTooltip.find('.ui-field__tooltip-trigger').exists()).toBe(false);

  const withTooltip = mount(UiInput, {
    props: {
      modelValue: '',
      name: 'startingBalance',
      label: 'Начальный баланс',
      tooltip: 'Сумма на счёте на дату начала учёта.',
    },
  });
  const trigger = withTooltip.get('.ui-field__tooltip-trigger');
  await trigger.trigger('focusin');
  expect(withTooltip.get('[role="tooltip"]').text()).toBe(
    'Сумма на счёте на дату начала учёта.',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Input.test.ts`
Expected: FAIL — `.ui-field__tooltip-trigger` not found.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/app/components/ui/Input.vue`, add the import and prop:

```ts
import UiTooltip from './Tooltip.vue';
```

Add `tooltip?: string | undefined` to the `defineProps` type and to the `withDefaults` default object (`tooltip: undefined`).

Replace the opening of the template (the `<label>` line) with a label row:

```html
<div class="ui-field">
  <div class="ui-field__label-row">
    <label class="ui-field__label" :for="getInputId()">
      {{ label }}<span v-if="required" aria-hidden="true"> *</span>
    </label>
    <UiTooltip v-if="tooltip" :text="tooltip" v-slot="{ describedby }">
      <button
        type="button"
        class="ui-field__tooltip-trigger"
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
  <input
    ...
```

(keep the rest of the template — `<input>`, hint `<p>`, error `<p>` — unchanged.)

Add to the `<style scoped>` block:

```css
.ui-field__label-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}

.ui-field__tooltip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  color: var(--hf-color-text-subtle);
  border: none;
  background: none;
  cursor: pointer;
}

.ui-field__tooltip-trigger:hover,
.ui-field__tooltip-trigger:focus-visible {
  color: var(--hf-color-action-primary);
}

.ui-field__tooltip-trigger:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Input.test.ts`
Expected: PASS (all cases, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/Input.vue apps/web/app/components/ui/Input.test.ts
git commit -m "feat(web): add optional icon tooltip to UiInput"
```

---

### Task 3: `tooltip` prop on `UiSelect`

**Files:**
- Modify: `apps/web/app/components/ui/Select.vue`
- Test: create `apps/web/app/components/ui/Select.test.ts` (none exists yet)

**Interfaces:**
- Consumes: `UiTooltip` (Task 1).
- Produces: `UiSelect` gains prop `tooltip?: string | undefined`, same trigger pattern as `UiInput`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/ui/Select.test.ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiSelect from './Select.vue';

const options = [{ value: 'a', label: 'A' }];

describe('UiSelect', () => {
  it('connects label and options', () => {
    const wrapper = mount(UiSelect, {
      props: { modelValue: 'a', name: 'status', label: 'Статус', options },
    });
    const select = wrapper.get('select');
    expect(wrapper.get('label').attributes('for')).toBe(select.attributes('id'));
    expect(select.findAll('option')).toHaveLength(1);
  });

  it('only renders a tooltip trigger when the tooltip prop is set', async () => {
    const withoutTooltip = mount(UiSelect, {
      props: { modelValue: '', name: 'status', label: 'Статус', options },
    });
    expect(withoutTooltip.find('.ui-select__tooltip-trigger').exists()).toBe(false);

    const withTooltip = mount(UiSelect, {
      props: {
        modelValue: '',
        name: 'envelopeType',
        label: 'Тип конверта',
        options,
        tooltip: 'Определяет, как конверт участвует в расчёте лимита периода.',
      },
    });
    const trigger = withTooltip.get('.ui-select__tooltip-trigger');
    await trigger.trigger('focusin');
    expect(withTooltip.get('[role="tooltip"]').text()).toBe(
      'Определяет, как конверт участвует в расчёте лимита периода.',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Select.test.ts`
Expected: FAIL — `.ui-select__tooltip-trigger` not found (new test file, component not yet changed).

- [ ] **Step 3: Write minimal implementation**

Mirror Task 2 exactly, using the `ui-select` class prefix: import `UiTooltip`, add `tooltip?: string | undefined` prop + default, wrap the label in a `.ui-select__label-row` with the same trigger markup (`.ui-select__tooltip-trigger`), and add the matching CSS block (same rules, `ui-select__` prefix).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Select.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/Select.vue apps/web/app/components/ui/Select.test.ts
git commit -m "feat(web): add optional icon tooltip to UiSelect"
```

---

### Task 4: `tooltip` prop on `UiButton`

**Files:**
- Modify: `apps/web/app/components/ui/Button.vue`
- Test: `apps/web/app/components/ui/Button.test.ts`

**Interfaces:**
- Consumes: `UiTooltip` (Task 1).
- Produces: `UiButton` gains prop `tooltip?: string | undefined`. When unset, `UiButton` renders exactly as before (the button is the component root — `UiTooltip`'s `v-else` branch passes the slot through with no wrapper, so existing `wrapper.get('button')`-based tests keep working unchanged).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/components/ui/Button.test.ts`:

```ts
it('wraps the button in a tooltip only when the tooltip prop is set', async () => {
  const wrapper = mount(UiButton, {
    props: { tooltip: 'Переместить счёт в архив' },
    slots: { default: 'Архивировать' },
  });

  await wrapper.get('button').trigger('focus');
  expect(wrapper.get('[role="tooltip"]').text()).toBe('Переместить счёт в архив');
  expect(wrapper.get('button').attributes('aria-describedby')).toBe(
    wrapper.get('[role="tooltip"]').attributes('id'),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Button.test.ts`
Expected: FAIL — no `[role="tooltip"]` rendered, `aria-describedby` undefined.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/app/components/ui/Button.vue`, import `UiTooltip`, add `tooltip?: string | undefined` to props/defaults, and wrap the existing `<button>` in it:

```html
<template>
  <UiTooltip :text="tooltip" v-slot="{ describedby }">
    <button
      class="ui-button"
      :class="[
        `ui-button--${variant}`,
        `ui-button--${size}`,
        { 'ui-button--full-width': fullWidth },
      ]"
      :type="type"
      :disabled="disabled || loading"
      :aria-busy="loading || undefined"
      :aria-label="ariaLabel"
      :aria-describedby="describedby"
      @click="handleClick($event, loading, disabled)"
    >
      <span v-if="loading" class="ui-button__loader" aria-hidden="true" />
      <span class="ui-button__content"><slot /></span>
    </button>
  </UiTooltip>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Button.test.ts`
Expected: PASS (3 tests — the 2 pre-existing plus the new one)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/Button.vue apps/web/app/components/ui/Button.test.ts
git commit -m "feat(web): add optional tooltip to UiButton"
```

---

### Task 5: Escape-to-close on `UiModal`

Every page migrated to a modal form (Tasks 10–15) depends on this. Currently `UiModal` only closes via the X button or a backdrop click — no `Escape` handler exists yet, which is a keyboard-operability gap the redesign must not repeat.

**Files:**
- Modify: `apps/web/app/components/ui/Modal.vue`
- Test: create `apps/web/app/components/ui/Modal.test.ts` (none exists yet)

**Interfaces:**
- No prop/emit signature changes — `UiModal` keeps `{ open: boolean; title: string }` / `emit('close')`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/ui/Modal.test.ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiModal from './Modal.vue';

describe('UiModal', () => {
  it('emits close on Escape while open', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Новый счёт' },
      attachTo: document.body,
    });

    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('does not listen for Escape once closed', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Новый счёт' },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: false });
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Modal.test.ts`
Expected: FAIL — no `close` event emitted on Escape.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/app/components/ui/Modal.vue`, add an `onBeforeUnmount` import and a document-level keydown listener toggled alongside the existing body-scroll-lock watcher:

```ts
import { onBeforeUnmount, watch } from 'vue';
```

```ts
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') handleClose();
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.body.style.overflow = '';
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/Modal.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/Modal.vue apps/web/app/components/ui/Modal.test.ts
git commit -m "fix(web): close UiModal on Escape"
```

---

### Task 6: `ReferencePageLayout` component

**Files:**
- Create: `apps/web/app/components/ui/ReferencePageLayout.vue`
- Test: `apps/web/app/components/ui/ReferencePageLayout.test.ts`

**Interfaces:**
- Produces: `ReferencePageLayout` — no props, named slots `kicker`, `title`, `description`, `actions`, `filters`, `content`. Fixed vertical rhythm: header → filters `--hf-space-6`, filters/header → content `--hf-space-5` (this is the gap currently missing between the "Показать счета" select and the empty-state card on `/app/accounts`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/ui/ReferencePageLayout.test.ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReferencePageLayout from './ReferencePageLayout.vue';

describe('ReferencePageLayout', () => {
  it('renders provided slots in order and omits the kicker/filters when absent', () => {
    const wrapper = mount(ReferencePageLayout, {
      slots: {
        kicker: 'Справочники',
        title: 'Счета',
        description: 'Храните счета и их подтверждённые остатки.',
        actions: '<button type="button">Создать счёт</button>',
        content: '<p data-content>Список счетов</p>',
      },
    });

    expect(wrapper.find('.reference-page-layout__kicker').text()).toBe('Справочники');
    expect(wrapper.get('h1').text()).toBe('Счета');
    expect(wrapper.get('.reference-page-layout__description').text()).toBe(
      'Храните счета и их подтверждённые остатки.',
    );
    expect(wrapper.find('.reference-page-layout__filters').exists()).toBe(false);
    expect(wrapper.get('[data-content]').text()).toBe('Список счетов');
  });

  it('renders the filters block only when the slot is provided', () => {
    const wrapper = mount(ReferencePageLayout, {
      slots: { title: 'Счета', filters: '<div data-filters>Показать счета</div>' },
    });

    expect(wrapper.get('.reference-page-layout__filters').find('[data-filters]').exists()).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/ReferencePageLayout.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/web/app/components/ui/ReferencePageLayout.vue -->
<script setup lang="ts">
defineOptions({ name: 'ReferencePageLayout' });
</script>

<template>
  <div class="reference-page-layout">
    <div class="reference-page-layout__header">
      <div>
        <p v-if="$slots.kicker" class="reference-page-layout__kicker"><slot name="kicker" /></p>
        <h1><slot name="title" /></h1>
        <p v-if="$slots.description" class="reference-page-layout__description">
          <slot name="description" />
        </p>
      </div>
      <div v-if="$slots.actions" class="reference-page-layout__actions">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.filters" class="reference-page-layout__filters">
      <slot name="filters" />
    </div>
    <div class="reference-page-layout__content">
      <slot name="content" />
    </div>
  </div>
</template>

<style scoped>
.reference-page-layout {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}

.reference-page-layout__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--hf-space-6);
}

.reference-page-layout__kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: uppercase;
}

.reference-page-layout h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.25rem);
  letter-spacing: -0.04em;
}

.reference-page-layout__description {
  margin: var(--hf-space-3) 0 0;
  color: var(--hf-color-text-muted);
}

.reference-page-layout__filters {
  max-width: 18rem;
  margin-top: var(--hf-space-6);
}

.reference-page-layout__content {
  margin-top: var(--hf-space-5);
}

@media (max-width: 47.9375rem) {
  .reference-page-layout {
    padding: var(--hf-space-5);
  }

  .reference-page-layout__header {
    align-items: stretch;
    flex-direction: column;
  }

  .reference-page-layout__header > :last-child {
    align-self: start;
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/ReferencePageLayout.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/ReferencePageLayout.vue apps/web/app/components/ui/ReferencePageLayout.test.ts
git commit -m "feat(web): add ReferencePageLayout with a fixed spacing rhythm"
```

---

### Task 7: `FilterPanel` component

**Files:**
- Create: `apps/web/app/components/ui/FilterPanel.vue`
- Test: `apps/web/app/components/ui/FilterPanel.test.ts`

**Interfaces:**
- Consumes: `UiButton` (existing).
- Produces: `FilterPanel` — prop `activeCount?: number` (default `0`, shows a badge on the trigger when > 0), named slot `quick` (always-visible fields), default slot (fields shown only while the panel is open). Same backdrop + absolutely-positioned panel pattern already used by `AppUserMenu.vue` — closes on backdrop click or `Escape`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/ui/FilterPanel.test.ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FilterPanel from './FilterPanel.vue';

describe('FilterPanel', () => {
  it('shows the quick slot always and the default slot only while open', async () => {
    const wrapper = mount(FilterPanel, {
      slots: {
        quick: '<input data-quick />',
        default: '<input data-advanced />',
      },
    });

    expect(wrapper.find('[data-quick]').exists()).toBe(true);
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(true);
  });

  it('shows a badge with the active filter count', () => {
    const wrapper = mount(FilterPanel, { props: { activeCount: 3 } });
    expect(wrapper.get('.filter-panel__badge').text()).toBe('3');
  });

  it('hides the badge when there are no active filters', () => {
    const wrapper = mount(FilterPanel, { props: { activeCount: 0 } });
    expect(wrapper.find('.filter-panel__badge').exists()).toBe(false);
  });

  it('closes on backdrop click and on Escape', async () => {
    const wrapper = mount(FilterPanel, { slots: { default: '<input data-advanced />' } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(true);

    await wrapper.get('.filter-panel__backdrop').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    await wrapper.get('.filter-panel__panel').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/FilterPanel.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/web/app/components/ui/FilterPanel.vue -->
<script setup lang="ts">
import { ref } from 'vue';

import UiButton from './Button.vue';

defineOptions({ name: 'FilterPanel' });

withDefaults(defineProps<{ activeCount?: number }>(), { activeCount: 0 });

const open = ref(false);

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}
</script>

<template>
  <div class="filter-panel">
    <div class="filter-panel__bar">
      <div class="filter-panel__quick"><slot name="quick" /></div>
      <div class="filter-panel__trigger">
        <UiButton type="button" variant="secondary" :aria-expanded="open" aria-haspopup="true" @click="toggle">
          Фильтры
          <span v-if="activeCount > 0" class="filter-panel__badge" aria-hidden="true">{{
            activeCount
          }}</span>
        </UiButton>
        <Transition name="filter-panel-dropdown">
          <div v-if="open" class="filter-panel__dropdown">
            <div class="filter-panel__backdrop" @click="close" />
            <div
              class="filter-panel__panel"
              role="region"
              aria-label="Дополнительные фильтры"
              @keydown.esc="close"
            >
              <slot />
              <div class="filter-panel__panel-actions">
                <UiButton type="button" variant="tertiary" @click="close">Готово</UiButton>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-panel__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--hf-space-3);
}

.filter-panel__quick {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}

.filter-panel__trigger {
  position: relative;
}

.filter-panel__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: var(--hf-space-2);
  padding: 0 var(--hf-space-1);
  border-radius: 999px;
  background: var(--hf-color-white);
  color: var(--hf-color-action-primary);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
}

.filter-panel__dropdown {
  position: fixed;
  inset: 0;
  z-index: var(--hf-z-index-modal-backdrop, 200);
}

.filter-panel__backdrop {
  position: absolute;
  inset: 0;
}

.filter-panel__panel {
  position: absolute;
  top: calc(100% + var(--hf-space-2));
  right: 0;
  display: grid;
  gap: var(--hf-space-4);
  width: min(90vw, 28rem);
  max-height: 70vh;
  padding: var(--hf-space-5);
  overflow-y: auto;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  box-shadow:
    0 4px 6px rgb(13 27 42 / 10%),
    0 2px 4px rgb(13 27 42 / 6%);
}

.filter-panel__panel-actions {
  display: flex;
  justify-content: flex-end;
}

.filter-panel-dropdown-enter-active,
.filter-panel-dropdown-leave-active {
  transition: opacity var(--hf-transition-fast);
}

.filter-panel-dropdown-enter-from,
.filter-panel-dropdown-leave-to {
  opacity: 0;
}
</style>
```

Note: `.filter-panel__dropdown` is `position: fixed; inset: 0` purely so the backdrop covers the full viewport for outside-click detection — it does not visually darken anything (no `background`), matching the transparent-backdrop technique already used in `AppUserMenu.vue`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/ui/FilterPanel.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/FilterPanel.vue apps/web/app/components/ui/FilterPanel.test.ts
git commit -m "feat(web): add FilterPanel disclosure for compact filter bars"
```

---

### Task 8: `AppSidebar` + `AppSidebarSection`, add "Переводы" everywhere

**Files:**
- Create: `apps/web/app/components/app/AppSidebarSection.vue`
- Create: `apps/web/app/components/app/AppSidebar.vue`
- Test: `apps/web/app/components/app/AppSidebar.test.ts`
- Modify: `apps/web/app/components/app/AppMobileMenu.vue` (add the missing "Переводы" link)

**Interfaces:**
- Consumes: `useAuth()` from `apps/web/app/composables/useAuth.js` (`{ currentData, logout }`, same as `AppUserMenu.vue` already uses).
- Produces: `AppSidebar` — no props. `AppSidebarSection` — prop `label?: string | undefined`, default slot for links.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/components/app/AppSidebar.test.ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: { value: { user: { email: 'owner@example.test' } } },
    logout: vi.fn(),
  },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));

import AppSidebar from './AppSidebar.vue';

function mountSidebar() {
  return mount(AppSidebar, {
    global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
  });
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('links to every app section including Переводы', () => {
    const wrapper = mountSidebar();
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/app',
        '/app/operations',
        '/app/transfers',
        '/app/plans',
        '/app/accounts',
        '/app/envelopes',
        '/app/categories',
        '/app/analytics',
        '/app/notifications',
        '/app/settings',
      ]),
    );
  });

  it('shows the signed-in email and logs out on click', async () => {
    const wrapper = mountSidebar();
    expect(wrapper.text()).toContain('owner@example.test');

    await wrapper.get('.app-sidebar__logout').trigger('click');
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web vitest run app/components/app/AppSidebar.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/web/app/components/app/AppSidebarSection.vue -->
<script setup lang="ts">
defineOptions({ name: 'AppSidebarSection' });
defineProps<{ label?: string | undefined }>();
</script>

<template>
  <div class="app-sidebar-section">
    <p v-if="label" class="app-sidebar-section__label">{{ label }}</p>
    <div class="app-sidebar-section__links"><slot /></div>
  </div>
</template>

<style scoped>
.app-sidebar-section {
  display: grid;
  gap: var(--hf-space-1);
}

.app-sidebar-section__label {
  margin: 0;
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text-subtle);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.app-sidebar-section__links {
  display: grid;
  gap: var(--hf-space-1);
}
</style>
```

```vue
<!-- apps/web/app/components/app/AppSidebar.vue -->
<script setup lang="ts">
import { navigateTo } from '#imports';

import { useAuth } from '../../composables/useAuth.js';
import AppSidebarSection from './AppSidebarSection.vue';

defineOptions({ name: 'AppSidebar' });

const { currentData, logout } = useAuth();

function userEmail() {
  return currentData.value?.user?.email ?? '';
}

async function handleLogout() {
  await logout();
  await navigateTo('/login');
}
</script>

<template>
  <aside class="app-sidebar" aria-label="Основная навигация">
    <NuxtLink to="/app" class="app-sidebar__wordmark">HarmoFin</NuxtLink>
    <nav class="app-sidebar__nav">
      <AppSidebarSection>
        <NuxtLink to="/app" class="app-sidebar__link" active-class="app-sidebar__link--active"
          >Главная</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Учёт">
        <NuxtLink
          to="/app/operations"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Операции</NuxtLink
        >
        <NuxtLink
          to="/app/transfers"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Переводы</NuxtLink
        >
        <NuxtLink to="/app/plans" class="app-sidebar__link" active-class="app-sidebar__link--active"
          >Планы</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection label="Справочники">
        <NuxtLink
          to="/app/accounts"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Счета</NuxtLink
        >
        <NuxtLink
          to="/app/envelopes"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Конверты</NuxtLink
        >
        <NuxtLink
          to="/app/categories"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Категории</NuxtLink
        >
      </AppSidebarSection>
      <AppSidebarSection>
        <NuxtLink
          to="/app/analytics"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Аналитика</NuxtLink
        >
        <NuxtLink
          to="/app/notifications"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          >Уведомления</NuxtLink
        >
      </AppSidebarSection>
    </nav>
    <div class="app-sidebar__footer">
      <NuxtLink
        to="/app/settings"
        class="app-sidebar__link"
        active-class="app-sidebar__link--active"
        >Настройки</NuxtLink
      >
      <div class="app-sidebar__user">
        <span class="app-sidebar__email">{{ userEmail() }}</span>
        <button type="button" class="app-sidebar__logout" @click="handleLogout">Выйти</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-6);
  width: var(--hf-sidebar-width);
  height: 100vh;
  padding: var(--hf-space-5) var(--hf-space-4);
  border-right: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

.app-sidebar__wordmark {
  padding: 0 var(--hf-space-3);
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.app-sidebar__nav {
  display: grid;
  gap: var(--hf-space-5);
  overflow-y: auto;
}

.app-sidebar__link {
  display: block;
  min-height: 2.5rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-control-radius);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
  transition: background var(--hf-transition-fast);
}

.app-sidebar__link:hover {
  background: var(--hf-color-action-secondary-hover);
}

.app-sidebar__link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.app-sidebar__link--active {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-action-primary);
}

.app-sidebar__footer {
  display: grid;
  gap: var(--hf-space-2);
  margin-top: auto;
  padding-top: var(--hf-space-4);
  border-top: 1px solid var(--hf-color-border);
}

.app-sidebar__user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
  padding: 0 var(--hf-space-3);
}

.app-sidebar__email {
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__logout {
  padding: 0;
  border: none;
  background: none;
  color: var(--hf-color-action-danger);
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  cursor: pointer;
}
</style>
```

Add `--hf-sidebar-width: 16rem;` to `tokens.css` next to the other layout tokens.

Then add the missing "Переводы" link to `apps/web/app/components/app/AppMobileMenu.vue`, right after the "Операции" link:

```html
<NuxtLink
  to="/app/transfers"
  class="mobile-menu__link"
  active-class="mobile-menu__link--active"
  @click="handleClose"
  >Переводы</NuxtLink
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web vitest run app/components/app/AppSidebar.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/app/AppSidebar.vue apps/web/app/components/app/AppSidebar.test.ts apps/web/app/components/app/AppSidebarSection.vue apps/web/app/components/app/AppMobileMenu.vue apps/web/app/assets/styles/tokens.css
git commit -m "feat(web): add AppSidebar with the missing Переводы entry"
```

---

### Task 9: Wire the sidebar into `app.vue`, simplify `AppHeader`, delete `AppNavigation`

**Files:**
- Modify: `apps/web/app/layouts/app.vue`
- Modify: `apps/web/app/components/app/AppHeader.vue`
- Delete: `apps/web/app/components/app/AppNavigation.vue`

**Interfaces:**
- Consumes: `AppSidebar` (Task 8).
- Behavior: desktop (≥1024px) shows `AppSidebar` + content, no `AppHeader`. Mobile/tablet (<1024px) shows `AppHeader` (hamburger + wordmark + `AppUserMenu`) + content, `AppSidebar` hidden via CSS.

- [ ] **Step 1: Update `app.vue`**

```vue
<!-- apps/web/app/layouts/app.vue -->
<script setup lang="ts">
import AppHeader from '../components/app/AppHeader.vue';
import AppSidebar from '../components/app/AppSidebar.vue';

defineOptions({ name: 'AppLayout' });
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="app-layout__sidebar" />
    <div class="app-layout__body">
      <AppHeader class="app-layout__header" />
      <main class="app-layout__main">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: var(--hf-color-page-background);
}

.app-layout__sidebar {
  display: none;
}

.app-layout__main {
  padding: var(--hf-space-6) var(--hf-space-5);
}

@media (min-width: 1024px) {
  .app-layout {
    display: grid;
    grid-template-columns: var(--hf-sidebar-width) 1fr;
  }

  .app-layout__sidebar {
    display: flex;
  }

  .app-layout__header {
    display: none;
  }

  .app-layout__main {
    padding: var(--hf-space-8);
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .app-layout__main {
    padding: var(--hf-space-8);
  }
}
</style>
```

- [ ] **Step 2: Simplify `AppHeader.vue`**

Remove the `AppNavigation` import and its usage — `AppHeader` keeps only the mobile button, wordmark, and `AppUserMenu`, and CSS no longer needs the `≥768px` desktop-nav branch (the whole header is hidden ≥1024px by `app.vue` now):

```vue
<script setup lang="ts">
import { ref } from 'vue';

import AppMobileMenu from './AppMobileMenu.vue';
import AppMobileMenuButton from './AppMobileMenuButton.vue';
import AppUserMenu from './AppUserMenu.vue';

defineOptions({ name: 'AppHeader' });

const mobileMenuOpen = ref(false);

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value;
}

function closeMobileMenu() {
  mobileMenuOpen.value = false;
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__container">
      <AppMobileMenuButton class="app-header__mobile-button" @toggle="toggleMobileMenu" />
      <NuxtLink to="/app" class="app-header__wordmark">HarmoFin</NuxtLink>
      <AppUserMenu class="app-header__user" />
    </div>
    <AppMobileMenu :open="mobileMenuOpen" @close="closeMobileMenu" />
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
  box-shadow: 0 1px 2px rgb(13 27 42 / 4%);
}

.app-header__container {
  display: flex;
  align-items: center;
  gap: var(--hf-space-4);
  padding: var(--hf-space-4) var(--hf-space-5);
}

.app-header__wordmark {
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.app-header__wordmark:hover {
  color: var(--hf-color-action-primary);
}

.app-header__wordmark:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.app-header__user {
  margin-left: auto;
}

.app-header__mobile-button {
  display: block;
}

@media (min-width: 768px) {
  .app-header__container {
    padding: var(--hf-space-4) var(--hf-space-8);
  }
}
</style>
```

- [ ] **Step 3: Delete `AppNavigation.vue`**

```bash
git rm apps/web/app/components/app/AppNavigation.vue
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @harmofin/web typecheck` (catches any remaining import of the deleted component)
Run: `pnpm --filter @harmofin/web vitest run app/pages/app` (existing page tests must still pass — none of them assert on `AppNavigation` directly, since it only ever rendered inside the shared layout)

Then start the dev server and confirm in the browser: desktop width (≥1024px) shows the sidebar with no top header and no double-rendered nav; narrow width (<1024px) shows the hamburger header and slide-in menu exactly as before, now including "Переводы".

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/layouts/app.vue apps/web/app/components/app/AppHeader.vue
git rm apps/web/app/components/app/AppNavigation.vue
git commit -m "feat(web): switch desktop navigation to AppSidebar, simplify AppHeader for mobile"
```

---

### Task 10: `accounts.vue` — layout, modal form, tooltip

**Files:**
- Modify: `apps/web/app/pages/app/accounts.vue`
- Verify: `apps/web/app/pages/app/accounts.test.ts` (no new assertions needed — existing `data-action`/`name`-based queries keep working through Teleport)

**Interfaces:**
- Consumes: `ReferencePageLayout` (Task 6), `UiModal` (existing, now Escape-aware per Task 5), `UiInput`'s `tooltip` prop (Task 2).

- [ ] **Step 1: Restructure the template**

Replace the whole `<template>` block with:

```html
<template>
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка счетов…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Счета недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять счетами."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Счета</template>
      <template #description>Храните счета и их подтверждённые остатки.</template>
      <template #actions>
        <UiButton data-action="create-account" @click="startCreate">Создать счёт</UiButton>
      </template>
      <template #filters>
        <UiSelect
          :model-value="status"
          name="status"
          label="Показать счета"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <UiEmptyState
          v-if="accounts.length === 0"
          title="Счетов пока нет"
          description="Добавьте счёт, чтобы начать вести учёт."
        >
          <template #action><UiButton @click="startCreate">Создать счёт</UiButton></template>
        </UiEmptyState>
        <div v-else class="reference-grid">
          <AccountCard v-for="account in accounts" :key="account.id" :account="account">
            <template #actions>
              <UiButton variant="secondary" data-action="edit-account" @click="startEdit(account)"
                >Изменить</UiButton
              >
              <NuxtLink
                class="account-transfer-link"
                :to="`/app/operations?accountId=${encodeURIComponent(account.id)}`"
                >Операции счёта</NuxtLink
              >
              <NuxtLink
                v-if="!account.archivedAt"
                class="account-transfer-link"
                data-action="transfer-from-account"
                :to="`/app/transfers?sourceAccountId=${encodeURIComponent(account.id)}`"
                >Перевести со счёта</NuxtLink
              >
              <UiButton
                v-if="!account.archivedAt"
                variant="danger"
                data-action="archive-account"
                @click="requestArchive(account)"
                >Переместить в архив</UiButton
              >
            </template>
          </AccountCard>
        </div>
      </template>
    </ReferencePageLayout>

    <UiModal :open="formVisible" :title="editingId ? 'Изменить счёт' : 'Новый счёт'" @close="cancelForm">
      <form data-account-form @submit.prevent="saveAccount">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название счёта"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-model="form.accountType"
          name="accountType"
          label="Тип счёта"
          :options="getAccountTypeOptions()"
          :error="getFieldError('accountType')"
          required
        />
        <UiInput
          v-model="form.bankName"
          name="bankName"
          label="Банк"
          :error="getFieldError('bankName')"
        />
        <UiInput
          v-model="form.lastFourDigits"
          name="lastFourDigits"
          label="Последние четыре цифры карты"
          inputmode="numeric"
          :error="getFieldError('lastFourDigits')"
        />
        <UiInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          tooltip="Сумма на счёте на дату начала учёта — используется только один раз, при создании счёта."
          hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс."
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <UiInput
          v-model="form.accountingStartDate"
          name="accountingStartDate"
          label="Дата начала учёта"
          type="date"
          :error="getFieldError('accountingStartDate')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить счёт</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать счёт?"
      description="Счёт останется в истории, но будет недоступен для новых операций."
      confirm-label="Архивировать счёт"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>
```

Rename `formVisible` usage stays the same (already the existing ref); `startCreate`/`startEdit`/`cancelForm`/`saveAccount` are unchanged — only the template markup and the `UiModal :open="formVisible"` wiring are new (the field-level `v-if="formVisible"` on the `<form>` is removed since `UiModal` now owns visibility).

- [ ] **Step 2: Update imports and styles**

Add to the script imports:

```ts
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiModal from '../../components/ui/Modal.vue';
```

Replace the entire `<style scoped>` block with just the parts still needed (form field grid, grid of cards, transfer link — drop `.reference-page`, `.reference-page__content`, `.reference-page__title-row`, `.reference-page__kicker`, `.reference-page h1/h2/description`, `.reference-page__summary`, `.reference-page__filter`, and the card-chrome part of `.reference-form`, since `ReferencePageLayout` and `UiModal` now own all of that):

```css
<style scoped>
form[data-account-form] {
  display: grid;
  gap: var(--hf-space-5);
}
.reference-form__field {
  display: grid;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.reference-form__field textarea {
  min-height: 6rem;
  padding: var(--hf-space-3);
  resize: vertical;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}
.reference-form__field small {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-regular);
}
.reference-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: var(--hf-space-5);
}
.account-transfer-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-md);
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-medium);
  text-decoration: none;
}
.account-transfer-link:hover {
  text-decoration: underline;
}
</style>
```

- [ ] **Step 3: Run the existing page test (mount attached to the document so Teleport-rendered content resolves)**

In `accounts.test.ts`, add `attachTo: document.body` to the `mount(AccountsPage, { ... })` call inside `mountPage()`, and call `wrapper.unmount()` at the end of each `it` that mounts (or switch to a `afterEach` cleanup) so the Teleported modal DOM doesn't leak between tests:

```ts
function mountPage() {
  return mount(AccountsPage, {
    attachTo: document.body,
    global: {
      /* unchanged stubs */
    },
  });
}
```

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/accounts.test.ts`
Expected: PASS — same 3 tests, now exercising the modal-wrapped form.

- [ ] **Step 4: Manual verification**

Start the dev server, open `/app/accounts`, confirm: the "Показать счета" select now has visible breathing room above the empty-state card (`ReferencePageLayout`'s `--hf-space-5` gap), clicking "Создать счёт" opens a centered modal (not an inline block pushing the page down), the info icon next to "Начальный баланс" shows the tooltip text on hover/focus, and Escape closes the modal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts
git commit -m "refactor(web): move accounts page to ReferencePageLayout and a modal form"
```

---

### Task 11: `envelopes.vue` — layout, modal form, tooltip

**Files:**
- Modify: `apps/web/app/pages/app/envelopes.vue`
- Modify: `apps/web/app/pages/app/envelopes.test.ts` (add `attachTo: document.body`, same as Task 10)

**Interfaces:** same as Task 10, applied to the envelope fields.

- [ ] **Step 1: Forward `tooltip` through `FinanceMoneyInput`**

`FinanceMoneyInput` wraps `UiInput` internally. Open `apps/web/app/components/finance/FinanceMoneyInput.vue`, add `tooltip?: string | undefined` to its own props/defaults next to the existing `hint`/`error`, and pass it through to the inner `UiInput` (`:tooltip="tooltip"`) the same way `hint`/`error` are already forwarded, so the icon appears next to the money field's label too.

- [ ] **Step 2: Restructure the template**

Replace the whole `<template>` block with:

```html
<template>
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка конвертов…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Конверты недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять конвертами."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Конверты</template>
      <template #description>Планируйте деньги по целям и направлениям.</template>
      <template #actions>
        <UiButton data-action="create-envelope" @click="startCreate">Создать конверт</UiButton>
      </template>
      <template #filters>
        <UiSelect
          :model-value="status"
          name="status"
          label="Показать конверты"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <UiEmptyState
          v-if="envelopes.length === 0"
          title="Конвертов пока нет"
          description="Добавьте конверт, чтобы планировать деньги."
        >
          <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
        </UiEmptyState>
        <div v-else class="reference-grid">
          <EnvelopeCard v-for="envelope in envelopes" :key="envelope.id" :envelope="envelope">
            <template #actions>
              <UiButton variant="secondary" data-action="edit-envelope" @click="startEdit(envelope)"
                >Изменить</UiButton
              >
              <NuxtLink
                class="envelope-journal-link"
                :to="`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`"
                >Операции конверта</NuxtLink
              >
              <UiButton
                v-if="!envelope.archivedAt"
                variant="danger"
                data-action="archive-envelope"
                @click="requestArchive(envelope)"
                >Переместить в архив</UiButton
              >
            </template>
          </EnvelopeCard>
        </div>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formVisible"
      :title="editingId ? 'Изменить конверт' : 'Новый конверт'"
      @close="cancelForm"
    >
      <form data-envelope-form @submit.prevent="saveEnvelope">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название конверта"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-model="form.envelopeType"
          name="envelopeType"
          label="Тип конверта"
          tooltip="Определяет, попадает ли конверт в лимит текущего периода или живёт вне периодов (резерв, цель, свободные деньги)."
          :options="getEnvelopeTypeOptions()"
          :error="getFieldError('envelopeType')"
          required
          @update:model-value="changeEnvelopeType"
        />
        <UiSelect
          v-if="form.envelopeType === 'CURRENT_EXPENSES'"
          v-model="form.periodSlot"
          name="periodSlot"
          label="Период текущих расходов"
          :options="[
            { value: '', label: 'Не относится к периоду' },
            { value: 'FIRST', label: 'Первый период' },
            { value: 'SECOND', label: 'Второй период' },
          ]"
          :error="getFieldError('periodSlot')"
        />
        <FinanceMoneyInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          tooltip="Сумма в конверте на дату начала учёта — используется только один раз, при создании конверта."
          hint="Оставьте пустым при редактировании, чтобы сохранить текущий баланс."
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <p v-if="negativeBalanceAllowed()" class="reference-form__note">
          Отрицательный баланс разрешён настройками бюджета.
        </p>
        <FinanceMoneyInput
          v-model="form.monthlyPlannedAmount"
          name="monthlyPlannedAmount"
          label="План на месяц"
          :error="getFieldError('monthlyPlannedAmount')"
        />
        <FinanceMoneyInput
          v-model="form.targetAmount"
          name="targetAmount"
          label="Целевая сумма"
          :error="getFieldError('targetAmount')"
        />
        <UiInput
          v-model="form.targetDate"
          name="targetDate"
          label="Дата цели"
          type="date"
          :error="getFieldError('targetDate')"
        />
        <UiInput
          v-model="form.displayOrder"
          name="displayOrder"
          label="Порядок отображения"
          inputmode="numeric"
          :error="getFieldError('displayOrder')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить конверт</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать конверт?"
      description="Конверт останется в истории, но будет недоступен для новых операций."
      confirm-label="Архивировать конверт"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>
```

- [ ] **Step 3: Update imports and styles**

Add to the script imports:

```ts
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiModal from '../../components/ui/Modal.vue';
```

In `<style scoped>`, delete `.reference-page`, `.reference-page__content`, `.reference-page__title-row`, `.reference-page__kicker`, `.reference-page h1/h2/description` (the modal title replaced the in-form `<h2>`), `.reference-page__summary`, `.reference-page__filter`, and the card-chrome declarations inside `.reference-form` (keep only `display: grid; gap: var(--hf-space-5);`, renamed to `form[data-envelope-form]`). Keep `.reference-form__field`, `.reference-form__field textarea`, `.reference-form__field small`, `.reference-form__note`, `.reference-form__actions`, `.reference-grid`, `.envelope-journal-link`.

- [ ] **Step 4: Update the test**

Add `attachTo: document.body` to `envelopes.test.ts`'s mount helper, same as Task 10.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/envelopes.test.ts`
Expected: PASS

- [ ] **Step 5: Manual verification**

`/app/envelopes` — modal form opens/closes correctly, tooltip icons appear on "Начальный баланс" and "Тип конверта", spacing between the status filter and the envelope grid/empty-state matches accounts.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes.test.ts apps/web/app/components/finance/FinanceMoneyInput.vue
git commit -m "refactor(web): move envelopes page to ReferencePageLayout and a modal form"
```

---

### Task 12: `categories.vue` — layout, modal form

**Files:**
- Modify: `apps/web/app/pages/app/categories.vue`
- Modify: `apps/web/app/pages/app/categories.test.ts` (add `attachTo: document.body`)

**Interfaces:** same as Task 10.

- [ ] **Step 1: Restructure the template**

Replace the whole `<template>` block with:

```html
<template>
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка категорий…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Категории недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять категориями."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Категории</template>
      <template #description>Разделяйте доходы и расходы для будущего учёта.</template>
      <template #actions>
        <UiButton data-action="create-category" @click="startCreate">Создать категорию</UiButton>
      </template>
      <template #filters>
        <UiSelect
          :model-value="status"
          name="status"
          label="Показать категории"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <div class="category-sections">
          <section
            v-for="type in ['INCOME', 'EXPENSE'] as const"
            :key="type"
            class="category-section"
            :aria-labelledby="`${type.toLowerCase()}-categories-title`"
          >
            <h2 :id="`${type.toLowerCase()}-categories-title`">
              {{ type === 'INCOME' ? 'Доходы' : 'Расходы' }}
            </h2>
            <UiEmptyState
              v-if="categoriesOfType(type).length === 0"
              :title="type === 'INCOME' ? 'Доходов пока нет' : 'Расходов пока нет'"
              description="Добавьте категорию, чтобы она появилась в списке."
            />
            <div v-else class="category-grid">
              <article
                v-for="category in categoriesOfType(type)"
                :key="category.id"
                class="category-card"
              >
                <div class="category-card__header">
                  <div>
                    <h3>{{ category.name }}</h3>
                    <p>Порядок: {{ category.displayOrder }}</p>
                  </div>
                  <UiStatus
                    :label="category.archivedAt ? 'В архиве' : 'Активна'"
                    :tone="category.archivedAt ? 'neutral' : 'success'"
                  />
                </div>
                <p v-if="category.comment" class="category-card__comment">{{ category.comment }}</p>
                <div class="category-card__actions">
                  <UiButton
                    variant="secondary"
                    data-action="edit-category"
                    @click="startEdit(category)"
                    >Изменить</UiButton
                  >
                  <UiButton
                    v-if="!category.archivedAt"
                    variant="danger"
                    data-action="archive-category"
                    @click="requestArchive(category)"
                    >Переместить в архив</UiButton
                  >
                </div>
              </article>
            </div>
          </section>
        </div>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formVisible"
      :title="editingId ? 'Изменить категорию' : 'Новая категория'"
      @close="cancelForm"
    >
      <form data-category-form @submit.prevent="saveCategory">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название категории"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-if="!editingId"
          v-model="form.categoryType"
          name="categoryType"
          label="Тип категории"
          :options="getCategoryTypeOptions()"
          :error="getFieldError('categoryType')"
          required
        />
        <UiSelect
          v-model="form.parentId"
          name="parentId"
          label="Родительская категория"
          placeholder="Без родительской категории"
          :options="parentOptions()"
          :error="getFieldError('parentId')"
        />
        <UiInput
          v-model="form.displayOrder"
          name="displayOrder"
          label="Порядок отображения"
          inputmode="numeric"
          :error="getFieldError('displayOrder')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить категорию</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать категорию?"
      description="Категория останется в истории, но будет недоступна для новых операций."
      confirm-label="Архивировать категорию"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>
```

- [ ] **Step 2: Update imports and styles**

Add to the script imports:

```ts
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiModal from '../../components/ui/Modal.vue';
```

In `<style scoped>`, delete `.reference-page`, `.reference-page__content`, `.reference-page__title-row`, `.reference-page__kicker`, `.reference-page h1/h2/h3/description` (the modal title replaced the in-form `<h2>`; the `category-card`'s own `h3` styling stays — only drop the selector line that also listed `h2`), `.reference-page__summary`, `.reference-page__filter`, and the card-chrome declarations inside `.reference-form` (keep only `display: grid; gap: var(--hf-space-5);`, renamed to `form[data-category-form]`). Keep `.reference-form__field`, `.reference-form__field textarea`, `.reference-form__field small`, `.reference-form__actions` (shared with `.category-card__actions`), `.category-sections`, `.category-section`, `.category-grid`, `.category-card`, `.category-card__header`, `.category-card h3/p`, `.category-card__header p`, `.category-card__comment`.

- [ ] **Step 3: Update the test, run it**

Add `attachTo: document.body` to `categories.test.ts`.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/categories.test.ts`
Expected: PASS

- [ ] **Step 4: Manual verification**

`/app/categories` — modal form, spacing fix, Доходы/Расходы sections unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/app/categories.vue apps/web/app/pages/app/categories.test.ts
git commit -m "refactor(web): move categories page to ReferencePageLayout and a modal form"
```

---

### Task 13: `plans.vue` — layout, modal form

`PlanForm.vue` currently styles itself as a card (`padding`, `background`, `box-shadow` in its own `<style>`), because until now it rendered directly on the page. It is only used from `plans.vue`, so strip that chrome from the component itself — once it's the sole content of `UiModal`, the modal already supplies the card surface.

**Files:**
- Modify: `apps/web/app/pages/app/plans.vue`
- Modify: `apps/web/app/components/plans/PlanForm.vue`
- Modify: `apps/web/app/pages/app/plans.test.ts` (add `attachTo: document.body`)

**Interfaces:**
- Consumes: `ReferencePageLayout`, `UiModal`. `PlanForm`'s public props/emits (`plan`, `accounts`, `categories`, `envelopes`, `errors`, `pending`, `@submit`) are unchanged.

- [ ] **Step 1: Strip `PlanForm.vue`'s self-styling**

In `apps/web/app/components/plans/PlanForm.vue`, change:

```css
.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
```

to:

```css
.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
}
```

- [ ] **Step 2: Restructure `plans.vue`'s template**

Replace the whole `<template>` block with:

```html
<template>
  <div v-if="hydrated" class="plans-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Регулярные планы</template>
      <template #title>Планы и обязательства</template>
      <template #actions>
        <UiButton data-action="create-plan" @click="openCreate">Добавить план</UiButton>
      </template>
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
        <template v-else-if="budget">
          <section class="plans-page__section" aria-labelledby="occurrences-title">
            <div class="plans-page__section-heading">
              <h2 id="occurrences-title">Возникновения</h2>
              <p>План не меняет баланс, пока операция не подтверждена.</p>
            </div>
            <UiEmptyState
              v-if="occurrences.length === 0"
              title="Возникновений пока нет"
              description="Worker добавит ближайшие даты активных планов."
            />
            <div v-else class="plans-page__list">
              <PlanOccurrenceCard
                v-for="occurrence in occurrences"
                :key="occurrence.id"
                :class="{
                  'plans-page__occurrence--highlighted': isHighlightedOccurrence(occurrence.id),
                }"
                :occurrence="occurrence"
                :pending="pending"
                @draft="createDraft(occurrence)"
                @skip="confirmation = { action: 'skip', id: occurrence.id }"
                @complete="confirmation = { action: 'complete', id: occurrence.id }"
              />
            </div>
          </section>
          <section class="plans-page__section" aria-labelledby="plans-title">
            <div class="plans-page__section-heading">
              <h2 id="plans-title">Шаблоны планов</h2>
              <p>Изменения влияют только на будущие возникновения.</p>
            </div>
            <UiEmptyState
              v-if="plans.length === 0"
              title="Планов пока нет"
              description="Добавьте ожидаемый доход, расход или накопление."
            />
            <div v-else class="plans-page__list">
              <PlanCard
                v-for="plan in plans"
                :key="plan.id"
                :plan="plan"
                :pending="pending"
                @edit="openEdit(plan)"
                @disable="confirmation = { action: 'disable', id: plan.id }"
                @remove="confirmation = { action: 'remove', id: plan.id }"
              />
            </div>
          </section>
        </template>
        <UiEmptyState
          v-else-if="!loading"
          title="Бюджет не выбран"
          description="Создайте или выберите активный бюджет, чтобы управлять планами."
        />
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formOpen"
      :title="selectedPlan ? 'Изменить план' : 'Новый план'"
      @close="formOpen = false"
    >
      <PlanForm
        :plan="selectedPlan"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="savePlan"
      />
    </UiModal>

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmation?.action === 'remove' ? 'Удалить план?' : 'Подтвердить действие?'"
      :description="
        confirmation?.action === 'remove'
          ? 'Будущие возникновения будут отменены.'
          : 'Данные будут обновлены на сервере.'
      "
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      variant="primary"
      :loading="pending"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />
  </div>
</template>
```

(root element changed from `<main v-if="hydrated" class="plans-page" ...>` to `<div v-if="hydrated" class="plans-page" ...>` — avoids the nested `<main>`-inside-layout `<main>` issue fixed for the other reference pages.)

- [ ] **Step 3: Update imports and styles**

Import `ReferencePageLayout`/`UiModal`. Remove `.plans-page { max-width/margin/padding }`, `.plans-page__header*`, `.plans-page__eyebrow` (now `ReferencePageLayout` owns header layout); keep `.plans-page__status`, `.plans-page__error`, `.plans-page__section*`, `.plans-page__list`, `.plans-page__occurrence--highlighted`, updating the outer selector from `.plans-page` to whatever wraps the `ReferencePageLayout`'s `#content` slot (no change needed if these rules stay scoped to the same class names inside `#content`).

- [ ] **Step 4: Update the test, run it**

Add `attachTo: document.body` to `plans.test.ts`.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/plans.test.ts`
Expected: PASS

- [ ] **Step 5: Manual verification**

`/app/plans` — "Добавить план"/"Изменить" open a modal with the (now chrome-less, modal-hosted) `PlanForm`; occurrences/templates sections unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/plans.vue apps/web/app/components/plans/PlanForm.vue apps/web/app/pages/app/plans.test.ts
git commit -m "refactor(web): move plans page to ReferencePageLayout and a modal form"
```

---

### Task 14: `transfers.vue` — layout, modal form

`transfers.vue` currently gives `TransferForm` its card chrome via a page-level `:deep(.transfer-form)` selector — remove that block once the form lives inside `UiModal`.

**Files:**
- Modify: `apps/web/app/pages/app/transfers.vue`
- Modify: `apps/web/app/pages/app/transfers.test.ts` (add `attachTo: document.body`)

**Interfaces:** `TransferForm`'s props/emits unchanged.

- [ ] **Step 1: Restructure the template**

Replace the whole `<template>` block with:

```html
<template>
  <div v-if="hydrated" class="transfers-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Движение денег</template>
      <template #title>Переводы</template>
      <template #description
        >Перемещайте деньги между счетами, сохраняя назначение по конвертам.</template
      >
      <template #actions>
        <UiButton data-action="create-transfer" :disabled="loading" @click="openCreate"
          >Новый перевод</UiButton
        >
      </template>
      <template v-if="!loading && budgetId" #filters>
        <UiSelect
          :model-value="statusFilter"
          name="status"
          label="Статус перевода"
          :options="[
            { value: '', label: 'Все статусы' },
            { value: 'DRAFT', label: 'Черновики' },
            { value: 'CONFIRMED', label: 'Подтверждённые' },
            { value: 'CANCELLED', label: 'Отменённые' },
            { value: 'DELETED', label: 'Удалённые' },
          ]"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <p v-if="statusText" class="transfers-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="transfers-page__error" role="alert">
          {{ error }} <UiButton variant="tertiary" @click="load()">Повторить</UiButton>
        </p>
        <UiEmptyState
          v-if="!loading && !budgetId"
          title="Бюджет не выбран"
          description="Выберите бюджет, чтобы управлять переводами."
        />
        <template v-else>
          <p v-if="loading">Загрузка переводов…</p>
          <UiEmptyState
            v-else-if="transfers.length === 0"
            title="Переводов пока нет"
            description="Создайте перевод, чтобы переместить деньги между счетами."
          />
          <section v-else class="transfers-page__list" aria-label="Список переводов">
            <article v-for="transfer in transfers" :key="transfer.id" class="transfers-page__item">
              <TransferCard :transfer="transfer" />
              <div class="transfers-page__actions">
                <UiButton
                  v-if="transfer.status === 'DRAFT'"
                  variant="secondary"
                  @click="requestAction('confirm', transfer)"
                  >Подтвердить</UiButton
                >
                <UiButton
                  v-if="transfer.status === 'DRAFT'"
                  variant="tertiary"
                  @click="requestAction('cancel', transfer)"
                  >Отменить</UiButton
                >
                <UiButton
                  v-if="transfer.status !== 'DELETED'"
                  variant="tertiary"
                  @click="requestAction('delete', transfer)"
                  >Удалить</UiButton
                >
              </div>
            </article>
          </section>
          <UiButton v-if="nextCursor" variant="secondary" :disabled="loading" @click="load(true)"
            >Загрузить ещё</UiButton
          >
        </template>
      </template>
    </ReferencePageLayout>

    <UiModal :open="formOpen" title="Новый перевод" @close="formOpen = false">
      <TransferForm
        :model="form"
        :accounts="accounts"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="receiveForm"
      />
    </UiModal>

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="dialogTitle()"
      :description="dialogDescription()"
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      :variant="confirmation?.action === 'delete' ? 'danger' : 'primary'"
      :loading="pending"
      @confirm="confirmAction"
      @cancel="confirmation = null"
    />
  </div>
</template>
```

(root element changed from `<main v-if="hydrated" class="transfers-page" ...>` to `<div v-if="hydrated" class="transfers-page" ...>`; the status filter's `v-if="!loading && budgetId"` guard replaces the original `v-else` branch that used to wrap the filter, form, and list together.)

- [ ] **Step 2: Update imports and styles**

Import `ReferencePageLayout`/`UiModal`. Delete `.transfers-page { max-width/margin/padding }`, `.transfers-page__header*`, `.transfers-page__eyebrow`, `.transfers-page__filter` (now the layout's `#filters` slot), and the whole `.transfers-page :deep(.transfer-form) { ... }` block. Keep `.transfers-page__status`, `.transfers-page__error`, `.transfers-page__list`, `.transfers-page__item`, `.transfers-page__actions`.

- [ ] **Step 3: Update the test, run it**

Add `attachTo: document.body` to `transfers.test.ts`.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/transfers.test.ts`
Expected: PASS

- [ ] **Step 4: Manual verification**

`/app/transfers` — "Новый перевод" opens a modal, no double card border around the form, list/actions unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/app/transfers.vue apps/web/app/pages/app/transfers.test.ts
git commit -m "refactor(web): move transfers page to ReferencePageLayout and a modal form"
```

---

### Task 15: `operations.vue` — layout, modal form, `FilterPanel`

This is the largest single page: it currently shows 9 always-visible filter fields plus a reset button before any data. Split them into 2 always-visible quick filters (`search`, `type`) and the rest behind `FilterPanel`.

**Files:**
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts` (add `attachTo: document.body`)

**Interfaces:**
- Consumes: `ReferencePageLayout`, `UiModal`, `FilterPanel` (Task 7).

- [ ] **Step 1: Compute the active filter count**

Add near the other computed helpers in the script:

```ts
function activeFilterCount() {
  const advanced: Array<string> = [
    filters.value.status,
    filters.value.from,
    filters.value.to,
    filters.value.cycleStart,
    filters.value.periodStart,
    filters.value.accountId,
    filters.value.categoryId,
    filters.value.envelopeId,
  ];
  return advanced.filter((value) => value !== '').length;
}
```

- [ ] **Step 2: Restructure the filters block**

Replace the `<section class="operations-page__filters" ...>` block with:

```html
<FilterPanel :active-count="activeFilterCount()">
  <template #quick>
    <UiInput
      v-model="filters.search"
      name="search"
      label="Поиск"
      @update:model-value="applyFilters"
    />
    <UiSelect
      v-model="filters.type"
      name="type"
      label="Тип"
      :options="[
        { value: '', label: 'Все типы' },
        { value: 'INCOME', label: 'Доходы' },
        { value: 'EXPENSE', label: 'Расходы' },
      ]"
      @update:model-value="applyFilters"
    />
  </template>
  <UiSelect
    v-model="filters.status"
    name="status"
    label="Статус"
    :options="[
      { value: '', label: 'Все активные' },
      { value: 'DRAFT', label: 'Черновики' },
      { value: 'CONFIRMED', label: 'Подтверждённые' },
      { value: 'CANCELLED', label: 'Отменённые' },
      { value: 'DELETED', label: 'Удалённые' },
      { value: 'all', label: 'Все статусы' },
    ]"
    @update:model-value="applyFilters"
  />
  <UiInput v-model="filters.from" name="from" label="С даты" type="date" @update:model-value="applyFilters" />
  <UiInput v-model="filters.to" name="to" label="По дату" type="date" @update:model-value="applyFilters" />
  <UiInput
    v-model="filters.cycleStart"
    name="cycleStart"
    label="Дата цикла"
    type="date"
    @update:model-value="applyFilters"
  />
  <UiInput
    v-model="filters.periodStart"
    name="periodStart"
    label="Дата периода"
    type="date"
    @update:model-value="applyFilters"
  />
  <UiSelect
    v-model="filters.accountId"
    name="journal-account-id"
    label="Счёт в журнале"
    :options="[{ value: '', label: 'Все счета' }, ...accounts]"
    @update:model-value="applyFilters"
  />
  <UiSelect
    v-model="filters.categoryId"
    name="journal-category-id"
    label="Категория в журнале"
    :options="[
      { value: '', label: 'Все категории' },
      ...categories.map((item) => ({ value: item.id, label: item.name })),
    ]"
    @update:model-value="applyFilters"
  />
  <UiSelect
    v-model="filters.envelopeId"
    name="journal-envelope-id"
    label="Конверт в журнале"
    :options="[{ value: '', label: 'Все конверты' }, ...envelopes]"
    @update:model-value="applyFilters"
  />
  <UiButton variant="tertiary" @click="resetFilters">Сбросить фильтры</UiButton>
</FilterPanel>
```

(`search`/`type` fields keep their exact `name`/`v-model` bindings — only their position moves into `#quick`, so any test that queries `input[name="search"]` still finds them, now always visible instead of behind a click.)

- [ ] **Step 3: Wrap the page in `ReferencePageLayout` and move the form into `UiModal`**

`kicker` = "Журнал", `title` = "Операции", `actions` = the export/create buttons, `filters` = the `FilterPanel` block above, `content` = the sort row + transaction list + pagination. Move:

```html
<UiModal
  :open="formOpen"
  :title="selectedTransaction ? 'Изменить операцию' : 'Добавить операцию'"
  @close="formOpen = false"
>
  <OperationForm
    :mode="selectedTransaction ? 'edit' : 'create'"
    :model="form"
    :accounts="accounts"
    :categories="categories"
    :envelopes="envelopes"
    :errors="formErrors"
    :pending="pending"
    :current="selectedTransaction"
    @submit="saveOperation"
  />
</UiModal>
```

(keep the existing `@submit` handler name used today — check the current handler name a few lines below the `<OperationForm>` tag in the file and reuse it verbatim; do not rename it.)

Root element changes from `<main v-if="hydrated" class="operations-page">` to `<div v-if="hydrated" class="operations-page">`.

- [ ] **Step 4: Update imports and styles**

Import `ReferencePageLayout`, `UiModal`, `FilterPanel`. Delete `.operations-page { max-width/margin/padding }`, `.operations-page__header*`, `.operations-page__eyebrow`, `.operations-page__filters` (now `FilterPanel` internals). Keep `.operations-page__status`, `.operations-page__error`, `.operations-page__sort`, and any list/pagination rules further down the file.

- [ ] **Step 5: Update the test, run it**

Add `attachTo: document.body` to `operations.test.ts`. If any existing assertion opens the create form by clicking `[data-action="create-operation"]` and then queries a field by `name`, it keeps working unchanged since field names didn't change. If a test asserted all 9 filters are simultaneously visible without interaction, update it to first click the "Фильтры" button (`wrapper.findAll('button').find(...)` matching text `Фильтры`, or add `data-action="toggle-filters"` to `FilterPanel`'s trigger button and query that) before asserting on the advanced fields.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/operations.test.ts`
Expected: PASS

- [ ] **Step 6: Manual verification**

`/app/operations` — only "Поиск" and "Тип" are visible by default; "Фильтры" shows a badge once any advanced filter is set; opening/closing the panel and the create/edit modal both work with mouse and keyboard (Tab, Escape).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts
git commit -m "refactor(web): move operations page to ReferencePageLayout, a modal form, and FilterPanel"
```

---

### Task 16: `analytics.vue` — layout, `FilterPanel`

**Files:**
- Modify: `apps/web/app/pages/app/analytics.vue`
- Modify: `apps/web/app/pages/app/analytics.test.ts`

**Interfaces:**
- Consumes: `ReferencePageLayout`, `FilterPanel`. `ReportFilters.vue` is unchanged (all 6 of its fields move behind the panel together — it renders `type` internally already, so there is no separate always-visible "quick" filter to duplicate it; the "Отчёт" report-key picker outside `FilterPanel` already gives the page an always-visible primary control).

- [ ] **Step 1: Restructure `analytics.vue`'s template**

```html
<template>
  <div class="analytics-page">
    <ReferencePageLayout>
      <template #kicker>Аналитика</template>
      <template #title>Отчёты бюджета</template>
      <template #content>
        <p v-if="error" role="alert" class="analytics-page__error">
          {{ error }} <UiButton variant="tertiary" @click="load">Повторить</UiButton>
        </p>
        <UiEmptyState
          v-if="!loading && !budget"
          title="Бюджет не выбран"
          description="Выберите активный бюджет для просмотра отчётов."
        />
        <template v-else>
          <UiSelect
            v-model="reportKey"
            name="reportKey"
            label="Отчёт"
            :options="[
              { value: 'expenses-by-category', label: 'Расходы по категориям' },
              { value: 'expenses-by-period', label: 'Расходы по периодам' },
              { value: 'expenses-by-cycle', label: 'Расходы по циклам' },
              { value: 'incomes-by-cycle', label: 'Доходы по циклам' },
              { value: 'savings-reallocation-by-cycle', label: 'Перераспределения накоплений' },
              { value: 'net-cash-flow', label: 'Чистый денежный поток' },
              { value: 'account-balances', label: 'Остатки счетов' },
              { value: 'envelope-balances', label: 'Остатки конвертов' },
              { value: 'savings-goals', label: 'Цели накоплений' },
              { value: 'plan-vs-actual', label: 'План и факт' },
            ]"
            @update:model-value="updateReportKey"
          />
          <FilterPanel :active-count="activeFilterCount()">
            <ReportFilters
              v-model="filters"
              :accounts="accounts"
              :categories="categories"
              :envelopes="envelopes"
              @update:model-value="updateFilters"
            />
          </FilterPanel>
          <p v-if="loading">Загрузка отчёта…</p>
          <UiEmptyState
            v-else-if="report && report.rows.length === 0"
            title="Нет данных"
            description="Измените фильтры или добавьте подтверждённые операции."
          />
          <PlanVsActualReport v-else-if="isPlanVsActualReport(report)" :rows="report.rows" />
          <GoalProgressReport v-else-if="isGoalProgressReport(report)" :rows="report.rows" />
          <ReportChart v-else-if="isGenericReport(report)" :report="report" />
        </template>
      </template>
    </ReferencePageLayout>
  </div>
</template>
```

Add an `activeFilterCount()` helper scoped to this page's `filters`, counting all 6 `ReportFilters` fields since all of them now live behind the panel:

```ts
function activeFilterCount() {
  const advanced: Array<string> = [
    filters.value.from,
    filters.value.to,
    filters.value.type,
    filters.value.accountId,
    filters.value.categoryId,
    filters.value.envelopeId,
  ];
  return advanced.filter((value) => value !== '').length;
}
```

- [ ] **Step 2: Update imports and styles**

Import `ReferencePageLayout`, `FilterPanel`. Delete `.analytics-page { display:grid/gap/max-width/margin/padding }` and the `header`-targeting rules (now owned by `ReferencePageLayout`); keep `.analytics-page__error`.

- [ ] **Step 3: Update the test, run it**

In `analytics.test.ts`, any assertion that the `ReportFilters` fields (`from`/`to`/`type`/`accountId`/`categoryId`/`envelopeId`) are visible without interaction needs to open the panel first (click the "Фильтры" trigger) before querying them — all 6 now live behind it. The "Отчёт" report-key select stays directly queryable, unaffected.

Run: `pnpm --filter @harmofin/web vitest run app/pages/app/analytics.test.ts`
Expected: PASS

- [ ] **Step 4: Manual verification**

`/app/analytics` — report picker is always visible, all 6 `ReportFilters` fields are behind "Фильтры" with a badge showing how many are active, spacing matches the other reference pages.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/app/analytics.vue apps/web/app/pages/app/analytics.test.ts
git commit -m "refactor(web): move analytics page to ReferencePageLayout and FilterPanel"
```

---

### Task 17: Desktop control density

**Files:**
- Modify: `apps/web/app/assets/styles/tokens.css`

**Interfaces:** none — pure CSS token override, no component changes.

- [ ] **Step 1: Add the desktop override**

Append to `tokens.css` (outside the base `:root` block, after it):

```css
@media (min-width: 1024px) {
  :root {
    --hf-control-height-sm: 2.25rem;
    --hf-control-height-md: 2.5rem;
    --hf-control-height-lg: 2.75rem;
  }
}
```

- [ ] **Step 2: Verify nothing that must stay 44px regressed**

Grep for hardcoded `44px` (not token-based) touch targets that must stay fixed regardless of viewport — `Modal.vue`'s `.modal__close`, `AppMobileMenu.vue`'s `.mobile-menu__close`/`.mobile-menu__link`, `AppUserMenu.vue`'s `.user-menu__button`/`.user-menu__item`:

Run: `grep -rn "44px" apps/web/app/components`

Expected: these all use a literal `44px` (not `var(--hf-control-height-*)`), so they are unaffected by the token override — confirm this is still the case (no regression to check beyond confirming the grep output looks the same as before this task).

- [ ] **Step 3: Manual verification**

Run: `pnpm --filter @harmofin/web vitest run` (full web unit suite, confirm nothing broke)
Run: `pnpm --filter @harmofin/web typecheck`
Run: `pnpm --filter @harmofin/web lint`

Start the dev server, resize the browser to ≥1024px and confirm inputs/buttons/selects look visibly more compact across `/app/accounts`, `/app/operations`, dashboard quick actions; resize to <1024px and confirm they return to the original 44–52px heights (mobile menu, modal close button, and touch targets are still ≥44px there, since those three components use their own literal `44px`, not the token).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/assets/styles/tokens.css
git commit -m "feat(web): shrink control heights on desktop while keeping 44px touch targets on mobile"
```

---

## Notes for the executor

- Tasks 1–9 are shared infrastructure with no user-visible page changes yet except the sidebar itself (Task 9) — safe to land independently.
- Tasks 10–16 each touch exactly one page and are independent of each other (only depend on 1–9); they can be done in any order, or in parallel by different reviewers, once 1–9 are merged.
- Every page task removes the local per-page `<main>`/`<header>` duplication that was flagged during the earlier navigation bugfix — double-check with `grep -n "^\s*<main" apps/web/app/pages/app/*.vue` after Task 16 that no `/app/*` page still opens with `<main>` (the shared layout already provides the one `<main>` for the whole app).
- `AddOperationModal.vue` / `AddTransferModal.vue` (the dashboard `QuickActionBar` modals) are known to be disconnected from the API (see the design spec's "отдельная находка" note) — out of scope here, flag separately if the user wants it fixed.
