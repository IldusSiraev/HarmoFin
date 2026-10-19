<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from '#app';
import { useSeoMeta } from '#imports';

import DemoCycleStep from '../components/demo/DemoCycleStep.vue';
import DemoStage from '../components/demo/DemoStage.vue';
import DemoStepCard from '../components/demo/DemoStepCard.vue';
import { cycleErrors } from '../components/demo/demo-cycle.js';
import UiButton from '../components/ui/Button.vue';
import { demoPeriodDates } from '../data/demo-period-dates.js';
import {
  DEMO_CHOICES,
  DEMO_STEP_COUNT,
  demoSnapshot,
  demoStepText,
} from '../data/demo-scenario.js';
import { parseDemoQuery, toDemoQuery, type DemoState } from '../data/demo-state.js';

defineOptions({ name: 'DemoPage' });
useSeoMeta({
  title: 'Демо — HarmoFin',
  description:
    'Попробуйте HarmoFin без регистрации: настройте финансовый цикл и проживите месяц семьи с конвертами.',
});

const route = useRoute();
const router = useRouter();
const card = ref<InstanceType<typeof DemoStepCard> | null>(null);
const hydrated = ref(false);

const state = computed(() => parseDemoQuery(route.query as Record<string, unknown>));
// Draft cycle fields: the visitor may type an invalid value; the URL keeps the last valid cycle.
const startDraft = ref(String(state.value.start));
const offsetDraft = ref(String(state.value.offset));
const cycleValid = computed(
  () => Object.keys(cycleErrors(startDraft.value, offsetDraft.value)).length === 0,
);

const dates = computed(() => demoPeriodDates(state.value.start, state.value.offset));
const choices = computed(() => ({ split: state.value.split, leftover: state.value.leftover }));
// Only step 2 before its own choice has no snapshot (the URL rewind guarantees the other
// choice-dependent steps already carry their choice); fall back to the pre-allocation state.
const snapshot = computed(
  () => demoSnapshot(state.value.step, choices.value) ?? demoSnapshot(1, choices.value)!,
);
const text = computed(() => demoStepText(state.value.step, choices.value, dates.value));
const asOf = computed(() => {
  const d = dates.value;
  return [d.salaryOn, d.salaryOn, d.salaryOn, d.mortgageOn, d.shoppingTo, d.periodEnd, d.periodEnd][
    state.value.step
  ]!;
});
const stepChoices = computed(() =>
  state.value.step === 2
    ? DEMO_CHOICES.split
    : state.value.step === 5
      ? DEMO_CHOICES.leftover
      : undefined,
);
const selected = computed(() =>
  state.value.step === 2 ? state.value.split : state.value.step === 5 ? state.value.leftover : null,
);
const canGoNext = computed(() => {
  if (state.value.step === 0) return cycleValid.value;
  if (state.value.step === 2) return state.value.split !== null;
  if (state.value.step === 5) return state.value.leftover !== null;
  return state.value.step < DEMO_STEP_COUNT - 1;
});
// The stage preview always shows a valid cycle: the drafts while they parse, otherwise the
// last cycle committed to the URL. Never Number() an invalid draft into the preview.
const previewCycle = computed(() =>
  cycleValid.value
    ? { start: Number(startDraft.value), offset: Number(offsetDraft.value) }
    : { start: state.value.start, offset: state.value.offset },
);

function go(next: DemoState) {
  return router.replace({ query: toDemoQuery(next) });
}

function choose(value: string) {
  if (state.value.step === 2)
    void go({ ...state.value, split: value as DemoState['split'], leftover: null });
  if (state.value.step === 5) void go({ ...state.value, leftover: value as DemoState['leftover'] });
}

function next() {
  if (!canGoNext.value) return;
  const base =
    state.value.step === 0
      ? { ...state.value, start: Number(startDraft.value), offset: Number(offsetDraft.value) }
      : state.value;
  void go({ ...base, step: state.value.step + 1 });
}

function back() {
  if (state.value.step > 0) void go({ ...state.value, step: state.value.step - 1 });
}

function restart() {
  startDraft.value = '10';
  offsetDraft.value = '15';
  void go({ step: 0, start: 10, offset: 15, split: null, leftover: null });
}

// Rewrite a URL that was normalized or rewound, so the address bar matches what is shown.
onMounted(() => {
  const normalized = toDemoQuery(state.value);
  const current = route.query as Record<string, unknown>;
  const same =
    Object.keys(normalized).length === Object.keys(current).length &&
    Object.entries(normalized).every(([key, value]) => current[key] === value);
  if (!same && Object.keys(current).length > 0) void go(state.value);
  hydrated.value = true;
});

watch(
  () => state.value.step,
  async () => {
    await nextTick();
    card.value?.focusHeading();
  },
);
</script>

<template>
  <div class="demo-page" :data-hydrated="hydrated ? 'true' : 'false'">
    <h1 class="demo-page__visually-hidden">Демо HarmoFin</h1>
    <header class="demo-page__header">
      <NuxtLink to="/" class="demo-page__logo">HarmoFin</NuxtLink>
      <UiButton to="/register" variant="secondary" size="sm">Создать аккаунт</UiButton>
    </header>
    <p class="demo-page__notice">Демо: выдуманная семья и суммы. Ничего не сохраняется.</p>
    <main class="demo-page__layout">
      <div class="demo-page__story">
        <DemoStepCard
          ref="card"
          :step="state.step"
          :title="text.title"
          :body="text.body"
          :choices="stepChoices"
          :selected="selected"
          @choose="choose"
        />
        <DemoCycleStep
          v-if="state.step === 0"
          :start="startDraft"
          :offset="offsetDraft"
          @update:start="startDraft = $event"
          @update:offset="offsetDraft = $event"
        />
        <nav class="demo-page__nav" aria-label="Шаги демо">
          <UiButton
            variant="tertiary"
            :disabled="state.step === 0"
            data-action="demo-back"
            @click="back"
          >
            Назад
          </UiButton>
          <UiButton
            v-if="state.step < DEMO_STEP_COUNT - 1"
            :disabled="!canGoNext"
            data-action="demo-next"
            @click="next"
          >
            Далее
          </UiButton>
          <UiButton v-else to="/register" variant="brand" data-action="demo-register">
            Создать аккаунт
          </UiButton>
        </nav>
        <UiButton
          variant="tertiary"
          size="sm"
          class="demo-page__restart"
          data-action="demo-restart"
          @click="restart"
        >
          Начать сначала
        </UiButton>
      </div>
      <div class="demo-page__screen">
        <DemoStage
          :step="state.step"
          :snapshot="snapshot"
          :dates="dates"
          :as-of="asOf"
          :caption="text.caption"
          :cycle="previewCycle"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.demo-page {
  min-height: 100vh;
  background: var(--hf-color-page-background);
  color: var(--hf-color-text);
}

.demo-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
  padding: var(--hf-space-4);
}

.demo-page__logo {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
}

.demo-page__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.demo-page__notice {
  max-width: var(--hf-container-max-wide);
  margin: 0 auto var(--hf-space-4);
  padding: var(--hf-space-3) var(--hf-space-4);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.demo-page__layout {
  display: grid;
  gap: var(--hf-space-6);
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
  padding: 0 var(--hf-space-4) var(--hf-space-12);
}

.demo-page__story {
  display: grid;
  gap: var(--hf-space-5);
  align-content: start;
}

.demo-page__nav {
  display: flex;
  gap: var(--hf-space-3);
  position: sticky;
  bottom: 0;
  padding: var(--hf-space-3) 0;
  background: var(--hf-color-page-background);
}

.demo-page__restart {
  justify-self: start;
}

@media (min-width: 64rem) {
  .demo-page__layout {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    align-items: start;
  }

  .demo-page__nav {
    position: static;
  }
}
</style>
