# HarmoFin — UI/UX Blueprint

> Единый UI/UX-контракт для frontend-разработки HarmoFin.

---

# 1. Назначение документа

Этот документ определяет:

- информационную архитектуру frontend;
- маршруты;
- layout приложения;
- структуру основных экранов;
- пользовательские workflow;
- карту UI-компонентов;
- состояния компонентов;
- desktop/tablet/mobile поведение;
- правила навигации;
- правила взаимодействия;
- требования к accessibility;
- критерии готовности UI.

Документ является мостом между:

```text
Product requirements
        ↓
UX
        ↓
UI Design
        ↓
Frontend implementation
```

---

# 2. Product UX Model

HarmoFin строится вокруг трёх пользовательских вопросов:

```text
1. Где находятся мои деньги?
           ↓
        СЧЕТА

2. На что они предназначены?
           ↓
       КОНВЕРТЫ

3. Сколько я могу потратить сейчас?
           ↓
   ТЕКУЩИЙ ПЕРИОД
```

В модели продукта счёт отвечает за физическое расположение денег, а конверт — за их назначение. Один счёт может одновременно содержать деньги нескольких конвертов.

---

# 3. Главная UX-модель

Основной пользовательский цикл:

```text
Доход
  ↓
Распределение
  ↓
Назначение денег
  ↓
Повседневные расходы
  ↓
Расчёт доступного остатка
  ↓
Контроль периода
  ↓
Следующая выплата
  ↓
Новый цикл
```

Расширенный вариант:

```text
                ┌───────────────┐
                │     ДОХОД     │
                └───────┬───────┘
                        ↓
               ┌────────────────┐
               │ РАСПРЕДЕЛЕНИЕ  │
               └───────┬────────┘
                       ↓
          ┌────────────┼─────────────┐
          ↓            ↓             ↓
     ОБЯЗАТЕЛЬНЫЕ   ТЕКУЩИЕ      НАКОПЛЕНИЯ
          ↓            ↓             ↓
          │         РАСХОДЫ          │
          │            ↓             │
          └────────────┼─────────────┘
                       ↓
                ДОСТУПНО СЕЙЧАС
                       ↓
                 ПЕРИОД 25–9
                       ↓
                СЛЕДУЮЩАЯ ВЫПЛАТА
```

---

# 4. UX Principles

## P1. Главный вопрос важнее общего баланса

На главной странице первым показывается:

> Сколько можно потратить сейчас?

А не:

> Сколько денег находится на счетах?

---

## P2. Фактические данные важнее плановых

Плановая зарплата — ориентир.

Фактический доход — источник расчёта.

Пользователь не должен получать ошибку только потому, что получил сумму, отличную от плана.

---

## P3. План не равен факту

Регулярный план:

```text
ожидание
```

Фактическая операция:

```text
подтвержденное событие
```

План не должен автоматически создавать подтверждённую финансовую операцию.

---

## P4. Пользователь не должен понимать внутреннюю бухгалтерскую модель

Frontend должен скрывать сложность:

```text
Operation
Distribution
Envelope
Account
Period
Cycle
```

за естественными действиями:

```text
Получил деньги
Распредели
Потрать
Переведи
Посмотри остаток
```

---

## P5. Финансовое действие должно быть обратимым

Удаление операции — логическое.

После удаления пользователь должен иметь возможность восстановить запись.

---

## P6. Предупреждать до финансового последствия

Если операция создаёт дефицит:

```text
предупреждение
     ↓
подтверждение
     ↓
сохранение
```

а не:

```text
сохранение
     ↓
пользователь узнаёт о проблеме
```

---

# 5. Application Shell

## Desktop

```text
┌───────────────────────────────────────────────────────────────┐
│ Header / workspace                                            │
├───────────────┬───────────────────────────────────────────────┤
│               │                                               │
│ Sidebar       │ Main content                                  │
│               │                                               │
│               │                                               │
│               │                                               │
│               │                                               │
└───────────────┴───────────────────────────────────────────────┘
```

### Sidebar

```text
HarmoFin

Главная

Операции
Счета
Конверты
Планы
Аналитика

─────────────

Уведомления

Настройки

─────────────

Профиль
```

---

# 6. Mobile Shell

```text
┌──────────────────────────────┐
│ Header                       │
├──────────────────────────────┤
│                              │
│ Main content                 │
│                              │
│                              │
├──────────────────────────────┤
│ Главная Операции + Ещё       │
└──────────────────────────────┘
```

Mobile navigation:

```text
Главная
Операции
+
Ещё
```

`+`:

```text
+ Доход
+ Расход
+ Перевод
```

---

# 7. Route Map

Предлагаемая структура Vue Router:

```text
/
├── /login
├── /register
├── /forgot-password
│
├── /onboarding
│   ├── /start
│   ├── /cycle
│   ├── /account
│   ├── /envelopes
│   └── /complete
│
└── /app
    ├── /dashboard
    ├── /transactions
    ├── /accounts
    │   └── /:accountId
    ├── /envelopes
    │   └── /:envelopeId
    ├── /plans
    ├── /analytics
    ├── /notifications
    └── /settings
        ├── /budget
        ├── /cycle
        ├── /categories
        ├── /envelopes
        ├── /plans
        ├── /notifications
        ├── /profile
        ├── /security
        ├── /data
        └── /audit
```

---

# 8. Navigation Rules

## Главная

Всегда доступна через:

```text
sidebar
logo
mobile bottom navigation
```

## Операции

Можно открыть:

```text
sidebar
dashboard CTA
transaction links
analytics drill-down
account history
envelope history
```

## Счёт

Можно открыть:

```text
sidebar
dashboard account card
transaction account link
```

## Конверт

Можно открыть:

```text
sidebar
dashboard envelope card
transaction envelope link
```

## Период

Можно открыть:

```text
dashboard
available budget card
```

---

# 9. Global Action Model

Главное действие приложения:

```text
+ Добавить
```

Всегда доступно.

Результат:

```text
Добавить
├── Доход
├── Расход
└── Перевод
```

---

# 10. Page: Dashboard

Route:

```text
/app/dashboard
```

---

## Purpose

Dashboard должен отвечать:

> Что сейчас происходит с моими деньгами?

---

## Hierarchy

```text
1. Current period
2. Available amount
3. Spending status
4. Accounts
5. Envelopes
6. Upcoming obligations
7. Warnings
8. Recent operations
```

---

## Layout

```text
Dashboard
│
├── Page header
│
├── AvailableBudgetCard
│
├── AccountSummary
│
├── EnvelopeSummary
│
├── UpcomingPlans
│
├── WarningList
│
└── RecentTransactions
```

---

## Page header

```text
Добрый день, Ильдус

Цикл 10.09–09.10

                        🔔   + Добавить
```

---

# 11. AvailableBudgetCard

Это **главный UX-компонент HarmoFin**.

```text
┌────────────────────────────────────┐
│ Текущий период                     │
│ 25–9                               │
│                                    │
│ Можно потратить                    │
│                                    │
│ 21 800 ₽                           │
│                                    │
│ █████████████████░░               │
│                                    │
│ Потрачено      41 200 ₽            │
│ Лимит          63 000 ₽            │
│                                    │
│ Осталось 7 дней                    │
│ ≈ 3 114 ₽ / день                   │
└────────────────────────────────────┘
```

### States

```text
normal
warning
critical
negative
loading
error
empty
```

---

# 12. Dashboard — Account Summary

```text
Счета

Основная карта
120 000 ₽

Накопительный
75 000 ₽

Наличные
18 600 ₽

[Все счета →]
```

Каждый элемент:

```text
AccountCard
```

---

# 13. Dashboard — Envelope Summary

```text
Конверты

Обязательные
52 000 ₽

Ремонт
70 000 ₽

Автомобиль
8 000 ₽

Свободные
21 800 ₽
```

---

# 14. Dashboard — Upcoming Plans

```text
Ближайшие обязательства

Сегодня
Подписки                         3 000 ₽

25 сентября
Секции и кружки                  6 000 ₽

26 сентября
Ипотека                         36 000 ₽

29 сентября
Алименты                        16 000 ₽

[Все планы →]
```

---

# 15. Dashboard — Warnings

Источники:

```text
не распределённый доход
отрицательный счёт
отрицательный конверт
недостаток на обязательства
просроченный план
```

---

# 16. Page: Transactions

Route:

```text
/app/transactions
```

---

## Structure

```text
PageHeader
TransactionFilters
TransactionSummary
TransactionList
Pagination / infinite loading
```

---

## Filters

```text
Search
Date range
Cycle
Period
Account
Category
Envelope
Type
Status
```

Эти фильтры соответствуют требованиям журнала операций.

---

# 17. Transaction Row

```text
┌───────────────────────────────────────────────────────┐
│ [icon] Продукты                         −2 450 ₽      │
│        14.09 · Основная карта · Текущие              │
└───────────────────────────────────────────────────────┘
```

Desktop дополнительная информация:

```text
category
account
envelope
cycle
period
status
```

Mobile:

```text
title
amount
date
secondary meta
```

---

# 18. Transaction Details

Route:

```text
/app/transactions/:transactionId
```

или drawer/modal поверх списка.

Предпочтительно:

- desktop → side drawer;
- mobile → full-screen sheet/page.

---

## Content

```text
Расход

−2 450 ₽

14 сентября 2026

Продукты
Текущие 25–9
Основная карта

Описание
...

Изменения

[Редактировать]
[Удалить]
```

---

# 19. Add Expense Workflow

```text
+ Добавить
     ↓
Расход
     ↓
Form
     ↓
Preview impact
     ↓
Confirm
     ↓
Success
```

---

## Form

Required:

```text
date
amount
account
category
envelope
```

Optional:

```text
merchant
description
```

Это соответствует форме расхода в MVP.

---

# 20. Expense Confirmation

Перед сохранением показать финансовый effect:

```text
После операции

Счёт
120 000 ₽ → 117 550 ₽

Конверт
26 700 ₽ → 24 250 ₽

Доступно за период
21 800 ₽ → 19 350 ₽
```

Это делает последствия действия понятными **до подтверждения**.

---

# 21. Insufficient Funds Workflow

```text
Expense
   ↓
insufficient funds
   ↓
Warning Modal
```

```text
Недостаточно средств

В конверте
15 000 ₽

Расход
20 000 ₽

Дефицит
5 000 ₽

[Отмена]
[Продолжить]
```

При strict mode:

```text
Сохранение заблокировано
```

Настройка строгого режима предусмотрена ТЗ.

---

# 22. Add Income Workflow

```text
+ Добавить
     ↓
Доход
     ↓
Income Form
     ↓
Save
     ↓
Allocation Sheet
     ↓
Confirm Allocation
     ↓
Success
```

---

# 23. Income Form

Required:

```text
date
amount
account
income category
```

Optional:

```text
description
source
planned/unplanned
```

Фактическая сумма не ограничивается плановой.

---

# 24. Allocation Sheet

После создания дохода:

```text
Доход

106 000 ₽

Распределите деньги
```

Rows:

```text
Обязательные      [50 000 ₽]
Текущие 25–9      [36 000 ₽]
Ремонт            [20 000 ₽]
```

Footer:

```text
Распределено       106 000 ₽
Нераспределено           0 ₽
```

---

# 25. Allocation Validation

Rules:

```text
allocationTotal <= incomeAmount
```

Если:

```text
allocationTotal > incomeAmount
```

показывать:

```text
Распределено больше дохода на 4 000 ₽
```

Кнопка подтверждения disabled.

В ТЗ превышение суммы дохода распределениями запрещено.

---

# 26. Special Income Rule — Шабашка

После выбора категории:

```text
Шабашка
```

Frontend может показать suggested allocation:

```text
Предлагаем направить 100%
в конверт «Ремонт»

12 000 ₽
```

Actions:

```text
[Подтвердить]
[Изменить]
```

Не автосохранять без подтверждения.

---

# 27. Page: Accounts

Route:

```text
/app/accounts
```

---

## Layout

```text
PageHeader
AccountSummary
AccountGrid
```

---

## AccountCard

```text
Основная карта

120 000 ₽

Сбербанк
•••• 4587

Активен

[Открыть]
```

---

# 28. Account Details

Route:

```text
/app/accounts/:accountId
```

Structure:

```text
Header
Balance
Account metadata
Envelope distribution
Actions
Transactions
```

---

## Actions

```text
Перевести
Добавить расход
Редактировать
Архивировать
```

Архивированный счёт нельзя использовать для новых операций, но его история сохраняется.

---

# 29. Page: Envelopes

Route:

```text
/app/envelopes
```

---

## Tabs

```text
Все
Текущие
Обязательные
Накопления
Резервы
Свободные
```

Типы конвертов определены моделью продукта.

---

# 30. EnvelopeCard

```text
Ремонт

70 000 ₽

Цель
120 000 ₽

██████████░░░

58%

[Открыть]
```

---

# 31. Envelope Details

Route:

```text
/app/envelopes/:envelopeId
```

Structure:

```text
Envelope Header
Current balance
Goal
Progress
Monthly target
Activity
Transactions
```

---

# 32. Page: Plans

Route:

```text
/app/plans
```

---

## View

Desktop:

```text
Upcoming plans
Calendar / timeline
List
```

Mobile:

```text
Today
Upcoming
Later
```

---

# 33. Plan Lifecycle

```text
planned
   ↓
upcoming
   ↓
due
   ↓
user action
   ├── create operation
   ├── skip
   ├── mark completed
   └── disable
```

Эти действия предусмотрены моделью регулярных планов.

---

# 34. Plan-to-Transaction Flow

Когда план становится актуальным:

```text
План:

Ипотека
36 000 ₽
26 сентября
```

CTA:

```text
[Создать операцию]
```

Открывается prefilled form.

Пользователь может изменить:

```text
amount
date
account
category
envelope
comment
```

Только после этого создаётся подтверждённая операция.

---

# 35. Page: Analytics

Route:

```text
/app/analytics
```

---

## Global filters

```text
Cycle
Period
Date
Account
Category
Envelope
Type
Currency
```

ТЗ требует фильтрацию отчётов по этим измерениям.

---

## KPI cards

```text
Доходы
273 000 ₽

Расходы
98 500 ₽

Накопления
54 000 ₽

Чистый поток
120 500 ₽
```

---

## Charts

### Expenses by category

Donut chart.

### Cash flow

Line chart.

### Plan vs fact

Grouped bars / table.

### Account dynamics

Line chart.

### Envelope goals

Progress bars.

---

# 36. Analytics Drill-down

Любой значимый элемент аналитики clickable.

Например:

```text
Продукты
31 500 ₽
```

→

```text
Операции
filter.category = продукты
```

---

# 37. Page: Notifications

Route:

```text
/app/notifications
```

---

## Notification types

```text
plan_due
plan_overdue
unallocated_income
negative_account
negative_envelope
insufficient_funds
cycle_completed
significant_change
unfinished_action
```

Основа списка соответствует типам уведомлений в MVP.

---

# 38. Page: Settings

Route:

```text
/app/settings
```

Tabs:

```text
Budget
Cycle
Categories
Envelopes
Plans
Notifications
Profile
Security
Data
Audit
```

---

# 39. Budget Settings

```text
Название бюджета
Основная валюта
Разрешать отрицательные остатки
Правило шабашки
Месячные цели
Видимость блоков Dashboard
```

---

# 40. Cycle Settings

```text
Начало цикла
Граница периода
Часовой пояс
```

Для текущего бюджета:

```text
Start day: 10
Boundary offset: 15 days
```

Модель цикла в ТЗ задаётся через день начала и смещение границы периода.

---

# 41. Empty States

Каждая сущность должна иметь собственное empty state.

## Transactions

> Пока нет операций.

> Добавьте первый доход или расход, чтобы начать вести бюджет.

CTA:

```text
Добавить операцию
```

---

## Accounts

> Добавьте первый счёт.

CTA:

```text
Добавить счёт
```

---

## Envelopes

> Назначьте деньгам первое предназначение.

CTA:

```text
Создать конверт
```

---

## Plans

> Запланируйте ближайшие обязательства.

CTA:

```text
Добавить план
```

---

# 42. Loading States

Не использовать только generic spinner.

Предпочтительно:

```text
skeleton cards
skeleton rows
skeleton charts
```

Пример dashboard:

```text
██████████████████████
██████████

██████████████

████████████████
```

---

# 43. Error States

Каждый server-dependent component должен иметь:

```text
loading
success
empty
error
```

Error:

```text
Не удалось загрузить данные

Попробуйте ещё раз.

[Повторить]
```

---

# 44. Success Feedback

После финансовой операции:

```text
✓ Операция сохранена

Покупка в категории «Продукты»
2 450 ₽
```

В toast не показывать только:

> Success

---

# 45. Destructive Actions

Удаление:

```text
Удалить операцию?

Операция будет исключена
из расчётов, но останется
в журнале изменений.

[Отмена]
[Удалить]
```

После удаления:

```text
Операция удалена

[Восстановить]
```

---

# 46. Transfer UX

## Basic transfer

```text
Откуда
Основная карта

Куда
Накопительный счёт

Сумма
20 000 ₽
```

---

## Split transfer

```text
Общая сумма
20 000 ₽

Часть 1
Ремонт
15 000 ₽

Часть 2
Обязательные
5 000 ₽

Итого
20 000 ₽ / 20 000 ₽
```

Пока суммы не сходятся:

```text
[Перевести] disabled
```

Модель перевода требует равенства суммы частей общей сумме.

---

# 47. Breadcrumb strategy

Не использовать breadcrumbs повсеместно.

Использовать только внутри глубоких страниц:

```text
Счета / Основная карта
```

```text
Конверты / Ремонт
```

На mobile:

```text
← Назад
```

---

# 48. Modal / Drawer Strategy

## Desktop

Для быстрых операций:

```text
Drawer
```

Например:

- transaction details;
- add expense;
- add income;
- add transfer.

## Mobile

Использовать:

```text
Full-screen modal / sheet
```

для:

- форм;
- filters;
- details.

---

# 49. Main UI Component Map

```text
UI/
├── Button
├── IconButton
├── Input
├── MoneyInput
├── Select
├── SearchInput
├── DatePicker
├── Checkbox
├── Switch
├── Radio
├── Tabs
├── SegmentedControl
├── Badge
├── Avatar
├── Tooltip
├── Dropdown
├── Modal
├── Drawer
├── BottomSheet
├── Toast
├── Alert
├── Skeleton
├── EmptyState
├── ErrorState
├── ProgressBar
├── ProgressRing
└── Table
```

---

# 50. Domain Components

```text
domain/
├── AvailableBudgetCard
├── AccountCard
├── AccountBalance
├── AccountDistribution
├── EnvelopeCard
├── EnvelopeProgress
├── TransactionRow
├── TransactionAmount
├── TransactionStatus
├── AllocationRow
├── AllocationSummary
├── PlanCard
├── PlanStatus
├── NotificationItem
├── PeriodBadge
├── CycleTimeline
└── BudgetWarning
```

---

# 51. Composite Components

```text
features/
├── Dashboard
├── TransactionList
├── TransactionFilters
├── TransactionForm
├── IncomeForm
├── IncomeAllocation
├── ExpenseForm
├── TransferForm
├── AccountDetails
├── EnvelopeDetails
├── PlanList
├── PlanForm
├── AnalyticsDashboard
├── NotificationCenter
└── SettingsPanels
```

---

# 52. UI State Model

Каждый компонент должен явно проектироваться с состояниями:

```text
default
hover
focus
active
disabled
loading
empty
error
warning
success
```

Для финансовых компонентов дополнительно:

```text
positive
negative
zero
unallocated
overdue
```

---

# 53. Responsive Rules

## ≥ 1280px

Desktop.

```text
sidebar + content
```

---

## 1024–1279px

Compact desktop/tablet.

Sidebar:

```text
icons + labels
```

Dashboard:

```text
2 columns
```

---

## 768–1023px

Tablet.

Sidebar → compact.

Карточки:

```text
2 columns
```

---

## < 768px

Mobile.

Sidebar:

```text
bottom navigation
```

Карточки:

```text
1 column
```

Tables:

```text
cards / horizontal scroll
```

Forms:

```text
single column
```

---

# 54. Mobile Priority

На mobile порядок внутри Dashboard:

```text
1. Можно потратить
2. Период
3. Предупреждения
4. Ближайшие обязательства
5. Конверты
6. Счета
7. Последние операции
```

Счета не должны вытеснять главный финансовый показатель.

---

# 55. Accessibility Rules

Все элементы:

- доступны с клавиатуры;
- имеют visible focus;
- имеют понятные labels;
- не зависят только от цвета;
- поддерживают screen reader базового уровня.

FAQ:

```text
aria-expanded
aria-controls
```

Icon-only controls:

```text
aria-label
```

Ошибки должны быть привязаны к конкретным полям.

Это соответствует требованиям accessibility продукта.

---

# 56. Formatting Rules

Currency:

```text
1 234,56 ₽
```

Date:

```text
ДД.ММ.ГГГГ
```

Default timezone:

```text
Europe/Moscow
```

Эти правила определены в ТЗ.

---

# 57. Money Color Semantics

Не использовать цвет как единственный способ определения типа операции.

Дополнительно:

```text
+106 000 ₽
Доход

−2 450 ₽
Расход

20 000 ₽
Перевод
```

Цвет только усиливает семантику.

---

# 58. Form UX Rules

Все формы:

```text
label
field
helper/error
```

Ошибки:

```text
под конкретным полем
```

и при submit:

```text
общий summary
```

Валидация должна быть понятной пользователю.

---

# 59. Navigation State

После возврата назад:

- сохранять filters;
- сохранять scroll position;
- сохранять active tab;
- не сбрасывать контекст без причины.

Например:

```text
Analytics
 → Expenses
 → Products
 → Operations
```

После возврата:

```text
Analytics
```

должна остаться в том же фильтре.

---

# 60. Deep linking

Должны поддерживаться URL состояния:

```text
/app/transactions?category=products
```

```text
/app/analytics?cycle=current
```

```text
/app/accounts/123
```

```text
/app/envelopes/456
```

URL не должен быть источником security.

Права проверяются на backend.

---

# 61. Onboarding

Первоначальный flow:

```text
/register
    ↓
/onboarding/start
    ↓
/onboarding/cycle
    ↓
/onboarding/account
    ↓
/onboarding/envelopes
    ↓
/onboarding/complete
    ↓
/app/dashboard
```

---

# 62. Onboarding Completion Criteria

Пользователь должен иметь:

```text
✓ budget
✓ cycle
✓ at least one account
✓ initial balance
✓ default envelopes
```

После завершения:

```text
Dashboard
```

не должна быть пустой.

---

# 63. Example First Session

После onboarding пользователь попадает на:

```text
Сегодня

Можно потратить

12 000 ₽
```

Ниже:

```text
Счета
100 000 ₽
```

```text
Обязательные
50 000 ₽

Ремонт
20 000 ₽

Свободные
12 000 ₽
```

И action:

```text
+ Добавить расход
```

---

# 64. Critical UX Scenario

Пользователь получил:

```text
99 000 ₽
```

при плане:

```text
100 000 ₽
```

UX:

```text
Доход 99 000 ₽
        ↓
никакой ошибки
        ↓
распределение
        ↓
лимит пересчитан
```

Плановая сумма не должна блокировать сохранение.

---

# 65. Critical UX Scenario — Repair

Пользователь получил:

```text
+12 000 ₽
Шабашка
```

System:

```text
Предлагаем:

Ремонт +12 000 ₽
```

User:

```text
[Подтвердить]
```

После confirmation:

```text
Ремонт
70 000 ₽ → 82 000 ₽
```

При этом счёт не получает дополнительные 12 000 ₽ повторно — доход и распределение не должны дублировать движение денег.

---

# 66. Critical UX Scenario — Transfer

```text
Карта
120 000 ₽

       ↓ 20 000 ₽

Накопительный
75 000 ₽
```

После операции:

```text
Карта
100 000 ₽

Накопительный
95 000 ₽
```

Общий баланс:

```text
195 000 ₽
```

до и после перевода остаётся одинаковым.

---

# 67. Critical UX Scenario — End of Period

При приближении границы:

```text
Осталось 2 дня

Можно потратить
5 600 ₽
```

Notification:

```text
Период 25–9 заканчивается
через 2 дня.
```

После перехода:

```text
Новый период
10–24
```

История операций сохраняется.

---

# 68. UX Copy Rules

Использовать:

```text
Можно потратить
Осталось
Потрачено
Распределено
Нераспределено
Предстоит
Назначение
```

Не использовать технические термины:

```text
distribution
ledger
posting
transaction entity
source account
destination envelope
```

---

# 69. Design System Relationship

Frontend должен использовать единую HarmoFin Design System.

Hierarchy:

```text
Design Tokens
    ↓
UI Components
    ↓
Domain Components
    ↓
Feature Components
    ↓
Pages
```

Не наоборот.

Pages не должны самостоятельно определять:

```text
colors
font sizes
border radius
spacing
shadows
```

---

# 70. Recommended Frontend Folder Structure

Пример для Vue 3 + TypeScript:

```text
src/
├── app/
│   ├── router/
│   ├── layouts/
│   └── providers/
│
├── pages/
│   ├── auth/
│   ├── onboarding/
│   └── app/
│
├── features/
│   ├── dashboard/
│   ├── transactions/
│   ├── accounts/
│   ├── envelopes/
│   ├── plans/
│   ├── analytics/
│   ├── notifications/
│   └── settings/
│
├── components/
│   ├── ui/
│   └── domain/
│
├── composables/
├── stores/
├── services/
├── types/
├── utils/
└── styles/
```

Не помещать domain-specific business logic в `components/ui`.

---

# 71. State Ownership

## Global state

Использовать только для:

- auth;
- current user;
- workspace;
- current budget;
- notifications summary.

## Feature state

Локализовать:

- filters;
- forms;
- drawers;
- modals;
- temporary allocation state.

Не помещать временное состояние формы в глобальный store без причины.

---

# 72. API Boundary

UI components не должны знать детали API.

Плохо:

```ts
component → axios → API
```

Предпочтительно:

```text
Component
   ↓
Feature composable
   ↓
Service / API layer
   ↓
Generated API client
```

---

# 73. Domain Types

Минимальные frontend types:

```ts
Budget
Account
Envelope
Category
Transaction
IncomeDistribution
Transfer
TransferPart
RecurringPlan
Notification
AuditEvent
FinancialPeriod
FinancialCycle
```

Они должны соответствовать domain model продукта.

---

# 74. Component Contract Rule

Каждый сложный компонент должен иметь понятный contract.

Пример:

```ts
type AvailableBudgetCardProps = {
  period: FinancialPeriod
  limit: number
  spent: number
  remaining: number
  daysLeft: number
}
```

Компонент не должен самостоятельно рассчитывать domain data.

Расчёт:

```text
service / composable
```

UI:

```text
component
```

---

# 75. Business Logic Boundary

Не переносить бизнес-правила в UI.

Например:

Правило:

```text
distribution total <= income total
```

должно быть валидировано backend/domain layer.

Frontend:

- показывает validation;
- блокирует очевидно невозможные действия;
- предоставляет понятную обратную связь.

Но frontend не является единственным источником истины.

---

# 76. Final UX Architecture

Итоговая схема:

```text
                       HARMOFIN
                           │
              ┌────────────┴────────────┐
              │                         │
          ONBOARDING               APPLICATION
                                        │
        ┌───────────────────────────────┼────────────────────┐
        │                               │                    │
    DASHBOARD                      OPERATIONS             PLAN
        │                               │                    │
        │                     ┌─────────┼──────────┐         │
        │                     │         │          │         │
        │                   INCOME    EXPENSE    TRANSFER    │
        │                     │         │          │         │
        │                  ALLOCATE   ENVELOPE   ACCOUNT     │
        │                               │                    │
        ├──────── ACCOUNTS ─────────────┤                    │
        │                               │                    │
        ├──────── ENVELOPES ────────────┤                    │
        │                                                    │
        ├──────── ANALYTICS ─────────────────────────────────┤
        │                                                    │
        ├──────── NOTIFICATIONS ─────────────────────────────┤
        │                                                    │
        └──────── SETTINGS ─────────────────────────────────┘
```

---

# 77. User Journey — Golden Path

Главный сценарий продукта:

```text
REGISTER
   ↓
ONBOARDING
   ↓
CREATE BUDGET
   ↓
CREATE ACCOUNT
   ↓
SET INITIAL BALANCE
   ↓
DASHBOARD
   ↓
ADD INCOME
   ↓
ALLOCATE
   ↓
ADD EXPENSES
   ↓
CHECK AVAILABLE BUDGET
   ↓
MANAGE PLANS
   ↓
TRACK GOALS
   ↓
ANALYZE RESULTS
```

---

# 78. UI Golden Path

Главная задача интерфейса:

```text
Сделать деньги понятными
        ↓
Снизить когнитивную нагрузку
        ↓
Сделать последствия действий видимыми
        ↓
Не скрывать проблемы
        ↓
Помочь принять следующее финансовое решение
```

---

# 79. Definition of UX Done

UI/UX считается готовым, если пользователь без документации может:

- создать бюджет;
- настроить финансовый цикл;
- добавить счёт;
- внести начальный баланс;
- добавить доход;
- распределить доход;
- добавить расход;
- выбрать конверт;
- сделать перевод;
- создать накопительную цель;
- добавить регулярный план;
- подтвердить плановый платёж;
- увидеть доступный лимит;
- найти любую операцию;
- посмотреть аналитику;
- восстановить удалённую операцию.

Все эти сценарии входят в функциональную область MVP.

---

# 80. Definition of Frontend Done

Перед завершением frontend agent обязан проверить:

```text
□ All routes implemented
□ All navigation states
□ Desktop layout
□ Tablet layout
□ Mobile layout
□ Empty states
□ Loading states
□ Error states
□ Warning states
□ Success states
□ Keyboard navigation
□ Focus states
□ No horizontal overflow
□ No console errors
□ TypeScript passes
□ ESLint passes
□ Build passes
```

---

# 81. Final UX Rule

В любой непонятной ситуации frontend agent должен выбирать вариант, который лучше отвечает на вопрос:

> **«Что пользователю нужно понять или сделать прямо сейчас?»**

а не:

> **«Как лучше показать внутреннюю структуру данных?»**

HarmoFin должен чувствоваться как:

> **финансовый control center**, 

а не как бухгалтерский журнал.

Главный элемент интерфейса:

```text
┌───────────────────────────────┐
│      МОЖНО ПОТРАТИТЬ          │
│                               │
│         21 800 ₽              │
│                               │
│      Осталось 7 дней          │
│      ≈ 3 114 ₽ / день         │
└───────────────────────────────┘
```

Остальной UI существует для того, чтобы объяснить пользователю эту цифру и помочь управлять причинами, которые на неё влияют.