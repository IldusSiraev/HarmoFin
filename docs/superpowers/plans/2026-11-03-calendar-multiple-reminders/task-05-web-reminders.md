# Задача 5: чипы напоминаний в форме и строка в карточке

Перед началом прочитать [README](README.md) и [Calm Fintech visual guidelines](../../specs/2026-09-17-calm-fintech-visual-guidelines.md). Ветка — `feat/calendar-multiple-reminders`. Задачи 1–4 закоммичены.

**Files:**
- Modify: `apps/web/app/composables/useFamilyCalendar.ts` — типы.
- Modify: `apps/web/app/components/calendar/event-form-state.ts`
- Modify: `apps/web/app/components/calendar/CalendarEventForm.vue`
- Modify: `apps/web/app/components/calendar/CalendarEventDialog.vue`
- Modify: `apps/web/app/components/calendar/event-form-state.test.ts`
- Modify: `apps/web/app/components/calendar/CalendarEventForm.test.ts`
- Modify: `apps/web/app/components/calendar/CalendarEventDialog.test.ts`
- Modify: `apps/web/app/composables/useFamilyCalendar.test.ts`
- Modify: `apps/web/app/pages/app/calendar.test.ts`

**Interfaces:**
- Consumes (задача 2): ответ события содержит `reminders: number[]` по возрастанию и устаревшее `reminderMinutes`. Тело `POST` и `PATCH` принимает `reminders`; ошибки приходят в `fieldErrors` с полем `reminders` или `reminders.<индекс>`.
- Produces (из `event-form-state.ts`):
  - `REMINDER_OFFSETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]`, `MAX_REMINDERS = 3`;
  - `REMINDER_LABELS: Record<number, string>` — подписи чипов;
  - `remindersLabel(reminders: readonly number[]): string` — строка карточки;
  - `EventFormState.reminders: number[]` вместо `reminder`;
  - `CalendarEventInput.reminders: number[]` вместо `reminderMinutes`.

UI-правила (из спецификации):
- поле «Напоминания» — набор чипов в том же стиле и с той же разметкой, что «Участники»: `button` с `aria-pressed` и галочкой `Check` у выбранного;
- подсказка — «Можно выбрать до трёх»; при трёх выбранных остальные чипы `disabled`, подсказка — «Выбрано три — снимите одно, чтобы выбрать другое»;
- для «весь день» к подсказке добавляется «Отсчёт от 09:00 дня события»;
- ошибка сервера показывается под полем;
- в карточке — «За 1 день, за 1 час, в момент начала» (от самого раннего к позднему) или «Без напоминания».

---

- [ ] **Step 1: Типы**

В `apps/web/app/composables/useFamilyCalendar.ts`:

1. В `CalendarEventInput` строки

```ts
  participantUserIds: string[];
  reminderMinutes: number | null;
}
```

заменить на

```ts
  participantUserIds: string[];
  reminders: number[];
}
```

2. В `CalendarEventDto` строки

```ts
  repeatUntil: string | null;
  reminderMinutes: number | null;
  participants: PersonRef[];
```

заменить на

```ts
  repeatUntil: string | null;
  reminders: number[];
  /** Deprecated by the API: the smallest of `reminders`; the web reads `reminders` only. */
  reminderMinutes: number | null;
  participants: PersonRef[];
```

- [ ] **Step 2: Падающие тесты состояния формы**

В `apps/web/app/components/calendar/event-form-state.test.ts`:

1. В импорт из `./event-form-state.js` добавить `remindersLabel` (по алфавиту, после `fromEvent`).
2. В тесте `starts on the given date with a one-hour slot and that weekday` строку `      reminder: '',` заменить на `      reminders: [],`.
3. В тесте `builds the API input, dropping fields the rule does not use`:
   - строку `      reminder: '60' as const,` заменить на `      reminders: [60, 15],`;
   - в объекте `toEqual` строку `      reminderMinutes: 60,` заменить на `      reminders: [15, 60],`.
4. В тесте `maps server paths onto form fields and unwraps API errors` в ожидаемом объекте строку `      reminder: 'Выберите напоминание из списка.',` заменить на `      reminders: 'Выберите напоминание из списка.',`. Элемент входа `{ field: 'reminderMinutes', ... }` оставить: он проверяет алиас старого поля.
5. В тесте `round-trips an event into the form`:
   - в объекте `event` после строки `      reminderMinutes: 60,` добавить строку `      reminders: [60],`;
   - в `toMatchObject` строку `      reminderMinutes: 60,` заменить на `      reminders: [60],`.
6. В тесте `drops former members from participants and explains it`:
   - в объекте `event` после строки `      reminderMinutes: null,` добавить строку `      reminders: [],`;
   - в `toMatchObject` строку `      reminder: '',` заменить на `      reminders: [],`.
7. В конец блока `describe('calendar event form', () => { ... })`, перед его закрывающей `});`, добавить:

```ts
  it('maps a reminder error of an item onto the reminders field', () => {
    expect(
      fieldErrorsFromProblem({
        fieldErrors: [{ field: 'reminders.1', message: 'Выберите напоминание из списка.' }],
      }),
    ).toEqual({ reminders: 'Выберите напоминание из списка.' });
  });

  it('refuses more than three reminders', () => {
    const state = { ...emptyForm('2026-11-03'), title: 'Врач', reminders: [0, 5, 15, 30] };
    expect(validateForm(state).reminders).toBe('Можно выбрать до трёх напоминаний.');
    expect(validateForm({ ...state, reminders: [0, 5, 15] }).reminders).toBeUndefined();
  });

  it('keeps only known reminders of an event, ascending', () => {
    const event = {
      title: 'Врач',
      description: null,
      allDay: true,
      date: '2026-11-03',
      endDate: '2026-11-03',
      startTime: null,
      endTime: null,
      recurrence: 'NONE',
      interval: 1,
      weekdays: [],
      repeatUntil: null,
      reminders: [1440, 45, 0],
      reminderMinutes: 0,
      participants: [],
    } as unknown as CalendarEventDto;
    expect(fromEvent(event).reminders).toEqual([0, 1440]);
  });

  it('describes the reminders of the card from the earliest one', () => {
    expect(remindersLabel([0, 60, 1440])).toBe('За 1 день, за 1 час, в момент начала');
    expect(remindersLabel([120])).toBe('За 2 часа');
    expect(remindersLabel([5, 10080])).toBe('За 1 неделю, за 5 мин');
    expect(remindersLabel([])).toBe('Без напоминания');
  });
```

- [ ] **Step 3: Запустить и увидеть падение**

```bash
pnpm --filter @harmofin/web exec vitest run app/components/calendar/event-form-state.test.ts
```

Ожидается: FAIL — нет `remindersLabel`, у состояния нет `reminders`.

- [ ] **Step 4: Состояние формы**

В `apps/web/app/components/calendar/event-form-state.ts`:

1. Удалить строку `export type ReminderValue = '' | '15' | '60' | '1440' | '10080';` и пустую строку после неё.

2. В `interface EventFormState` строку `  reminder: ReminderValue;` заменить на `  reminders: number[];`.

3. Блок `export const REMINDER_LABELS: Record<ReminderValue, string> = { ... };` целиком заменить на:

```ts
// Same list as apps/api/src/calendar/calendar.schemas.ts (REMINDER_OFFSETS): minutes before the
// start; an all-day event counts from 09:00 of its day.
export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080] as const;
export const MAX_REMINDERS = 3;

export const REMINDER_LABELS: Record<number, string> = {
  0: 'В момент начала',
  5: 'За 5 мин',
  15: 'За 15 мин',
  30: 'За 30 мин',
  60: 'За 1 час',
  120: 'За 2 часа',
  1440: 'За 1 день',
  2880: 'За 2 дня',
  10080: 'За 1 неделю',
};
```

4. Строку `const REMINDER_VALUES = new Set<string>(Object.keys(REMINDER_LABELS));` заменить на:

```ts
const isReminderOffset = (minutes: number): boolean => minutes in REMINDER_LABELS;
```

5. Строку `const FIELD_ALIASES: Record<string, string> = { reminderMinutes: 'reminder' };` заменить на:

```ts
const FIELD_ALIASES: Record<string, string> = { reminderMinutes: 'reminders' };
```

6. В `emptyForm` строку `    reminder: '',` заменить на `    reminders: [],`.

7. В `fromEvent`:
   - удалить строку `  const reminder = event.reminderMinutes === null ? '' : String(event.reminderMinutes);`;
   - строку `    reminder: REMINDER_VALUES.has(reminder) ? (reminder as ReminderValue) : '',` заменить на:

```ts
    reminders: [...new Set(event.reminders)].filter(isReminderOffset).sort((a, b) => a - b),
```

8. В `toInput` строку `    reminderMinutes: state.reminder === '' ? null : Number(state.reminder),` заменить на:

```ts
    reminders: [...state.reminders].sort((a, b) => a - b),
```

9. В `validateForm` перед последней строкой `  return errors;` добавить:

```ts
  if (state.reminders.length > MAX_REMINDERS) {
    errors.reminders = 'Можно выбрать до трёх напоминаний.';
  }
```

10. В конец файла добавить:

```ts
// The card line: «За 1 день, за 1 час, в момент начала» — the earliest reminder first.
export function remindersLabel(reminders: readonly number[]): string {
  const labels = [...new Set(reminders)]
    .filter(isReminderOffset)
    .sort((a, b) => b - a)
    .map((minutes, index) => {
      const label = REMINDER_LABELS[minutes]!;
      return index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1);
    });
  return labels.length > 0 ? labels.join(', ') : 'Без напоминания';
}
```

Запустить тест из шага 3 — PASS.

- [ ] **Step 5: Падающие тесты формы**

В `apps/web/app/components/calendar/CalendarEventForm.test.ts` тест `lists the reminders and keeps the description optional` целиком заменить на:

```ts
  const reminderChip = (wrapper: Wrapper, minutes: number) =>
    wrapper.get(`[data-testid="calendar-event-reminder-${minutes}"]`);

  it('offers reminder chips and keeps the description optional', async () => {
    const wrapper = mountForm();
    expect(wrapper.get('#calendar-event-reminders legend').text()).toBe('Напоминания');
    expect(
      wrapper.findAll('[data-testid^="calendar-event-reminder-"]').map((chip) => chip.text()),
    ).toEqual([
      'В момент начала',
      'За 5 мин',
      'За 15 мин',
      'За 30 мин',
      'За 1 час',
      'За 2 часа',
      'За 1 день',
      'За 2 дня',
      'За 1 неделю',
    ]);
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe('Можно выбрать до трёх');
    expect(wrapper.get('label[for="calendarEventDescription-input"]').text()).toBe('Описание');
    expect(wrapper.get('#calendarEventDescription-hint').text()).toBe('необязательно');

    await reminderChip(wrapper, 1440).trigger('click');
    await reminderChip(wrapper, 60).trigger('click');
    expect(reminderChip(wrapper, 60).attributes('aria-pressed')).toBe('true');
    expect(reminderChip(wrapper, 60).find('[data-testid="calendar-event-reminder-check"]').exists()).toBe(
      true,
    );
    expect(reminderChip(wrapper, 15).attributes('aria-pressed')).toBe('false');

    await wrapper.get('#calendarEventTitle-input').setValue('Врач');
    await wrapper.get('#calendarEventDescription-input').setValue(' Взять полис ');
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      reminders: [60, 1440],
      description: 'Взять полис',
    });
  });

  it('allows three reminders, then disables the rest until one is unpressed', async () => {
    const wrapper = mountForm();
    for (const minutes of [0, 15, 60]) await reminderChip(wrapper, minutes).trigger('click');
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe(
      'Выбрано три — снимите одно, чтобы выбрать другое',
    );
    expect(reminderChip(wrapper, 5).attributes('disabled')).toBeDefined();
    expect(reminderChip(wrapper, 60).attributes('disabled')).toBeUndefined();

    await reminderChip(wrapper, 15).trigger('click');
    expect(reminderChip(wrapper, 5).attributes('disabled')).toBeUndefined();
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe('Можно выбрать до трёх');
  });

  it('explains the 09:00 start of reminders for an all-day event', async () => {
    const wrapper = mountForm({ initial: { ...emptyForm('2026-11-03'), allDay: true } });
    expect(wrapper.get('#calendar-event-reminders-hint').text()).toBe(
      'Можно выбрать до трёх. Отсчёт от 09:00 дня события',
    );
  });

  it('shows a server reminder error under the chips and keeps the edited reminders', () => {
    const wrapper = mountForm({
      mode: 'edit',
      initial: { ...emptyForm('2026-11-03'), title: 'Кружок', reminders: [5, 120] },
      serverErrors: { reminders: 'Выберите напоминание из списка.' },
    });
    expect(wrapper.get('#calendar-event-reminders-error').text()).toBe(
      'Выберите напоминание из списка.',
    );
    expect(wrapper.get('#calendar-event-reminders').attributes('aria-describedby')).toBe(
      'calendar-event-reminders-hint calendar-event-reminders-error',
    );
    expect(reminderChip(wrapper, 5).attributes('aria-pressed')).toBe('true');
    expect(reminderChip(wrapper, 120).attributes('aria-pressed')).toBe('true');
  });
```

Функции `selectByName` и `choose` в этом файле остаются: их используют тесты повтора.

```bash
pnpm --filter @harmofin/web exec vitest run app/components/calendar/CalendarEventForm.test.ts
```

Ожидается: FAIL — чипов ещё нет.

- [ ] **Step 6: Форма**

В `apps/web/app/components/calendar/CalendarEventForm.vue`, в `<script setup>`:

1. В импорте из `./event-form-state.js` строки

```ts
  REMINDER_LABELS,
  type ReminderValue,
```

заменить на

```ts
  MAX_REMINDERS,
  REMINDER_LABELS,
  REMINDER_OFFSETS,
```

2. Блок

```ts
// Explicit order: numeric-looking keys would otherwise come before the empty one.
const REMINDER_OPTIONS = (['', '15', '60', '1440', '10080'] as ReminderValue[]).map((value) => ({
  value,
  label: REMINDER_LABELS[value],
}));
```

удалить целиком.

3. В `FOCUS_TARGETS` строку `  ['reminder', 'calendarEventReminder-select'],` заменить на `  ['reminders', 'calendar-event-reminders'],`.

4. В `copy` после строки `    participantUserIds: [...source.participantUserIds],` добавить строку `    reminders: [...source.reminders],`.

5. Функцию

```ts
function setReminder(value: string): void {
  state.reminder = value as ReminderValue;
}
```

заменить на

```ts
function toggleReminder(minutes: number): void {
  if (state.reminders.includes(minutes)) {
    state.reminders = state.reminders.filter((value) => value !== minutes);
  } else if (state.reminders.length < MAX_REMINDERS) {
    state.reminders = [...state.reminders, minutes];
  }
}
```

6. После строки `const removalHint = computed(() => formerParticipantsHint(props.formerParticipants));` добавить:

```ts
const remindersFull = computed(() => state.reminders.length >= MAX_REMINDERS);
const remindersHint = computed(() => {
  const limit = remindersFull.value
    ? 'Выбрано три — снимите одно, чтобы выбрать другое'
    : 'Можно выбрать до трёх';
  return state.allDay ? `${limit}. Отсчёт от 09:00 дня события` : limit;
});
```

В `<template>` блок

```vue
      <UiSelect
        :model-value="state.reminder"
        name="calendarEventReminder"
        label="Напоминание"
        :options="REMINDER_OPTIONS"
        :error="errorFor('reminder')"
        @update:model-value="setReminder"
      />
```

заменить на

```vue
      <fieldset
        id="calendar-event-reminders"
        class="event-form__group"
        :aria-describedby="
          errorFor('reminders')
            ? 'calendar-event-reminders-hint calendar-event-reminders-error'
            : 'calendar-event-reminders-hint'
        "
      >
        <legend class="event-form__legend">Напоминания</legend>
        <div class="event-form__chips">
          <button
            v-for="minutes in REMINDER_OFFSETS"
            :key="minutes"
            type="button"
            class="event-form__chip"
            :aria-pressed="state.reminders.includes(minutes)"
            :disabled="remindersFull && !state.reminders.includes(minutes)"
            :data-testid="`calendar-event-reminder-${minutes}`"
            @click="toggleReminder(minutes)"
          >
            <Check
              v-if="state.reminders.includes(minutes)"
              :size="16"
              aria-hidden="true"
              data-testid="calendar-event-reminder-check"
            />
            {{ REMINDER_LABELS[minutes] }}
          </button>
        </div>
        <p id="calendar-event-reminders-hint" class="event-form__hint">{{ remindersHint }}</p>
        <p
          v-if="errorFor('reminders')"
          id="calendar-event-reminders-error"
          class="event-form__error"
        >
          {{ errorFor('reminders') }}
        </p>
      </fieldset>
```

В `<style>` после правила `.event-form__chip:focus-visible { ... }` добавить:

```css
.event-form__chip:disabled {
  border-color: var(--hf-color-border);
  color: var(--hf-color-text-muted);
  cursor: not-allowed;
}

.event-form__chip:disabled:hover {
  border-color: var(--hf-color-border);
}
```

Компонент `UiSelect` в файле остаётся: его использует «Повторять».

```bash
pnpm --filter @harmofin/web exec vitest run app/components/calendar/CalendarEventForm.test.ts
```

Ожидается: PASS.

- [ ] **Step 7: Карточка события**

В `apps/web/app/components/calendar/CalendarEventDialog.test.ts`:

1. В объекте `circle` после строки `  reminderMinutes: 60,` добавить строку `  reminders: [60],`.
2. В тесте `describes the repeat, participants, reminder, author and description` строку `    expect(reminder).toContain('Напоминание');` заменить на `    expect(reminder).toContain('Напоминания');`.
3. В тесте `shows the date and time of a one-off event without a reminder` после строки `      reminderMinutes: null,` добавить строку `      reminders: [],`.
4. После теста `shows the date and time of a one-off event without a reminder` добавить:

```ts
  it('lists several reminders from the earliest one', () => {
    const wrapper = mountDialog({ ...circle, reminders: [0, 60, 1440], reminderMinutes: 0 });
    expect(wrapper.get('[data-testid="calendar-event-reminder"]').text()).toContain(
      'За 1 день, за 1 час, в момент начала',
    );
  });
```

В `apps/web/app/components/calendar/CalendarEventDialog.vue`:

1. Импорт

```ts
import {
  describeRecurrence,
  describeWhen,
  REMINDER_LABELS,
  type ReminderValue,
  repeatUntilLabel,
} from './event-form-state.js';
```

заменить на

```ts
import {
  describeRecurrence,
  describeWhen,
  remindersLabel,
  repeatUntilLabel,
} from './event-form-state.js';
```

2. Блок

```ts
const reminder = computed(() => {
  const minutes = props.event?.reminderMinutes;
  const key = (minutes === null || minutes === undefined ? '' : String(minutes)) as ReminderValue;
  return REMINDER_LABELS[key] ?? REMINDER_LABELS[''];
});
```

заменить на

```ts
const reminder = computed(() => remindersLabel(props.event?.reminders ?? []));
```

3. В шаблоне строку `            <span class="event-card__caption">Напоминание</span>` заменить на `            <span class="event-card__caption">Напоминания</span>`.

- [ ] **Step 8: Остальные фикстуры**

1. `apps/web/app/composables/useFamilyCalendar.test.ts`: во входе события строку `  reminderMinutes: 60,` заменить на `  reminders: [60],`.
2. `apps/web/app/pages/app/calendar.test.ts`:
   - в фикстуре события (за строкой `  reminderMinutes: null,` идёт `  participants: [ildar, alia],`) после `  reminderMinutes: null,` добавить строку `  reminders: [],`;
   - в объекте `input` (за строкой `  reminderMinutes: null,` идёт `};`) строку `  reminderMinutes: null,` заменить на `  reminders: [],`.

Затем проверить, что старых ссылок не осталось:

```bash
grep -rn "ReminderValue\|calendarEventReminder\|state.reminder\b" apps/web/app || echo "clean"
```

Ожидается: `clean`.

- [ ] **Step 9: Проверки и stage**

```bash
pnpm --filter @harmofin/web test
pnpm typecheck
pnpm lint
pnpm exec prettier --check apps/web/app/components/calendar apps/web/app/composables/useFamilyCalendar.ts apps/web/app/composables/useFamilyCalendar.test.ts apps/web/app/pages/app/calendar.test.ts
git add apps/web/app/components/calendar apps/web/app/composables/useFamilyCalendar.ts apps/web/app/composables/useFamilyCalendar.test.ts apps/web/app/pages/app/calendar.test.ts
git status --short
```

Ожидается: всё PASS, у `lint` 0 errors.

**Review:** UI/UX (чипы в стиле участников, `aria-pressed` и галочка, `disabled` с текстовой подсказкой, `aria-describedby`, контраст `disabled` на существующих токенах, фокус на поле при ошибке), QA (лимит трёх, «весь день», правка, ошибка сервера, карточка), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(web): до трёх напоминаний в форме события календаря"
```
