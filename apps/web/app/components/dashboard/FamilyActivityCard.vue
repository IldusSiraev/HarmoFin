<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import ActivityRow from '../activity/ActivityRow.vue';
import { unseenShort } from '../activity/activity-phrases.js';
import UiMoreLink from '../ui/MoreLink.vue';
import UiStatus from '../ui/Status.vue';
import { type ActivityFeedResponse, useActivityFeed } from '../../composables/useActivityFeed.js';

defineOptions({ name: 'FamilyActivityCard' });

const props = defineProps<{ budgetId: string }>();

const feed = useActivityFeed();
const state = ref<ActivityFeedResponse | null>(null);
const now = ref(new Date());

// The dashboard must not break because of the feed: a failed read just hides the card.
async function load(): Promise<void> {
  try {
    now.value = new Date();
    state.value = await feed.list(props.budgetId, { limit: 5 });
  } catch {
    state.value = null;
  }
}

onMounted(load);
watch(() => props.budgetId, load);

const visible = computed(() => (state.value?.people.length ?? 0) > 0);
</script>

<template>
  <section
    v-if="visible && state"
    class="family-activity"
    aria-labelledby="family-activity-title"
    data-testid="family-activity-card"
  >
    <header class="family-activity__header">
      <div>
        <h2 id="family-activity-title">Что нового в семье</h2>
        <p class="family-activity__subtitle">Действия других участников</p>
      </div>
      <div class="family-activity__aside">
        <UiStatus
          v-if="state.unseenCount > 0"
          :label="unseenShort(state.unseenCount)"
          tone="info"
        />
        <UiMoreLink to="/app/activity">Все события</UiMoreLink>
      </div>
    </header>

    <p v-if="state.items.length === 0" class="family-activity__empty">
      Пока тихо — семья ничего не меняла.
    </p>
    <ul v-else class="family-activity__list">
      <li v-for="item in state.items" :key="item.id">
        <ActivityRow :item="item" :now="now" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.family-activity {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.family-activity__header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}

.family-activity__header h2 {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.family-activity__subtitle {
  margin: var(--hf-space-1) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.family-activity__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.family-activity__aside {
  display: inline-flex;
  gap: var(--hf-space-3);
  align-items: center;
}

.family-activity__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
