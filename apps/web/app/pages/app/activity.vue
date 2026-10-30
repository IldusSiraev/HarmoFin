<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { definePageMeta } from '#imports';

import ActivityRow from '../../components/activity/ActivityRow.vue';
import { activityDayKey, activityDayLabel } from '../../components/activity/activity-phrases.js';
import { authorLabel } from '../../components/operations/author-label.js';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiFilterBar from '../../components/ui/FilterBar.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { type ActivityItem, useActivityFeed } from '../../composables/useActivityFeed.js';
import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'ActivityPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { budget } = useActiveWorkspace();
const feed = useActivityFeed();

const items = ref<ActivityItem[]>([]);
const people = ref<PersonRef[]>([]);
const nextCursor = ref<string | null>(null);
const actorFilter = ref('');
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref(false);
const moreError = ref(false);
// Only the newest request may write state: a slower older response must not overwrite a newer one.
let requestSeq = 0;
const now = ref(new Date());
const listEl = ref<HTMLElement | null>(null);
// «Новое» is fixed by the first response of this visit: marking seen right after must not
// move rows to «Ранее» while the page is open.
const boundary = ref<number | null>(null);
let markedSeen = false;

const isNew = (item: ActivityItem) =>
  boundary.value !== null && Date.parse(item.occurredAt) > boundary.value;
const shown = computed(() => items.value.map((item) => ({ ...item, isNew: isNew(item) })));
const fresh = computed(() => shown.value.filter((item) => item.isNew));
const earlier = computed(() => {
  const groups: Array<{ key: string; label: string; items: ActivityItem[] }> = [];
  for (const item of shown.value.filter((entry) => !entry.isNew)) {
    const key = activityDayKey(item.occurredAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: activityDayLabel(key, now.value), items: [item] });
  }
  return groups;
});
const chips = computed(() => [
  {
    key: 'actor',
    label: 'Участник',
    options: people.value.map((person) => ({ value: person.userId, label: authorLabel(person) })),
  },
]);

async function load(): Promise<void> {
  const budgetId = budget.value?.id;
  if (!budgetId) return;
  const seq = ++requestSeq;
  loading.value = true;
  loadingMore.value = false;
  loadError.value = false;
  moreError.value = false;
  try {
    now.value = new Date();
    const page = await feed.list(budgetId, actorFilter.value ? { actorId: actorFilter.value } : {});
    if (seq !== requestSeq) return;
    items.value = page.items;
    people.value = page.people;
    nextCursor.value = page.nextCursor;
    if (boundary.value === null) boundary.value = Date.parse(page.newSince);
    if (!markedSeen) {
      markedSeen = true;
      // Failure is invisible to the user: the next visit simply shows the same rows as new.
      void feed.markSeen(budgetId).catch(() => undefined);
    }
  } catch {
    if (seq !== requestSeq) return;
    // Rows must never contradict the active filter chip, so a failed load drops them.
    items.value = [];
    nextCursor.value = null;
    loadError.value = true;
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const budgetId = budget.value?.id;
  if (!budgetId || !nextCursor.value) return;
  const seq = ++requestSeq;
  loadingMore.value = true;
  moreError.value = false;
  const firstNewIndex = items.value.length;
  try {
    const page = await feed.list(budgetId, {
      cursor: nextCursor.value,
      ...(actorFilter.value ? { actorId: actorFilter.value } : {}),
    });
    if (seq !== requestSeq) return;
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
    await nextTick();
    // Keyboard users continue from the first row that just appeared; rows without a link have no
    // button, so fall back to the row itself, then to the list, so focus never drops to the body.
    const rows = [
      ...(listEl.value?.querySelectorAll<HTMLElement>('[data-testid^="activity-row-"]') ?? []),
    ].slice(firstNewIndex);
    const target =
      rows
        .map((row) => row.querySelector<HTMLElement>('button'))
        .find((button) => button !== null) ??
      rows[0] ??
      listEl.value;
    if (target && !(target instanceof HTMLButtonElement)) target.tabIndex = -1;
    target?.focus();
  } catch {
    if (seq === requestSeq) moreError.value = true;
  } finally {
    if (seq === requestSeq) loadingMore.value = false;
  }
}

const statusText = computed(() => {
  if (loading.value) return 'Загружаем ленту…';
  if (loadError.value) return 'Не удалось загрузить ленту';
  if (items.value.length === 0) return 'Событий нет';
  return `Показано событий: ${items.value.length}`;
});

function changeFilter(_key: string, value: string): void {
  actorFilter.value = value;
  void load();
}

function resetFilter(): void {
  actorFilter.value = '';
  void load();
}

onMounted(load);
</script>

<template>
  <div class="activity-page">
    <span class="activity-page__sr" role="status" aria-live="polite">{{ statusText }}</span>
    <header class="activity-page__header">
      <p class="activity-page__eyebrow">Семья</p>
      <h1>Лента</h1>
      <p class="activity-page__subtitle">Что сделали другие участники за 30 дней</p>
    </header>

    <UiFilterBar
      v-if="people.length > 1"
      :chips="chips"
      :values="{ actor: actorFilter }"
      :can-reset="actorFilter !== ''"
      @change="changeFilter"
      @reset="resetFilter"
    />

    <UiEmptyState
      v-if="loadError"
      title="Не удалось загрузить ленту"
      description="Проверьте соединение и повторите."
    >
      <template #action>
        <UiButton data-testid="activity-retry" @click="load">Повторить</UiButton>
      </template>
    </UiEmptyState>
    <div v-else-if="loading" class="activity-page__loading" aria-busy="true">
      <UiSkeleton variant="row" :count="4" />
    </div>
    <UiEmptyState
      v-else-if="items.length === 0 && actorFilter"
      title="У этого участника нет событий за 30 дней"
      description="Выберите другого участника или сбросьте фильтр."
    />
    <UiEmptyState
      v-else-if="items.length === 0"
      title="За 30 дней семья ничего не меняла"
      description="Здесь появятся операции, платежи и события других участников."
    />
    <div v-else ref="listEl" class="activity-page__content" tabindex="-1">
      <section
        v-if="fresh.length > 0"
        class="activity-page__group"
        aria-labelledby="activity-new-title"
        data-testid="activity-new"
      >
        <h2 id="activity-new-title" class="activity-page__group-title">Новое</h2>
        <ul class="activity-page__list">
          <li v-for="item in fresh" :key="item.id"><ActivityRow :item="item" :now="now" /></li>
        </ul>
      </section>

      <div v-if="earlier.length > 0" class="activity-page__earlier" data-testid="activity-earlier">
        <h2 class="activity-page__divider">Ранее</h2>
        <section
          v-for="group in earlier"
          :key="group.key"
          class="activity-page__group"
          :aria-labelledby="`activity-day-${group.key}`"
        >
          <h3 :id="`activity-day-${group.key}`" class="activity-page__group-title">
            {{ group.label }}
          </h3>
          <ul class="activity-page__list">
            <li v-for="item in group.items" :key="item.id">
              <ActivityRow :item="item" :now="now" />
            </li>
          </ul>
        </section>
      </div>

      <p v-if="moreError" class="activity-page__more-error" role="alert">
        Не удалось загрузить ещё.
        <UiButton variant="tertiary" size="sm" data-testid="activity-more-retry" @click="loadMore">
          Повторить
        </UiButton>
      </p>
      <UiButton
        v-if="nextCursor"
        variant="secondary"
        class="activity-page__more"
        data-testid="activity-more"
        :disabled="loadingMore"
        @click="loadMore"
      >
        Показать ещё
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.activity-page {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 56rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}

.activity-page__header h1,
.activity-page__eyebrow,
.activity-page__subtitle {
  margin: 0;
}

.activity-page__header h1 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}

.activity-page__eyebrow {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.activity-page__subtitle {
  color: var(--hf-color-text-muted);
}

.activity-page__loading,
.activity-page__content,
.activity-page__earlier {
  display: grid;
  gap: var(--hf-space-4);
}

.activity-page__group {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.activity-page__group-title,
.activity-page__divider {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.activity-page__divider {
  color: var(--hf-color-text-muted);
}

.activity-page__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.activity-page__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.activity-page__more-error {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--hf-color-text-muted);
}

.activity-page__content:focus {
  outline: none;
}

.activity-page__more {
  justify-self: center;
}

@media (max-width: 47.9375rem) {
  .activity-page {
    padding: var(--hf-space-5);
  }
}
</style>
