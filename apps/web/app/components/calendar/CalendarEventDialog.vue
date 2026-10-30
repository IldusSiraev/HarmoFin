<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Bell, CalendarDays, Info, Pencil, Repeat, Users, X } from '@lucide/vue';

import type { CalendarEventDto } from '../../composables/useFamilyCalendar.js';
import { authorLabel } from '../operations/author-label.js';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiButton from '../ui/Button.vue';
import UiConfirmDialog from '../ui/ConfirmDialog.vue';
import UiModal from '../ui/Modal.vue';
import {
  describeRecurrence,
  describeWhen,
  REMINDER_LABELS,
  type ReminderValue,
  repeatUntilLabel,
} from './event-form-state.js';
import { participantsLabel } from './participants-label.js';

const props = defineProps<{
  open: boolean;
  event: CalendarEventDto | null;
  activeMemberIds: ReadonlySet<string>;
  deleting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  edit: [];
  delete: [];
}>();

const confirmOpen = ref(false);

watch(
  () => [props.open, props.event?.id] as const,
  () => {
    confirmOpen.value = false;
  },
);
// A failed delete leaves the card open: close the confirmation so the error is visible.
watch(
  () => props.deleting,
  (deleting, wasDeleting) => {
    if (wasDeleting && !deleting) confirmOpen.value = false;
  },
);

const repeating = computed(() => props.event !== null && props.event.recurrence !== 'NONE');
const when = computed(() => {
  const event = props.event;
  if (!event) return '';
  return event.recurrence === 'NONE' ? describeWhen(event) : describeRecurrence(event);
});
const participants = computed(() =>
  props.event ? participantsLabel(props.event.participants, props.activeMemberIds) : '',
);
const reminder = computed(() => {
  const minutes = props.event?.reminderMinutes;
  const key = (minutes === null || minutes === undefined ? '' : String(minutes)) as ReminderValue;
  return REMINDER_LABELS[key] ?? REMINDER_LABELS[''];
});
const author = computed(() => (props.event ? authorLabel(props.event.createdBy) : ''));

function confirmDelete(): void {
  emit('delete');
}

const actions = ref<HTMLElement | null>(null);

// The menu item that opened the confirmation is gone by now, so focus goes back to the menu
// trigger once the confirmation dialog has closed.
function cancelDelete(): void {
  if (props.deleting) return;
  confirmOpen.value = false;
  void nextTick(() => {
    actions.value?.querySelector<HTMLElement>('[data-testid="calendar-event-menu"]')?.focus();
  });
}
</script>

<template>
  <UiModal :open="open" :title="event?.title ?? ''" size="sm" @close="emit('close')">
    <template #header>
      <h2 class="event-card__title modal__title">{{ event?.title ?? '' }}</h2>
      <div ref="actions" class="event-card__actions">
        <template v-if="event?.canEdit">
          <UiButton
            variant="tertiary"
            size="sm"
            aria-label="Изменить событие"
            tooltip="Изменить"
            tooltip-placement="bottom"
            data-testid="calendar-event-edit"
            @click="emit('edit')"
          >
            <Pencil :size="18" aria-hidden="true" />
          </UiButton>
          <UiActionMenu
            label="Действия с событием"
            tooltip="Действия"
            tooltip-placement="bottom"
            trigger-test-id="calendar-event-menu"
          >
            <button
              type="button"
              role="menuitem"
              class="event-card__menu-item"
              data-testid="calendar-event-delete"
              @click="confirmOpen = true"
            >
              Удалить
            </button>
          </UiActionMenu>
        </template>
        <button
          type="button"
          class="event-card__close"
          data-testid="modal-close"
          aria-label="Закрыть"
          @click="emit('close')"
        >
          <X :size="22" aria-hidden="true" />
        </button>
      </div>
    </template>

    <div v-if="event" class="event-card">
      <ul class="event-card__rows">
        <li class="event-card__row" data-testid="calendar-event-when">
          <span class="event-card__icon" aria-hidden="true">
            <Repeat v-if="repeating" :size="18" />
            <CalendarDays v-else :size="18" />
          </span>
          <span class="event-card__text">
            <span class="event-card__main">{{ when }}</span>
            <span v-if="repeating && event.repeatUntil" class="event-card__caption">
              {{ repeatUntilLabel(event.repeatUntil) }}
            </span>
          </span>
        </li>
        <li v-if="participants" class="event-card__row" data-testid="calendar-event-participants">
          <span class="event-card__icon" aria-hidden="true"><Users :size="18" /></span>
          <span class="event-card__text">
            <span class="event-card__main">{{ participants }}</span>
            <span class="event-card__caption">Участники</span>
          </span>
        </li>
        <li class="event-card__row" data-testid="calendar-event-reminder">
          <span class="event-card__icon" aria-hidden="true"><Bell :size="18" /></span>
          <span class="event-card__text">
            <span class="event-card__main">{{ reminder }}</span>
            <span class="event-card__caption">Напоминание</span>
          </span>
        </li>
      </ul>

      <p v-if="event.canEdit" class="event-card__author" data-testid="calendar-event-author">
        Автор: {{ author }}
      </p>
      <p v-else class="event-card__notice" data-testid="calendar-event-readonly">
        <Info :size="18" aria-hidden="true" class="event-card__notice-icon" />
        <span>Автор: {{ author }}. Изменять событие может только автор</span>
      </p>

      <section v-if="event.description" class="event-card__description">
        <h3 class="event-card__section-title">Описание</h3>
        <p class="event-card__description-text" data-testid="calendar-event-description">
          {{ event.description }}
        </p>
      </section>
    </div>

    <UiConfirmDialog
      :open="confirmOpen"
      title="Удалить событие и все его повторы?"
      description="Уже созданные напоминания останутся в центре уведомлений."
      confirm-label="Удалить"
      cancel-label="Отмена"
      variant="danger"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </UiModal>
</template>

<style scoped>
.event-card__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.25rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.event-card__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--hf-space-1);
  align-items: center;
}

.event-card__close {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: var(--hf-space-2);
  color: var(--hf-color-text);
  border: none;
  border-radius: var(--hf-control-radius);
  background: transparent;
  cursor: pointer;
}

.event-card__close:hover {
  background: var(--hf-color-action-secondary-hover);
}

.event-card__close:focus-visible,
.event-card__menu-item:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: -2px;
}

.event-card__menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 2.75rem;
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 0;
  border-radius: var(--hf-radius-sm);
  background: transparent;
  color: var(--hf-color-text-danger);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.event-card__menu-item:hover {
  background: var(--hf-color-surface-subtle);
}

.event-card {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.event-card__rows {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.event-card__row {
  display: flex;
  gap: var(--hf-space-3);
  align-items: flex-start;
  min-width: 0;
}

.event-card__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.event-card__text {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
  padding-top: 0.375rem;
}

.event-card__main {
  color: var(--hf-color-text);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}

.event-card__caption,
.event-card__author {
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}

.event-card__author {
  margin: 0;
}

.event-card__notice {
  display: flex;
  gap: var(--hf-space-2);
  align-items: flex-start;
  margin: 0;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
}

.event-card__notice-icon {
  flex: 0 0 auto;
  margin-top: 0.0625rem;
}

.event-card__description {
  display: grid;
  gap: var(--hf-space-1);
  padding-top: var(--hf-space-4);
  border-top: 1px solid var(--hf-color-border);
}

.event-card__section-title {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text-muted);
}

.event-card__description-text {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
</style>
