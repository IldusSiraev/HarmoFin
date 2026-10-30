<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { Check } from '@lucide/vue';

import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';
import type { Member } from '../../composables/useFamily.js';
import type {
  CalendarEventInput,
  CalendarRecurrence,
} from '../../composables/useFamilyCalendar.js';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiSelect from '../ui/Select.vue';
import { isoWeekday } from './calendar-dates.js';
import {
  type EventFormState,
  formerParticipantsHint,
  RECURRENCE_LABELS,
  REMINDER_LABELS,
  type ReminderValue,
  toInput,
  validateForm,
  WEEKDAY_CHIPS,
} from './event-form-state.js';

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: 'create' | 'edit';
    initial: EventFormState;
    members: Member[];
    pending: boolean;
    serverErrors: Record<string, string>;
    /** Participants of the edited event; former members among them get a removal hint. */
    formerParticipants?: readonly PersonRef[];
  }>(),
  { formerParticipants: () => [] },
);
const emit = defineEmits<{
  close: [];
  submit: [input: CalendarEventInput];
}>();

const RECURRENCE_OPTIONS = (Object.keys(RECURRENCE_LABELS) as CalendarRecurrence[]).map(
  (value) => ({ value, label: RECURRENCE_LABELS[value] }),
);
// Explicit order: numeric-looking keys would otherwise come before the empty one.
const REMINDER_OPTIONS = (['', '15', '60', '1440', '10080'] as ReminderValue[]).map((value) => ({
  value,
  label: REMINDER_LABELS[value],
}));

// First invalid field gets focus, in the order the fields are shown.
const FOCUS_TARGETS: ReadonlyArray<[string, string]> = [
  ['title', 'calendarEventTitle-input'],
  ['date', 'calendarEventDate-input'],
  ['endDate', 'calendarEventEndDate-input'],
  ['startTime', 'calendarEventStart-input'],
  ['endTime', 'calendarEventEnd-input'],
  ['recurrence', 'calendarEventRecurrence-select'],
  ['weekdays', 'calendar-event-weekdays'],
  ['repeatUntil', 'calendarEventRepeatUntil-input'],
  ['participantUserIds', 'calendar-event-participants'],
  ['reminder', 'calendarEventReminder-select'],
  ['description', 'calendarEventDescription-input'],
];

function copy(source: EventFormState): EventFormState {
  return {
    ...source,
    weekdays: [...source.weekdays],
    participantUserIds: [...source.participantUserIds],
  };
}

const state = reactive<EventFormState>(copy(props.initial));
const errors = ref<Record<string, string>>({});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(state, copy(props.initial));
    errors.value = {};
  },
);

// Until the user picks weekly days, the default day follows the start date.
watch(
  () => state.date,
  (date) => {
    if (state.recurrence !== 'WEEKLY' && date) state.weekdays = [isoWeekday(date)];
  },
);
watch(
  () => state.recurrence,
  (recurrence) => {
    if (recurrence === 'WEEKLY' && state.weekdays.length === 0 && state.date) {
      state.weekdays = [isoWeekday(state.date)];
    }
  },
);

const title = computed(() => (props.mode === 'create' ? 'Новое событие' : 'Изменить событие'));
const repeating = computed(() => state.recurrence !== 'NONE');
const memberChips = computed(() =>
  props.members.map((member) => ({
    id: member.userId,
    label: member.displayName ?? member.email,
  })),
);
const removalHint = computed(() => formerParticipantsHint(props.formerParticipants));

function errorFor(field: string): string | undefined {
  return errors.value[field] ?? props.serverErrors[field];
}

function toggleWeekday(day: number): void {
  state.weekdays = state.weekdays.includes(day)
    ? state.weekdays.filter((value) => value !== day)
    : [...state.weekdays, day];
}

function toggleParticipant(userId: string): void {
  state.participantUserIds = state.participantUserIds.includes(userId)
    ? state.participantUserIds.filter((value) => value !== userId)
    : [...state.participantUserIds, userId];
}

function setRecurrence(value: string): void {
  state.recurrence = value as CalendarRecurrence;
}

function setReminder(value: string): void {
  state.reminder = value as ReminderValue;
}

function handleDescription(event: Event): void {
  state.description = (event.target as HTMLTextAreaElement).value;
}

function focusFirstError(found: Record<string, string>): void {
  const target = FOCUS_TARGETS.find(([field]) => found[field]);
  if (!target) return;
  void nextTick(() => {
    const element = document.getElementById(target[1]);
    const focusable = element?.matches('input, button, textarea')
      ? element
      : element?.querySelector<HTMLElement>('input, button');
    focusable?.focus();
  });
}

function submit(): void {
  const found = validateForm(state);
  errors.value = found;
  if (Object.keys(found).length > 0) {
    focusFirstError(found);
    return;
  }
  emit('submit', toInput(state));
}

watch(
  () => props.serverErrors,
  (found) => focusFirstError(found),
);
</script>

<template>
  <UiModal :open="open" :title="title" @close="emit('close')">
    <form class="event-form" novalidate data-testid="calendar-event-form" @submit.prevent="submit">
      <UiInput
        v-model="state.title"
        name="calendarEventTitle"
        label="Название"
        :maxlength="200"
        required
        :error="errorFor('title')"
      />

      <div class="event-form__switch-field">
        <button
          type="button"
          class="event-form__switch"
          role="switch"
          :aria-checked="state.allDay"
          aria-describedby="calendar-event-all-day-hint"
          data-testid="calendar-event-all-day"
          @click="state.allDay = !state.allDay"
        >
          <span class="event-form__switch-track" aria-hidden="true">
            <span class="event-form__switch-thumb" />
          </span>
          Весь день
        </button>
        <p id="calendar-event-all-day-hint" class="event-form__hint">
          Событие без времени начала и конца
        </p>
      </div>

      <div class="event-form__pair">
        <UiDatePicker
          v-model="state.date"
          name="calendarEventDate"
          label="Дата"
          required
          :error="errorFor('date')"
        />
        <UiDatePicker
          v-if="state.allDay"
          v-model="state.endDate"
          name="calendarEventEndDate"
          label="Дата окончания"
          hint="необязательно"
          :error="errorFor('endDate')"
        />
      </div>

      <div v-if="!state.allDay" class="event-form__pair" data-testid="calendar-event-times">
        <UiInput
          v-model="state.startTime"
          name="calendarEventStart"
          label="Начало"
          type="time"
          :step="300"
          required
          :error="errorFor('startTime')"
        />
        <UiInput
          v-model="state.endTime"
          name="calendarEventEnd"
          label="Конец"
          type="time"
          :step="300"
          required
          :error="errorFor('endTime')"
        />
      </div>

      <UiSelect
        :model-value="state.recurrence"
        name="calendarEventRecurrence"
        label="Повторять"
        :options="RECURRENCE_OPTIONS"
        :error="errorFor('recurrence')"
        @update:model-value="setRecurrence"
      />

      <div v-if="repeating" class="event-form__repeat" data-testid="calendar-event-repeat">
        <fieldset
          v-if="state.recurrence === 'WEEKLY'"
          id="calendar-event-weekdays"
          class="event-form__group"
          :aria-describedby="errorFor('weekdays') ? 'calendar-event-weekdays-error' : undefined"
        >
          <legend class="event-form__legend">Дни недели</legend>
          <div class="event-form__chips">
            <button
              v-for="(chip, index) in WEEKDAY_CHIPS"
              :key="chip"
              type="button"
              class="event-form__chip event-form__chip--day"
              :aria-pressed="state.weekdays.includes(index + 1)"
              :data-testid="`calendar-event-weekday-${index + 1}`"
              @click="toggleWeekday(index + 1)"
            >
              <Check
                v-if="state.weekdays.includes(index + 1)"
                :size="16"
                aria-hidden="true"
                data-testid="weekday-check"
              />
              {{ chip }}
            </button>
          </div>
          <p
            v-if="errorFor('weekdays')"
            id="calendar-event-weekdays-error"
            class="event-form__error"
          >
            {{ errorFor('weekdays') }}
          </p>
        </fieldset>
        <UiDatePicker
          v-model="state.repeatUntil"
          name="calendarEventRepeatUntil"
          label="Повторять до"
          hint="необязательно"
          :error="errorFor('repeatUntil')"
        />
      </div>

      <fieldset
        id="calendar-event-participants"
        class="event-form__group"
        :aria-describedby="
          [
            removalHint ? 'calendar-event-participants-hint' : '',
            errorFor('participantUserIds') ? 'calendar-event-participants-error' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        "
      >
        <legend class="event-form__legend">Участники</legend>
        <div class="event-form__chips">
          <button
            v-for="chip in memberChips"
            :key="chip.id"
            type="button"
            class="event-form__chip"
            :aria-pressed="state.participantUserIds.includes(chip.id)"
            :data-testid="`calendar-event-participant-${chip.id}`"
            @click="toggleParticipant(chip.id)"
          >
            <Check
              v-if="state.participantUserIds.includes(chip.id)"
              :size="16"
              aria-hidden="true"
              data-testid="calendar-event-participant-check"
            />
            {{ chip.label }}
          </button>
        </div>
        <p v-if="removalHint" id="calendar-event-participants-hint" class="event-form__hint">
          {{ removalHint }}
        </p>
        <p
          v-if="errorFor('participantUserIds')"
          id="calendar-event-participants-error"
          class="event-form__error"
        >
          {{ errorFor('participantUserIds') }}
        </p>
      </fieldset>

      <UiSelect
        :model-value="state.reminder"
        name="calendarEventReminder"
        label="Напоминание"
        :options="REMINDER_OPTIONS"
        :error="errorFor('reminder')"
        @update:model-value="setReminder"
      />

      <div class="event-form__field">
        <label class="event-form__label" for="calendarEventDescription-input">Описание</label>
        <textarea
          id="calendarEventDescription-input"
          class="event-form__textarea"
          :class="{ 'event-form__textarea--error': errorFor('description') }"
          name="calendarEventDescription"
          rows="3"
          maxlength="2000"
          :value="state.description"
          :aria-invalid="errorFor('description') ? 'true' : undefined"
          :aria-describedby="
            errorFor('description')
              ? 'calendarEventDescription-hint calendarEventDescription-error'
              : 'calendarEventDescription-hint'
          "
          @input="handleDescription"
        />
        <p id="calendarEventDescription-hint" class="event-form__hint">необязательно</p>
        <p
          v-if="errorFor('description')"
          id="calendarEventDescription-error"
          class="event-form__error"
        >
          {{ errorFor('description') }}
        </p>
      </div>
    </form>

    <template #footer>
      <UiButton variant="secondary" data-testid="calendar-event-cancel" @click="emit('close')">
        Отмена
      </UiButton>
      <UiButton :loading="pending" data-testid="calendar-event-submit" @click="submit">
        Сохранить событие
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.event-form {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.event-form__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--hf-space-4);
  align-items: start;
}

/* A single date picker spans the row instead of leaving an empty half. */
.event-form__pair > :only-child {
  grid-column: 1 / -1;
}

@media (max-width: 479px) {
  .event-form__pair {
    grid-template-columns: minmax(0, 1fr);
  }
}

.event-form__switch-field {
  display: grid;
  gap: var(--hf-space-1);
  justify-items: start;
}

.event-form__switch {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 44px;
  padding: var(--hf-space-1) var(--hf-space-2);
  margin-inline-start: calc(-1 * var(--hf-space-2));
  border: none;
  border-radius: var(--hf-radius-sm);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.event-form__switch:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.event-form__switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 2rem;
  height: 1.125rem;
  border-radius: 999px;
  background: var(--hf-color-border-strong);
  transition: background var(--hf-transition-fast);
}

.event-form__switch[aria-checked='true'] .event-form__switch-track {
  background: var(--hf-color-action-primary);
}

.event-form__switch-thumb {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--hf-color-surface);
  transition: transform var(--hf-transition-fast);
}

.event-form__switch[aria-checked='true'] .event-form__switch-thumb {
  transform: translateX(0.875rem);
}

.event-form__repeat {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-4);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  min-width: 0;
}

.event-form__group {
  display: grid;
  gap: var(--hf-space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.event-form__legend,
.event-form__label {
  padding: 0;
  margin-bottom: var(--hf-space-2);
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.event-form__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  min-width: 0;
}

.event-form__chip {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  max-width: 100%;
  padding: var(--hf-space-1) var(--hf-space-3);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: 999px;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.event-form__chip--day {
  padding-inline: var(--hf-space-2);
}

.event-form__chip:hover {
  border-color: var(--hf-color-action-primary);
}

.event-form__chip[aria-pressed='true'] {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-brand-soft);
  font-weight: var(--hf-font-weight-semibold);
}

.event-form__chip:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.event-form__field {
  display: grid;
  gap: var(--hf-space-2);
}

.event-form__label {
  margin-bottom: 0;
}

.event-form__textarea {
  width: 100%;
  min-height: 5.5rem;
  padding: var(--hf-space-3) var(--hf-control-padding-inline);
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
  resize: vertical;
}

.event-form__textarea--error {
  border-color: var(--hf-color-border-danger);
}

.event-form__textarea:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.event-form__hint,
.event-form__error {
  margin: 0;
  font-size: 0.875rem;
}

.event-form__hint {
  color: var(--hf-color-text-muted);
}

.event-form__error {
  color: var(--hf-color-text-danger);
}
</style>
