# UI foundation HarmoFin

**Дата:** 02.09.2026  
**Статус:** согласовано к использованию при проектировании и реализации UI  
**Область:** web UI tokens, типографика, responsive layout, accessibility, правила логотипа и контракты будущих Vue-компонентов

## 1. Цель и границы

UI foundation задаёт единый визуальный и технический язык HarmoFin до проектирования экранов Этапа 2. Он связывает фирменную основу из `identity/logo_description.png` с семантическими CSS-токенами и контрактами компонентов, но не превращается в полный маркетинговый брендбук.

Foundation применяется к Nuxt 4/Vue 3 web app. Он определяет:

- слои и точные имена design tokens;
- палитру, типографику, интервалы, размеры, радиусы, тени и движение;
- responsive и accessibility rules;
- допустимые варианты логотипа;
- границы base UI и financial presentation components;
- loading, empty, error, success и disabled states;
- правила русскоязычного интерфейсного текста;
- порядок внедрения в существующий auth UI и будущий settings UI.

В документ не входят маркетинговые и печатные носители, новый дизайн логотипа, dark theme, dashboard, бизнес-правила финансов, API/schema Этапа 2 или реализация всех описанных компонентов заранее.

## 2. Принятый подход

Используется token-first foundation без Tailwind, готовой UI-библиотеки, Storybook и отдельного workspace package.

Источник истины — CSS custom properties в web app. Зависимость слоёв односторонняя:

```text
brand и primitive tokens
  -> semantic tokens
    -> component tokens
      -> component/page styles
```

Правила:

1. Brand и supporting palette содержат конкретные значения.
2. Semantic tokens описывают назначение, а не цвет: `text-primary`, `action-primary`, `feedback-danger`.
3. Компонентный слой вводится только при реальной компонентной вариации. Он ссылается на semantic tokens и не копирует hex.
4. Vue-компоненты и страницы не используют прямые brand hex, произвольные размеры или локальные копии общих состояний.
5. Исключение для прямых значений допускается только внутри token source of truth и для прозрачности через `rgb(... / alpha)` в том же файле.
6. Компоненты создаются по мере появления реального потребителя. Контракт в этом документе не является требованием заранее создать весь каталог.

Планируемые файлы при внедрении:

- `apps/web/app/assets/styles/tokens.css` — primitive, semantic и shared component tokens;
- `apps/web/app/assets/styles/base.css` — reset, document defaults, typography и global focus/reduced-motion rules;
- `apps/web/app/components/ui/` — независимые UI primitives;
- доменные presentation components — в тематических каталогах `components/finance/`, `components/accounts/`, `components/envelopes/`.

Global styles подключаются через `apps/web/nuxt.config.ts`. Shared contracts остаются внутри web app: design tokens и Vue-компоненты не переносятся в client/server shared packages.

## 3. Цветовая система

### 3.1. Brand palette

Исходные цвета не переименовываются и не подменяются:

```css
--hf-color-brand-navy: #0d1b2a;
--hf-color-brand-teal: #1ba39c;
--hf-color-brand-green: #22a06b;
--hf-color-brand-blue: #2c5b8a;
--hf-color-brand-mint: #73c6b6;
--hf-color-brand-light: #f2f4f7;
--hf-color-white: #ffffff;
```

Brand Teal и Green подходят для крупных акцентов, графики и некоторых non-text boundaries, но не для обычного белого текста: контраст Teal/White — около `3.10:1`, Green/White — около `3.33:1`. Поэтому primary controls используют более тёмный supporting teal, а не Brand Teal напрямую.

Supporting palette:

```css
--hf-color-teal-700: #126d68;
--hf-color-teal-800: #0e5c58;
--hf-color-teal-900: #0b4e4b;
--hf-color-slate-50: #f8fafc;
--hf-color-slate-200: #e2e8f0;
--hf-color-slate-300: #cbd5e1;
--hf-color-slate-500: #64748b;
--hf-color-slate-600: #475569;
--hf-color-slate-700: #334155;
--hf-color-control-border: #7a8998;
--hf-color-success-foreground: #146c4b;
--hf-color-success-background: #e8f7f0;
--hf-color-danger-foreground: #9b372c;
--hf-color-danger-strong: #7f2d25;
--hf-color-danger-background: #fff1ef;
--hf-color-warning-foreground: #6b4e00;
--hf-color-warning-background: #fff6d8;
--hf-color-info-background: #eef5fb;
```

Supporting values расширяют фирменную палитру только для читаемых интерактивных и feedback states. Они не считаются новыми цветами логотипа.

### 3.2. Semantic colors

```css
--hf-color-surface-canvas: var(--hf-color-brand-light);
--hf-color-surface-default: var(--hf-color-white);
--hf-color-surface-subtle: var(--hf-color-slate-50);
--hf-color-surface-disabled: var(--hf-color-slate-200);
--hf-color-surface-inverse: var(--hf-color-brand-navy);
--hf-color-surface-overlay: rgb(13 27 42 / 64%);

--hf-color-text-primary: var(--hf-color-brand-navy);
--hf-color-text-secondary: var(--hf-color-slate-600);
--hf-color-text-muted: var(--hf-color-slate-500);
--hf-color-text-disabled: var(--hf-color-slate-500);
--hf-color-text-inverse: var(--hf-color-white);
--hf-color-text-link: var(--hf-color-teal-700);
--hf-color-text-link-hover: var(--hf-color-teal-800);

--hf-color-border-subtle: var(--hf-color-slate-300);
--hf-color-border-control: var(--hf-color-control-border);
--hf-color-border-strong: var(--hf-color-slate-700);

--hf-color-action-primary: var(--hf-color-teal-700);
--hf-color-action-primary-hover: var(--hf-color-teal-800);
--hf-color-action-primary-active: var(--hf-color-teal-900);
--hf-color-action-primary-text: var(--hf-color-white);
--hf-color-action-secondary: var(--hf-color-white);
--hf-color-action-secondary-hover: var(--hf-color-slate-50);
--hf-color-action-secondary-text: var(--hf-color-brand-navy);
--hf-color-action-danger: var(--hf-color-danger-foreground);
--hf-color-action-danger-hover: var(--hf-color-danger-strong);
--hf-color-action-disabled: var(--hf-color-slate-200);
--hf-color-action-disabled-text: var(--hf-color-slate-500);

--hf-color-feedback-success: var(--hf-color-success-foreground);
--hf-color-feedback-success-surface: var(--hf-color-success-background);
--hf-color-feedback-danger: var(--hf-color-danger-foreground);
--hf-color-feedback-danger-surface: var(--hf-color-danger-background);
--hf-color-feedback-warning: var(--hf-color-warning-foreground);
--hf-color-feedback-warning-surface: var(--hf-color-warning-background);
--hf-color-feedback-info: var(--hf-color-brand-blue);
--hf-color-feedback-info-surface: var(--hf-color-info-background);

--hf-color-focus-ring: var(--hf-color-teal-700);
--hf-color-focus-halo: var(--hf-color-white);
```

Проверенные пары foreground/background превышают `4.5:1`: primary action/white — около `6.15:1`, success — `5.80:1`, danger — `6.41:1`, warning — `7.16:1`, info — `6.43:1`.

Focus indicator двухцветный: внутренний светлый halo и внешний `focus-ring`. На светлой поверхности заметен тёмный контур, на тёмной — светлый separation ring. Удалять browser outline можно только при полном эквиваленте этого indicator.

### 3.3. Shared component aliases

Минимальный component layer фиксирует общие control surfaces и не дублирует semantic values:

```css
--hf-focus-indicator: 0 0 0 2px var(--hf-color-focus-halo),
  0 0 0 5px var(--hf-color-focus-ring);

--hf-button-primary-background: var(--hf-color-action-primary);
--hf-button-primary-background-hover: var(--hf-color-action-primary-hover);
--hf-button-primary-background-active: var(--hf-color-action-primary-active);
--hf-button-primary-foreground: var(--hf-color-action-primary-text);
--hf-button-secondary-background: var(--hf-color-action-secondary);
--hf-button-secondary-background-hover: var(--hf-color-action-secondary-hover);
--hf-button-secondary-foreground: var(--hf-color-action-secondary-text);
--hf-button-danger-background: var(--hf-color-action-danger);
--hf-button-danger-background-hover: var(--hf-color-action-danger-hover);
--hf-button-disabled-background: var(--hf-color-action-disabled);
--hf-button-disabled-foreground: var(--hf-color-action-disabled-text);

--hf-control-background: var(--hf-color-surface-default);
--hf-control-foreground: var(--hf-color-text-primary);
--hf-control-border: var(--hf-color-border-control);
--hf-control-border-error: var(--hf-color-feedback-danger);
--hf-control-placeholder: var(--hf-color-text-muted);

--hf-card-background: var(--hf-color-surface-default);
--hf-card-border: var(--hf-color-border-subtle);
--hf-dialog-background: var(--hf-color-surface-default);
--hf-dialog-overlay: var(--hf-color-surface-overlay);
```

Новый component token добавляется только когда минимум два состояния или варианта одного component должны изменяться согласованно. Page-specific aliases не добавляются в global tokens.

### 3.4. Использование цвета

- Цвет не является единственным способом передать status, ошибку, выбранное состояние или изменение баланса.
- Отрицательное значение сохраняет знак и получает явный текстовый status там, где status нужен пользователю.
- Archived state всегда содержит слово `Архив` или `В архиве`.
- Cards используют `surface-default`; canvas — `surface-canvas`.
- Essential control boundaries используют `border-control`, контраст которого с белым около `3.58:1`. `border-subtle` допустим только для несущественного разделения уже различимых областей.
- Brand gradients используются только в крупных brand/decorative surfaces. Они не служат фоном для длинного текста и не вводят новые цвета вне утверждённой палитры.

## 4. Типографика

Основной шрифт — Inter с кириллицей. Web implementation должен self-host versioned WOFF2 assets; remote Google Fonts или другой runtime-запрос к font CDN не используется. Разрешённые веса: `400`, `500`, `600`, `700`.

```css
--hf-font-family-sans: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
--hf-font-weight-regular: 400;
--hf-font-weight-medium: 500;
--hf-font-weight-semibold: 600;
--hf-font-weight-bold: 700;

--hf-font-size-xs: 0.75rem;   /* 12 px */
--hf-font-size-sm: 0.875rem;  /* 14 px */
--hf-font-size-md: 1rem;      /* 16 px */
--hf-font-size-lg: 1.25rem;   /* 20 px */
--hf-font-size-xl: 1.5rem;    /* 24 px */
--hf-font-size-2xl: 2rem;     /* 32 px */
--hf-font-size-3xl: 2.5rem;   /* 40 px */
--hf-font-size-4xl: 3rem;     /* 48 px */

--hf-line-height-tight: 1.15;
--hf-line-height-heading: 1.25;
--hf-line-height-body: 1.5;
--hf-line-height-relaxed: 1.65;

--hf-letter-spacing-tight: -0.02em;
--hf-letter-spacing-display: -0.04em;
--hf-letter-spacing-caps: 0.12em;
```

Правила:

- Base body — `16px/1.5`.
- Обычный interactive text не меньше `14px`; поясняющий metadata text может быть `12px`, если не является единственным label или action.
- Heading levels отражают структуру документа, а размер задаётся отдельно. Нельзя выбирать `h2` вместо `h1` ради размера.
- Веса `750`, `800` и `900` не используются: существующие значения мигрируют на `700`.
- Display tracking не должен быть плотнее `-0.04em`; существующее `-0.07em` мигрирует.
- Денежные значения используют tabular numerals через `font-variant-numeric: tabular-nums`.

## 5. Интервалы, размеры, форма и elevation

### 5.1. Spacing

Базовый шаг — `4px`:

```css
--hf-space-0: 0;
--hf-space-1: 0.25rem;
--hf-space-2: 0.5rem;
--hf-space-3: 0.75rem;
--hf-space-4: 1rem;
--hf-space-5: 1.25rem;
--hf-space-6: 1.5rem;
--hf-space-8: 2rem;
--hf-space-10: 2.5rem;
--hf-space-12: 3rem;
--hf-space-16: 4rem;
```

Произвольные промежуточные значения допустимы только для mathematically required positioning иллюстрации, не для обычного layout.

### 5.2. Controls и content widths

```css
--hf-control-height-sm: 2.75rem; /* 44 px */
--hf-control-height-md: 3rem;    /* 48 px */
--hf-control-height-lg: 3.25rem; /* 52 px */
--hf-icon-size-sm: 1rem;
--hf-icon-size-md: 1.25rem;
--hf-icon-size-lg: 1.5rem;
--hf-content-width: 70rem;
--hf-form-width: 28rem;
```

Все interactive targets имеют минимум `44x44px`. Визуально маленькая icon action расширяет hit area до этого размера.

### 5.3. Radius и shadows

```css
--hf-radius-control: 0.25rem; /* 4 px */
--hf-radius-card: 0.5rem;     /* 8 px */
--hf-radius-dialog: 0.75rem;  /* 12 px */
--hf-radius-pill: 999px;

--hf-shadow-sm: 0 1px 2px rgb(13 27 42 / 8%);
--hf-shadow-md: 0 8px 24px rgb(13 27 42 / 10%);
--hf-shadow-lg: 0 18px 48px rgb(13 27 42 / 14%);
```

Тень показывает elevation, а не status. Inputs и обычные static cards не получают сильную тень. Modal использует overlay и `shadow-lg`.

### 5.4. Motion и stacking

```css
--hf-duration-fast: 120ms;
--hf-duration-base: 180ms;
--hf-duration-slow: 240ms;
--hf-easing-standard: cubic-bezier(0.2, 0, 0, 1);
--hf-z-sticky: 10;
--hf-z-overlay: 100;
--hf-z-dialog: 110;
--hf-z-toast: 120;
```

Animation применяется только для state continuity: hover, раскрытие, dialog и toast. Она не блокирует action и не сообщает смысл без текста. При `prefers-reduced-motion: reduce` nonessential transitions/animations отключаются, smooth scrolling не используется.

## 6. Responsive layout

Mobile-first ranges:

- compact: меньше `768px`;
- tablet: `768px`–`1199px`;
- desktop: `1200px` и больше.

CSS custom properties нельзя использовать в media query conditions, поэтому значения breakpoint фиксируются в документации и повторяются literal media queries. Новые breakpoints добавляются только при доказанном layout failure, а не под конкретную модель устройства.

Правила:

- Compact screens используют одну основную колонку и horizontal padding не меньше `20px`.
- Forms ограничены `--hf-form-width`, но занимают доступную ширину на compact screens.
- Main application content ограничен `--hf-content-width`.
- Primary actions в compact forms могут занимать всю ширину.
- Desktop table на compact screen преобразуется в labelled list/cards; обязательная информация не прячется в горизонтально обрезанной таблице.
- Modal на compact screen оставляет safe page margin и не выходит за viewport; длинное содержимое прокручивается внутри dialog.
- Layout остаётся usable при zoom `200%`, увеличенном тексте и длинных русских labels.

## 7. Accessibility baseline

Цель — WCAG 2.2 AA для пользовательских сценариев foundation.

Обязательные правила:

- normal text contrast не ниже `4.5:1`; large text и essential non-text UI — не ниже `3:1`;
- все функции доступны keyboard-only;
- focus видим всегда и следует логическому DOM order;
- page имеет один содержательный `h1`, landmarks и корректную heading hierarchy;
- form field имеет visible label; placeholder не заменяет label;
- hint/error связываются с control через `aria-describedby`; invalid control получает `aria-invalid="true"`;
- form-level summary получает focus после failed submit только когда это помогает перейти к нескольким ошибкам; field errors остаются рядом с полями;
- live regions используются сдержанно: success/loading — `polite`, blocking error — `assertive` только при необходимости;
- status содержит текст, а icon для дублирования status скрывается через `aria-hidden="true"`;
- icon-only action требует accessible name;
- decorative illustration имеет пустой alt или `aria-hidden`; meaningful image получает русский alt;
- modal удерживает focus, поддерживает Escape, блокирует background и возвращает focus исходному trigger;
- disabled state остаётся читаемым; причина недоступности сообщается рядом, если она не очевидна;
- pointer gestures не являются единственным способом выполнить action.

## 8. Логотип и фирменная подпись

`identity/logo_description.png` — reference board, а не runtime logo asset. Его нельзя обрезать и использовать как изображение логотипа в приложении. До появления утверждённых отдельных SVG/PNG assets используется текстовый monochrome wordmark `HarmoFin`; визуальную многоцветную версию нельзя воссоздавать приблизительно через случайные CSS-формы.

После получения production assets допустимы только варианты из reference board:

- основной horizontal logo;
- vertical variant;
- сокращённый logo;
- знак без wordmark;
- approved dark, light, gray и inverse versions;
- отдельные favicon/app-icon exports.

Ограничения:

- horizontal web logo — не меньше `120px` по ширине;
- standalone icon — не меньше `24px`, кроме специально подготовленных favicon exports `16x16` и `32x32`;
- clear space вокруг logo — не меньше высоты заглавной `H` wordmark;
- logo нельзя растягивать, наклонять, перекрашивать произвольно, разбирать на элементы, дополнять тенью или ставить на нечитаемый фон;
- approved slogan: `Семейный бюджет. Общие цели.`; slogan не повторяется рядом с каждым compact wordmark;
- logo не заменяет page heading, navigation label или accessible name.

## 9. Архитектура Vue-компонентов

### 9.1. Границы ответственности

`components/ui/` содержит только reusable visual primitives. Они:

- принимают typed display props и slots;
- emit пользовательское намерение;
- не вызывают API;
- не читают auth/session state;
- не решают authorization;
- не рассчитывают balances, limits, deficit или financial aggregates;
- не знают Prisma/API entities целиком, если им достаточно presentation fields.

Page/domain composables владеют API calls, loading state, mapping Problem Details, success notification и navigation. Domain presentation components композируют UI primitives и получают server-confirmed DTO/view model.

Основной поток:

```text
API DTO -> page/composable -> presentation props -> UI component
user intent -> emitted event -> page/composable -> API mutation
Problem Details -> form summary + matching field errors
successful mutation -> refreshed server DTO + concise toast
```

Скрытие action в UI улучшает понятность, но не является authorization. Server повторно проверяет membership, role, budget scope и object state.

### 9.2. Общие соглашения

- Nuxt auto-import name следует пути: `components/ui/Button.vue` используется как `UiButton`.
- Public props/events остаются English; visible copy — Russian.
- Native attributes и `data-*` передаются корневому interactive element.
- Stable IDs создаются SSR-safe способом; случайные IDs во время render не используются.
- `v-model` компоненты принимают string для form values, пока contract явно не требует boolean/date object.
- Loading action имеет `aria-busy="true"`, сохраняет понятный label и блокирует повторную отправку.
- Disabled и readonly — разные states и не подменяют друг друга.
- Components не содержат hidden global singleton state, кроме явно выделенного toast service.
- Icons — inline approved SVG или небольшой локальный set; emoji не используются как UI icons. Decorative icons скрыты от screen readers.

## 10. Контракты base UI components

Контракты нормативны для будущей реализации. Реализуется только component, нужный текущему пользовательскому сценарию.

### 10.1. `UiButton`

Props:

- `variant: 'primary' | 'secondary' | 'tertiary' | 'danger'`;
- `size: 'sm' | 'md' | 'lg'`, default `md`;
- `type: 'button' | 'submit' | 'reset'`, default `button`;
- `loading?: boolean`;
- `disabled?: boolean`;
- `fullWidth?: boolean`;
- `ariaLabel?: string` для icon-only variant.

Slots: `default`, optional `leading`, `trailing`. Event: native-compatible `click`.

Requirements: native `<button>`, target минимум `44x44px`, loading blocks repeat action, danger label называет действие (`Архивировать счёт`), а не абстрактное `Да`.

### 10.2. `UiInput`

Props:

- `modelValue: string`;
- `id?`, `name`, `label`;
- `type: 'text' | 'email' | 'password' | 'search' | 'date'`;
- `autocomplete?`, `inputmode?`, `placeholder?`;
- `hint?`, `error?`;
- `required?`, `disabled?`, `readonly?`.

Events: `update:modelValue`, `blur`. Optional trailing slot не перекрывает input text.

Requirements: visible label, stable hint/error IDs, `aria-invalid`, error text remains after focus, no formatting that moves caret unexpectedly.

### 10.3. `UiSelect`

Props повторяют label/hint/error contract `UiInput` и добавляют:

- `modelValue: string`;
- `options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>`;
- `placeholder?` как disabled empty option.

Events: `update:modelValue`, `blur`.

Foundation использует native `<select>`. Custom combobox вводится только при реальной потребности в search/grouping и после отдельного keyboard/accessibility design.

### 10.4. `UiCard`

Props: `as: 'div' | 'section' | 'article'`, default `div`; optional `tone: 'default' | 'subtle'`. Slots: `header`, `default`, `actions`, `footer`.

Card не добавляет heading level автоматически. Whole-card click допускается только для одной однозначной navigation action и тогда реализуется настоящей ссылкой, а не click handler на `div`.

### 10.5. `UiBadge` и `UiStatus`

`UiBadge` — компактный metadata label. Props: `tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'`, `size: 'sm' | 'md'`; text в default slot.

`UiStatus` — состояние объекта. Props: `label: string`, тот же `tone`, optional approved icon. Label обязателен: component не кодирует domain enum и не показывает status только цветом.

### 10.6. `UiModal`

Props:

- `open: boolean`;
- `title: string`;
- `description?`;
- `dismissible?: boolean`, default `true`;
- `closeLabel?: string`, default `Закрыть`.

Slots: `default`, `footer`. Events: `close` с reason `escape | backdrop | button`.

Implementation использует native `<dialog>` там, где он удовлетворяет browser targets, с controlled `showModal()`. Он обеспечивает initial focus, focus containment, Escape, background inertness и return focus. Pending mutation временно запрещает dismiss, если закрытие потеряет состояние.

### 10.7. `UiConfirmDialog`

Композиция `UiModal` и `UiButton`.

Props: `open`, `title`, `description`, `confirmLabel`, `cancelLabel`, `variant: 'primary' | 'danger'`, `loading?`. Events: `confirm`, `cancel`.

Description явно называет последствие. Для archive используется формулировка вроде `Счёт останется в истории, но будет недоступен для новых операций.` Phrase-typing confirmation не добавляется без отдельной обоснованной high-risk action.

### 10.8. `UiTable`

Props: rows, stable row key, column descriptors с `key`, `label`, optional alignment/priority. Named cell slots позволяют доменному экрану форматировать значения.

Desktop output — semantic `<table>` с `<caption>` или accessible label, `<th scope="col">` и keyboard-accessible actions. Compact output — labelled list/cards с теми же данными; порядок labels фиксирован descriptors. Не используется горизонтальная обрезка обязательных columns. Empty и loading states находятся вне table rows.

### 10.9. `UiToastViewport`

Toast model: `id`, `tone: 'success' | 'info' | 'warning' | 'danger'`, `message`, optional action. Viewport имеет accessible live region и close buttons. Success/info могут auto-dismiss примерно через `5s`; timer pause-ится при hover/focus. Error, требующий исправления, остаётся в page/form, а не только в toast.

### 10.10. `UiEmptyState`

Props: `title`, `description`; slots: optional `illustration`, `action`. Один primary action. Текст объясняет, что отсутствует и какое действие доступно; decorative image не несёт единственный смысл.

## 11. Контракты financial presentation components

### 11.1. `FinanceMoney`

Props:

- `minorUnits: string | bigint`, где string соответствует canonical integer form `^-?\d+$`;
- `currency: string`;
- `scale: number`;
- `locale?: string`, default `ru-RU`;
- `signDisplay?: 'auto' | 'always' | 'never'`.

Component форматирует только server-confirmed value. Conversion в JavaScript `number` запрещена. Formatting utility использует `BigInt`, выделяет целую и дробную части по `scale`, а locale separators/currency placement получает через `Intl.NumberFormat(...).formatToParts()`. Это presentation formatting, не расчёт balance.

Malformed props считаются contract violation: production UI показывает безопасное `—`, development сообщает sanitized diagnostic без финансового payload. Value отображается с tabular numerals.

### 11.2. `FinanceBalance`

Композиция `FinanceMoney` с optional `label`, `statusText` и `tone`. `tone`/`statusText` приходят из server response или page view model; component не выводит domain conclusion вроде deficit/limit breach из числа. Отрицательное value всегда сохраняет minus sign.

### 11.3. `FinanceMoneyInput`

Props расширяют `UiInput`:

- `modelValue: string`;
- `currency: string`;
- `scale: number`;
- `allowNegative?: boolean`;
- стандартные `label`, `hint`, `error`, `required`, `disabled`.

Input использует `inputmode="decimal"` и хранит введённое значение строкой. Он не вызывает `Number`, не переводит значение в minor units и не обновляет balance. Locale normalization для API выполняется form adapter по контракту конкретного endpoint; окончательная syntax, scale, sign и overflow validation всегда выполняется server-side.

### 11.4. `AccountCard`

Presentation props: name, localized account type, optional bank name, masked last digits, currency, server-confirmed current balance и archive status. Slots: navigation/action. Component не принимает и не показывает полный card/account number, не решает доступность действия по role и не рассчитывает current balance из starting balance.

### 11.5. `EnvelopeCard`

Presentation props: name, localized envelope type, server-confirmed current balance, optional planned amount, target amount/date, archive status. Slots: actions. До появления server-confirmed domain rule component не рассчитывает target progress, deficit или доступный остаток.

### 11.6. Domain status

API enum не выводится напрямую. Page mapper преобразует его в русское label и tone, затем передаёт `UiStatus`. Базовые формулировки: `Активен`, `В архиве`, `Недоступен`. Будущие operation statuses проектируются вместе с соответствующим этапом.

## 12. Screen states и ошибки

Каждый async screen имеет явные states:

- **loading:** skeleton или короткий status `Загрузка…`; existing content не исчезает при background refresh без причины;
- **empty:** `UiEmptyState` с одним доступным следующим действием;
- **error:** понятное сообщение и recovery action, если retry безопасен;
- **success:** обновлённые server data и короткий toast;
- **disabled/pending:** повторное действие заблокировано, label сохраняет смысл.

Problem Details mapping:

1. `fieldErrors` сопоставляются только с известными form fields.
2. Неизвестные или form-level errors попадают в summary.
3. Raw API `detail`, stack, internal code, ID, token или payload не показываются, если они не предназначены как safe user copy.
4. После failed submit focus переводится на summary/первое invalid field предсказуемо.
5. После mutation UI получает/refetches server-confirmed object; optimistic financial balance update не используется.

## 13. Русскоязычный UI copy

Стиль: краткий, нейтральный, конкретный, action-first.

- Action labels: `Создать счёт`, `Сохранить изменения`, `Переместить в архив`.
- Success: `Счёт создан`, `Изменения сохранены`, `Конверт перемещён в архив`.
- Error: что произошло и что можно сделать: `Не удалось сохранить изменения. Проверьте поля и повторите попытку.`
- Status: существительное/краткое состояние, а не внутренний enum.
- Confirm buttons не называются `Да`/`ОК`, если можно назвать действие.
- В интерфейсе не показываются internal IDs, role codes, raw API errors, cookies, session/token details или чувствительные финансовые payload.
- Термины одного объекта стабильны: `счёт`, `категория`, `конверт`, `бюджет`, `пространство`.
- Восклицательные знаки, обвиняющие формулировки и обещания без подтверждения не используются.

## 14. Порядок внедрения

Foundation внедряется как часть первого Stage 2 UI slice, а не отдельным cosmetic rewrite без пользователя:

1. Добавить self-hosted Inter assets, `tokens.css`, `base.css` и global Nuxt registration.
2. Реализовать только primitives, нужные первому settings flow, с unit tests.
3. Построить application/settings shell на tokens и primitives.
4. В том же UI этапе мигрировать existing auth/app shell с прямых hex, `750/800` и `-0.07em` на foundation, не меняя auth behavior.
5. Добавлять remaining components только вместе с реальным screen use case.
6. Проверить auth и settings screens в desktop/compact browser view после миграции.

Такой порядок исключает одновременно две проблемы: не оставляет неиспользуемую design system и не позволяет новым settings pages умножить существующие локальные стили.

## 15. Verification strategy

При внедрении foundation проверяется:

- отсутствие прямых brand/supporting hex в runtime Vue/component styles вне token file;
- token values и semantic aliases;
- keyboard flow, focus visibility и return focus для dialogs;
- label/hint/error associations и live-region behavior;
- loading, disabled, error, empty и success states;
- safe money formatting на значениях больше `Number.MAX_SAFE_INTEGER`, отрицательных значениях, zero и разных scale без conversion в `number`;
- compact layout на ширине `375px` и desktop layout не меньше `1280px`;
- usability при `200%` zoom и reduced motion;
- existing registration/login/logout/recovery flow после style migration;
- Stage 2 settings flow через Playwright, когда он появится.

Unit tests проверяют component contracts и formatting utility. Playwright проверяет critical responsive journeys и keyboard interactions. Snapshot-only tests не считаются достаточной accessibility или behavior verification.

## 16. Acceptance criteria

Foundation считается соблюдённым при реализации, если:

1. CSS token file является единственным источником concrete palette values.
2. Components/pages используют semantic или component tokens, а не brand hex.
3. Inter self-hosted с кириллицей и только утверждёнными weights; внешний font CDN не нужен.
4. Common controls имеют минимум `44x44px`, visible two-tone focus и требуемый contrast.
5. Base components следуют описанным typed props/events и не содержат API/domain logic.
6. Financial components не принимают JS `number` как source of truth и не рассчитывают server-owned balances.
7. Tables, forms и dialogs usable keyboard-only и на compact screen.
8. Error/status meaning передаётся текстом, а не только цветом.
9. Русский copy следует единому словарю и не раскрывает internal/sensitive data.
10. Reference board не используется как runtime logo image; production logo использует только approved exported assets и ограничения размеров.
11. Existing auth behavior остаётся неизменным после token migration и проходит browser regression flow.
12. Foundation не добавляет Storybook, UI framework, dark theme, dashboard или финансовую бизнес-логику.
