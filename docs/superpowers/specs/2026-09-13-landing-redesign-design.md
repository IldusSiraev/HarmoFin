# Дизайн: редизайн лендинга HarmoFin и ребрендинг дизайн-токенов

**Версия:** 1.0
**Дата:** 13.09.2026
**Статус:** черновик для согласования

## Контекст

Продуктовая часть HarmoFin (Stage 0–8) реализована, но главная страница осталась заглушкой из четырёх компонентов (`HeroSection`, `FeaturesGrid`, `ShowcaseSection`, `FinalCTA`) с абстрактной анимацией конвертов и рекламным текстом общего характера. Она не объясняет отличие продукта от обычного учёта расходов.

Появились три входных документа:

1. [ТЗ на лендинг](<ТЗ для агента — лендинг HarmoFin.md>) — структура из 18 секций, копирайт, требования к анимации, SEO, доступности, производительности и компонентной архитектуре.
2. `identity/landing-temporar_design.png` — макет лендинга (desktop + mobile), 16 блоков.
3. `identity/temporary_UI.png` — UI-кит: палитра, типографика, радиусы, тени, иконки, состояния компонентов, мобильная версия, модальные окна, графики.

Макеты задают визуальный язык, отличный от текущего (teal `#1ba39c` / navy `#0d1b2a`): светлый фон, графитовый текст, зелёный брендовый акцент, синий UI-акцент, крупные цифры, тонкие границы, мягкие тени.

Текущее состояние кода, важное для объёма работ:

- `apps/web/app/assets/styles/tokens.css` — единственный источник токенов, на него завязаны 36 `.vue`-файлов; смена значений каскадом меняет цвета всего `/app`.
- Inter уже self-hosted (`@font-face` в `base.css`, `public/fonts/inter-cyrillic-4.1.0.woff2`), веб-шрифт добавлять не нужно.
- Библиотеки иконок нет: иконки — inline SVG внутри отдельных компонентов. Datepicker-библиотеки нет, поля даты — нативный `<input type="date">`.
- `echarts` подключён и используется в аналитике `/app`.
- Цветовых ассертов в unit- и e2e-тестах нет, ребрендинг их не ломает.

## Цели

- Реализовать лендинг по ТЗ: 16 контентных секций плюс шапка и footer, реалистичные mockup-и продукта вместо абстрактной графики.
- Перевести дизайн-токены на палитру, типографику, радиусы и тени из UI-кита.
- Сохранить единственную дизайн-систему проекта: лендинг использует те же токены и те же UI-примитивы, что и приложение.
- Обеспечить требования ТЗ по адаптивности (320–1440), доступности (AA, клавиатура, aria), SEO и производительности.
- Оставить презентационный слой лендинга свободным от доменной логики, чтобы mock-данные позже заменялись реальными без переписывания разметки.

## Не-цели

- Не переверстываем экраны `/app` — их визуальное обновление под новый кит выделено в отдельную задачу. `/app` получает новые цвета автоматически через токены, layout не меняется.
- Не подключаем datepicker-библиотеку: на лендинге календарь не используется, поля дат живут в `/app` и относятся к отложенной фазе.
- Не тащим `echarts` на маркетинговую страницу.
- Не реализуем регистрацию, авторизацию, реальные финансовые данные и интерактивность внутри mockup-ов — они демонстрационные.
- Не добавляем на лендинг обещаний вне MVP (банковские интеграции, Telegram, AI, SaaS-функции упоминаются только в блоке «Дальше»).

## Согласованные решения

| Вопрос | Решение |
| --- | --- |
| Два акцента в макете | Зелёный — брендовый акцент (CTA лендинга, брендовые элементы), синий — UI-action (кнопки форм, ссылки, фокус) |
| Объём ребрендинга | Токены + иконки + лендинг сейчас; переоформление экранов `/app` — отдельная задача |
| Секция «Нестабильный доход» (ТЗ §16) и «plan vs fact» (ТЗ §17), отсутствующие в макете | Реализуем по ТЗ в стиле кита |
| Иконки | `lucide-vue-next` (начертание кита — тонкий rounded stroke), точечные импорты |
| Datepicker | Отложен вместе с фазой `/app` |
| Растровые устройства и листва из макета | Листва — inline SVG, устройства — CSS-рамка вокруг живого mockup-компонента, битмапы не заводим |

## Токены (`tokens.css`)

### Палитра кита и поправка на контраст

Значения кита сняты из `identity/temporary_UI.png`: Primary `#4F9CF9`, Primary light `#E6F2FF`, Success `#10B991`, Warning `#F59E0B`, Danger `#EF4444`, Text primary `#0F172A`, Text secondary `#64748B`, Border `#E2E8F0`, Background `#F8FAFC`, Surface `#FFFFFF`. CTA-кнопка на лендинге в макете темнее Success — `≈#0D9D76`.

Три цвета кита не проходят WCAG AA (4.5:1) в сочетании «белый текст на заливке»:

| Цвет кита | Белый текст | Вердикт |
| --- | --- | --- |
| `#0D9D76` (CTA) | 3.48:1 | не проходит |
| `#4F9CF9` (Primary) | 2.84:1 | не проходит |
| `#EF4444` (Danger) | 3.50:1 | не проходит |

Поэтому яркие оттенки кита остаются для нетекстовых ролей (графика, прогресс, фоны, декоративные акценты), а для заливок с белым текстом вводятся затемнённые варианты той же гаммы:

| Токен | Значение | Роль | Контраст с белым |
| --- | --- | --- | --- |
| `--hf-color-brand` | `#0A7F60` | заливка брендовых CTA | 5.0:1 |
| `--hf-color-brand-hover` | `#086B51` | hover CTA | 6.4:1 |
| `--hf-color-brand-bright` | `#10B991` | прогресс, иконки, графика, бейджи | — (нетекстовый) |
| `--hf-color-brand-soft` | `#E7F7F2` | брендовые подложки, callout | — (фон) |
| `--hf-color-action-primary` | `#1D6FD6` | primary-кнопки форм, ссылки, фокус | 4.9:1 |
| `--hf-color-primary-bright` | `#4F9CF9` | линии графиков, иконки, акцентные границы | — (нетекстовый) |
| `--hf-color-primary-soft` | `#E6F2FF` | info-подложки | — (фон) |
| `--hf-color-action-danger` | `#DC2626` | деструктивные кнопки | 4.8:1 |
| `--hf-color-status-danger-bright` | `#EF4444` | иконки и индикаторы статуса | — (нетекстовый) |
| `--hf-color-status-warning-bright` | `#F59E0B` | подложка/индикатор warning, текст поверх — `#0F172A` | 8.4:1 (тёмный текст) |
| `--hf-color-text` | `#0F172A` | основной текст | 19.8:1 |
| `--hf-color-text-muted` | `#64748B` | вторичный текст | 4.8:1 на белом, 4.6:1 на фоне страницы |
| `--hf-color-border` | `#E2E8F0` | границы | — (нетекстовый) |
| `--hf-color-page-background` | `#F8FAFC` | фон страницы | — |
| `--hf-color-surface` | `#FFFFFF` | карточки | — |

Правило для реализации: `--hf-color-*-bright` никогда не используется как фон под белым текстом и как единственный носитель статуса (ТЗ §33 — цвет не единственный способ передачи состояния).

Фокус-индикатор переходит с teal на `--hf-color-action-primary` (`#1D6FD6`, 4.9:1 — выше требуемых 3:1 для нетекстовых индикаторов). Структура `--hf-focus-indicator` (двойное кольцо) сохраняется.

### Имена и обратная совместимость

Семантические имена токенов (`--hf-color-action-primary`, `--hf-color-surface`, `--hf-color-text`, `--hf-shadow-card`, `--hf-card-radius` и прочие) сохраняются — меняются только значения. Это даёт `/app` новую палитру без правок в 36 компонентах. Старые бренд-переменные (`--hf-color-brand-teal`, `--hf-color-brand-navy`, `--hf-color-brand-mint`, `--hf-color-teal-*`) удаляются; их прямые использования в компонентах переводятся на семантические токены в рамках этапа 1.

### Типографика

Шкала кита: H1 48/56 Bold, H2 32/40 Semibold, H3 24/32 Semibold, Body 16/24 Regular, Small 14/20 Medium, Caption 12/16 Regular. Заводим токены с адаптивным `clamp()` для заголовков:

```
--hf-font-size-h1: clamp(2rem, 5vw, 3rem);      --hf-line-height-h1: 1.16;
--hf-font-size-h2: clamp(1.625rem, 3.5vw, 2rem); --hf-line-height-h2: 1.25;
--hf-font-size-h3: 1.5rem;                       --hf-line-height-h3: 1.33;
--hf-font-size-body: 1rem;                       --hf-line-height-body: 1.5;
--hf-font-size-small: 0.875rem;                  --hf-line-height-small: 1.43;
--hf-font-size-caption: 0.75rem;                 --hf-line-height-caption: 1.33;
```

Отдельно — крупные финансовые цифры лендинга: `--hf-font-size-display: clamp(2.5rem, 7vw, 4rem)`, `letter-spacing: -0.02em`, табличные цифры (`font-variant-numeric: tabular-nums`).

### Радиусы, тени, контейнер

```
--hf-radius-sm: 0.25rem;  /* 4px  */
--hf-radius-md: 0.5rem;   /* 8px  */
--hf-radius-lg: 0.75rem;  /* 12px */
--hf-radius-xl: 1rem;     /* 16px */

--hf-shadow-xs: 0 1px 2px rgb(15 23 42 / 6%);
--hf-shadow-sm: 0 1px 3px rgb(15 23 42 / 8%), 0 1px 2px rgb(15 23 42 / 6%);
--hf-shadow-md: 0 4px 12px rgb(15 23 42 / 8%);
--hf-shadow-lg: 0 12px 32px rgb(15 23 42 / 12%);
--hf-shadow-card: var(--hf-shadow-sm);   /* алиас для существующих компонентов */

--hf-container-max: 75rem;         /* 1200px, приложение и контент лендинга */
--hf-container-max-wide: 80rem;    /* 1280px, широкие секции лендинга */
```

Брейкпоинты остаются CSS-медиазапросами без JS: 768px (планшет), 1024px (десктоп), 1280px (широкий десктоп). Базовая вёрстка — мобильная (ТЗ §36).

## Структура страницы

`pages/index.vue` сохраняет текущее поведение редиректа авторизованного пользователя на `/app` и содержит только композицию секций.

| # | Секция | `id` | Компонент | Приоритет ТЗ |
| --- | --- | --- | --- | --- |
| 1 | Шапка | — | `LandingHeader` | P0 |
| 2 | Hero | `hero` | `HeroSection` | P0 |
| 3 | Проблема | `problem` | `ProblemSection` | P0 |
| 4 | Счета + конверты | `concept` | `ConceptSection` | P0 |
| 5 | Можно потратить | `available` | `AvailableToSpendSection` | P0 |
| 6 | Финансовый цикл | `cycle` | `FinancialCycleSection` | P0 |
| 7 | Распределение дохода | `allocation` | `IncomeAllocationSection` | P0 |
| 8 | Накопительные цели | `goals` | `GoalsSection` | P0 |
| 9 | Обязательные платежи | `plans` | `PlansSection` | P0 |
| 10 | Нестабильный доход | `income` | `VariableIncomeSection` | P0 (по ТЗ §16) |
| 11 | Аналитика | `analytics` | `AnalyticsSection` | P0 |
| 12 | Один день с HarmoFin | `how-it-works` | `HowItWorksSection` | P1 |
| 13 | Для кого | `features` | `AudienceSection` | P1 |
| 14 | Roadmap | `roadmap` | `RoadmapSection` | P1 |
| 15 | Безопасность | `security` | `SecuritySection` | P1 |
| 16 | FAQ | `faq` | `FaqSection` | P1 |
| 17 | Финальный CTA | — | `FinalCtaSection` | P0 |
| 18 | Footer | — | `LandingFooter` | P0 |

Якоря шапки (`#features`, `#how-it-works`, `#security`, `#faq`) соответствуют ТЗ §6. Копирайт всех секций берётся из ТЗ дословно; отклонения от макета допускаются только там, где ТЗ прямо задаёт другое содержание.

Иерархия заголовков: один `<h1>` в Hero, заголовки секций — `<h2>`, заголовки карточек внутри секций — `<h3>`. Каждая секция — `<section>` с `aria-labelledby`, указывающим на свой заголовок.

## Компонентная архитектура

```text
apps/web/app/
  pages/
    index.vue                      # композиция секций + SEO-мета + редирект авторизованных

  components/landing/
    LandingHeader.vue              # sticky, прозрачная над hero, blur при скролле, бургер на мобилке
    LandingFooter.vue
    sections/
      HeroSection.vue
      ProblemSection.vue
      ConceptSection.vue
      AvailableToSpendSection.vue
      FinancialCycleSection.vue
      IncomeAllocationSection.vue
      GoalsSection.vue
      PlansSection.vue
      VariableIncomeSection.vue
      AnalyticsSection.vue
      HowItWorksSection.vue
      AudienceSection.vue
      RoadmapSection.vue
      SecuritySection.vue
      FaqSection.vue
      FinalCtaSection.vue
    mockups/
      DashboardMockup.vue          # hero: «Можно потратить» + распределение по конвертам
      AvailableCard.vue            # секция «Можно потратить», с count-up
      CycleTimeline.vue            # горизонтальный таймлайн, вертикальный на мобилке
      AllocationFlow.vue           # доход → назначения
      GoalsGrid.vue                # накопительные цели с прогрессом
      PlansList.vue                # ближайшие обязательства + сумма резерва
      IncomeComparison.vue         # план/факт, две карточки
      DonutChart.vue               # SVG, расходы по категориям
      CashFlowChart.vue            # SVG, доходы/расходы по месяцам
      PlanVsFactBars.vue           # SVG, план против факта
      StepStrip.vue                # «Один день с HarmoFin»
    ui/
      LandingSection.vue           # обёртка: id, eyebrow, заголовок, описание, слот контента
      LandingCard.vue
      LandingCallout.vue
      LandingProgress.vue
      LandingMetric.vue            # подпись + крупное число + вспомогательный текст

  composables/
    useRevealOnScroll.ts
    useCountUp.ts

  data/
    landing.ts                     # все демонстрационные данные и их типы
```

Удаляются: `components/landing/HeroSection.vue`, `FeaturesGrid.vue`, `FeatureCard.vue`, `ShowcaseSection.vue`, `FinalCTA.vue` (тестов у них нет).

Общий UI переиспользуется, а не дублируется: `ui/Button.vue` получает необязательный проп `to?: string` — при его наличии компонент рендерит `NuxtLink` вместо `<button>` с теми же стилями, плюс новый вариант `brand` (заливка `--hf-color-brand`). Это снимает дублирование стилей кнопок между лендингом и `/app` и закрывает требование ТЗ §31 «никаких fake buttons»: CTA — настоящие ссылки на `/register` и `/login`, которые уже существуют.

Иконки: `lucide-vue-next`, импорт по одному символу на использование. Существующие inline-SVG в `/app` в этой задаче не переписываются.

## Демонстрационные данные

Весь числовой контент лендинга живёт в `app/data/landing.ts` — в шаблонах нет литералов сумм (ТЗ §30). Суммы хранятся в минорных единицах (копейках) и форматируются существующей утилитой `formatMinorUnits` из `app/components/finance/money-format.ts`, что соответствует правилу проекта «не использовать float как источник истины по деньгам» даже для демо-данных.

Экспортируемые структуры:

```ts
export interface LandingBudgetSnapshot {
  dateLabel: string;        // «Сегодня, 13 сентября»
  periodLabel: string;      // «Период 25–9»
  daysLeft: number;
  availableMinor: number;
  periodLimitMinor: number;
  spentMinor: number;
  dailyAverageMinor: number;
}

export interface LandingEnvelope { name: string; amountMinor: number; tone: 'brand' | 'primary' | 'warning' | 'neutral'; }
export interface LandingAllocation { name: string; amountMinor: number; }
export interface LandingGoal { name: string; savedMinor: number; targetMinor: number; }
export interface LandingPlan { dateLabel: string; name: string; amountMinor: number; }
export interface LandingCategoryShare { name: string; share: number; }     // сумма долей = 100
export interface LandingCashFlowPoint { label: string; incomeMinor: number; expenseMinor: number; }
export interface LandingStep { index: number; title: string; caption: string; }

export const heroBudget: LandingBudgetSnapshot;
export const heroEnvelopes: LandingEnvelope[];
export const allocationData: { incomeName: string; incomeMinor: number; allocations: LandingAllocation[] };
export const goalData: LandingGoal[];
export const upcomingPlans: { items: LandingPlan[]; reservedMinor: number };
export const analyticsData: { categories: LandingCategoryShare[]; cashFlow: LandingCashFlowPoint[]; planVsFact: { label: string; planMinor: number; factMinor: number }[] };
export const variableIncome: { plannedMinor: number; cases: { receivedMinor: number }[] };
export const howItWorksSteps: LandingStep[];
```

Значения — из ТЗ (21 800 ₽ доступно, лимит 63 000 ₽, потрачено 41 200 ₽, 7 дней, 3 114 ₽/день; зарплата 106 000 ₽ → 50 000 / 36 000 / 20 000; цели 70 000 из 120 000, 18 000 из 30 000, 42 000 из 100 000; платежи 20.09–01.10 на 52 000 ₽ резерва; категории 24/21/14/10/8/23 %).

Инвариант, проверяемый тестом: сумма распределения не превышает доход, доли категорий дают 100 %, накопленное не больше цели. Демо-данные не должны противоречить финансовым правилам продукта.

## Графики

Три SVG-компонента без внешних зависимостей — `echarts` на лендинг не подключается (ТЗ §17 и §34):

- `DonutChart.vue` — доли расходов, сегменты через `stroke-dasharray` на окружности, легенда с процентами текстом рядом.
- `CashFlowChart.vue` — две линии (доходы/расходы) по точкам месяцев, построение через `polyline` с нормализацией по максимуму.
- `PlanVsFactBars.vue` — парные горизонтальные полосы план/факт.

Доступность графиков: `role="img"` + `aria-label` с текстовым резюме («Расходы по категориям: продукты 24 %, жильё 21 %…») и дублирование значений в видимой легенде/подписях. Цвет не единственный носитель: у каждой серии подпись и разный стиль линии/маркера.

## Анимации

- `useRevealOnScroll()` — `IntersectionObserver`, добавляет класс появления (fade + `translateY(12px)` + `scale(0.98→1)`), длительность 300–600 мс, `ease-out`, срабатывает один раз.
- `useCountUp()` — анимация числа через `requestAnimationFrame`; при `prefers-reduced-motion: reduce` сразу отдаёт конечное значение без кадров.
- Прогресс-бары и таймлайн анимируют ширину/появление тем же наблюдателем.

Глобальный сброс анимаций в `base.css` (`@media (prefers-reduced-motion: reduce)`) уже есть и покрывает CSS-часть; JS-композаблы проверяют `window.matchMedia('(prefers-reduced-motion: reduce)')` самостоятельно. Бесконечные плавающие анимации, parallax и постоянное вращение не используются (в том числе удаляется текущая бесконечная анимация конверта в hero).

## Шапка и навигация

`LandingHeader` — `position: sticky`, высота 72–80 px на десктопе, прозрачный фон над hero, при скролле (порог ~24 px) — полупрозрачный фон + `backdrop-filter: blur`. Пункты меню — якорные ссылки, справа «Войти» (`/login`) и «Начать бесплатно» (`/register`, вариант `brand`).

На мобилке пункты скрываются, остаётся бургер, открывающий панель навигации: фокус переводится внутрь панели, `Escape` закрывает, `aria-expanded`/`aria-controls` на кнопке, размер сенсорной цели не меньше 44 px.

Плавный скролл к якорям — через `scroll-behavior: smooth` на корне и `scroll-margin-top`, равный высоте шапки, чтобы заголовок секции не уезжал под неё; при `prefers-reduced-motion` плавность отключена глобальным правилом `base.css`.

## Адаптивность

- Мобильная вёрстка — базовая, десктоп надстраивается медиазапросами.
- 320 px: горизонтального переполнения нет ни в одной секции; таблично-широкие mockup-и (таймлайн, список платежей) перестраиваются в вертикальный список, а не в горизонтальный скролл.
- 390 px: одна колонка, CTA во всю ширину, mockup-и упрощены (мелкие вторичные детали скрываются через `display: none`, а не уменьшением шрифта ниже 12 px).
- 768–1023 px: карточные сетки в 2 колонки, hero в одну колонку с mockup-ом под текстом.
- ≥1024 px: hero в 2 колонки, аналитика — график слева, cash flow справа.
- ≥1280 px: контейнер `--hf-container-max-wide`.

## SEO

В `pages/index.vue` через `useSeoMeta`/`useHead`:

- `<title>`: «HarmoFin — управляйте личными и семейными финансами».
- `description`: «HarmoFin помогает управлять семейным бюджетом, распределять деньги по целям и видеть, сколько действительно можно потратить.»
- `canonical`, `og:type=website`, `og:title`, `og:description`, `og:url`, `og:locale=ru_RU`, `og:image`, `twitter:card=summary_large_image`.
- Favicon: новый `public/favicon.svg` (монограмма на брендовом фоне) + `link rel="icon"`.
- Семантика: один `<h1>`, корректная иерархия `h2`/`h3`, `<main>`, `<section>`, `<nav>`, `<footer>`.

## Доступность

- Клавиатурная навигация по всем интерактивным элементам, видимый фокус (`--hf-focus-indicator`).
- FAQ — кнопка-заголовок с `aria-expanded` и `aria-controls`, панель с `role="region"` и `aria-labelledby`; раскрытие по `Enter`/`Space`, содержимое скрытых панелей не участвует в табуляции.
- Иконочные кнопки (бургер, закрытие меню) — `aria-label`.
- Контраст: значения и расчёты зафиксированы в разделе токенов; текст на цветных подложках проверяется отдельно.
- Статусы (рост/падение дохода, прогресс целей) дублируются текстом и знаком, не только цветом.
- Декоративная графика (листва, фоновые формы) — `aria-hidden="true"`.

## Производительность

- Никаких растровых изображений в контенте: mockup-и, устройства, листва и графики — CSS/SVG.
- Тяжёлых зависимостей на странице нет: `lucide` импортируется по символам, `echarts` не подключается.
- Секции ниже первого экрана, содержащие SVG-графику (`AnalyticsSection`), монтируются лениво через `defineAsyncComponent` + наблюдатель видимости.
- Шрифт уже self-hosted с `font-display: swap`, дополнительных сетевых запросов не добавляется.
- Ориентир ТЗ — открытие страницы до ~3 с на обычном соединении.

## Тестирование

Unit (Vitest, `apps/web/app/**/*.test.ts`):

- `useCountUp` — конечное значение достигается; при `prefers-reduced-motion` значение выставляется сразу, без анимации.
- `useRevealOnScroll` — класс появления выставляется при пересечении и не снимается обратно.
- `FaqSection` — `aria-expanded`/`aria-controls` синхронны состоянию, раскрытие с клавиатуры, одновременно открытая панель одна.
- `LandingHeader` — бургер меняет `aria-expanded`, `Escape` закрывает меню.
- `DonutChart`, `CashFlowChart`, `PlanVsFactBars` — корректная геометрия сегментов/точек и наличие текстового резюме в `aria-label`.
- `data/landing.ts` — инварианты демо-данных (сумма распределения ≤ дохода, доли = 100 %, накопления ≤ цели).

E2E (Playwright, `e2e/landing.spec.ts`, запуск в CI):

- Якорная навигация ведёт к нужным секциям, заголовок не перекрыт шапкой.
- «Начать бесплатно» ведёт на `/register`, «Войти» — на `/login`.
- FAQ управляется с клавиатуры.
- На 320 px нет горизонтального переполнения (`document.scrollingElement.scrollWidth <= clientWidth`).
- Нет ошибок в консоли при загрузке страницы.

Проверки качества: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Порядок реализации

1. **Фундамент.** Новые токены в `tokens.css`, перевод прямых использований старых бренд-переменных на семантические токены, `lucide-vue-next`, расширение `ui/Button.vue` (`to`, вариант `brand`), favicon. Проверка: приложение `/app` собирается и выглядит консистентно на новой палитре.
2. **Каркас лендинга.** `pages/index.vue`, `LandingHeader`, `LandingFooter`, `LandingSection`, `app/data/landing.ts`, SEO-мета; удаление старых компонентов лендинга.
3. **P0, часть 1.** Hero + `DashboardMockup`, «Проблема», «Счета + конверты».
4. **P0, часть 2.** «Можно потратить», «Финансовый цикл», «Распределение дохода», «Накопительные цели», «Обязательные платежи».
5. **P0, часть 3.** «Нестабильный доход», «Аналитика» с тремя SVG-графиками.
6. **P1.** «Один день с HarmoFin», «Для кого», «Roadmap», «Безопасность», FAQ, финальный CTA.
7. **Отделка.** Анимации и `prefers-reduced-motion`, проход по доступности, проход по ширинам 320/390/768/1024/1280/1440, e2e-сценарии, финальные проверки.

Каждый этап заканчивается зелёными `typecheck`, `lint`, `test`.

## Риски и открытые вопросы

1. **`og:image`.** Нужен растр 1200×630; инструмента конвертации SVG→PNG в проекте нет, а добавлять зависимость ради одной картинки нежелательно. На этапе 2 проверяем доступность конвертера в окружении; если его нет — оставляем OG-теги без `og:image` и фиксируем TODO, чтобы не заводить лишний пакет.
2. **Каскад ребрендинга на `/app`.** Экраны приложения мгновенно получат новую палитру при неизменной вёрстке. Ожидаемые точки внимания — статусные бейджи и графики `echarts`, где цвета частично заданы в компонентах; их приводим к новым токенам в рамках этапа 1, более глубокое переоформление — в отложенной задаче.
3. **Расхождение макета и ТЗ.** Макет богаче ТЗ в секции «Можно потратить» (дополнительные мини-дашборды справа) и беднее в двух местах (нет «Нестабильного дохода» и «plan vs fact»). Приоритет — ТЗ; дополнительные элементы макета реализуем только если они не мешают читаемости на планшете.
4. **Контрастные отклонения от макета.** Заливки CTA и деструктивных кнопок темнее, чем в макете, ради AA. Визуально это тот же оттенок, но при сверке с макетом «пиксель в пиксель» разница будет заметна — это осознанное отступление, зафиксированное выше.
