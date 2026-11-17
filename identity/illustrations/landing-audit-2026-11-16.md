# Общая проверка лендинга — 16.11.2026

## Packet

- Цель: проверить текущий лендинг после подключения айдентики и двух иллюстраций, без расширения функциональности и исправления продуктового кода.
- Writer тестовых артефактов: `landing_audit_checks`. Остальные агенты выполняют только чтение/review и браузерную проверку.
- Граница: этот отчёт и временный локальный `apps/web/public/__landing-audit.html`. Существующие продуктовые файлы не изменяются.
- Source of truth: AGENTS.md, Calm Fintech guidelines от 2026-09-17, текущие компоненты лендинга, согласованные размещения в fitting-notes.md и shared-goals-notes.md.
- Проверки: все unit-тесты компонентов лендинга и бренда, данные лендинга; scoped ESLint/Prettier; CUA 1440/768/390/320 px, светлая/тёмная темы, меню/якоря/FAQ/доступность. Отдельно — ранее замеченное горизонтальное переполнение.
- Запрещено: правки продуктового кода, commit/push/deploy, worktree, локальный Playwright, новые зависимости и финансовые мутации.

## Автоматизированные проверки

- `apps/web`: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts app/components/landing app/components/brand app/data/landing.test.ts app/data/landing-demo.test.ts app/data/landing-seo.test.ts` — PASS, 14 файлов, 60 тестов, 11.14s.
- Первый запуск не выполнил тесты из-за EPERM при rename временных файлов sandbox. Повторный запуск с разрешением вне песочницы прошёл; это не продуктовая ошибка.
- `apps/web`: `node node_modules/eslint/bin/eslint.js app/components/landing/sections/AccountsEnvelopesSection.vue app/components/landing/sections/AccountsEnvelopesSection.test.ts app/components/landing/sections/FinalCtaSection.vue app/components/landing/sections/FinalCtaSection.test.ts app/components/landing/ui/LandingSection.vue app/components/landing/ui/LandingSection.test.ts` — exit 0, 0 ошибок, 20 formatter/style warnings. Исправления не выполнялись.
- Корень: `node node_modules/prettier/bin/prettier.cjs --check` для тех же шести Vue/test-файлов — PASS.
- Полная production-сборка не запускалась: validation-only, dev-сервер используется для CUA. Локальный Playwright не запускался.

## Браузерная проверка и ограничения

Через CUA проверена реальная страница на 1440/768/390/320px в обеих темах, всего восемь сочетаний. Сохранены измерения реального iframe DOM, computed styles и снимки. Все новые иллюстрации и согласованная раскладка просмотрены на светлом и тёмном фоне; обрезки новых изображений не обнаружено.

### Подтверждённые проблемы

- В обеих темах при внешних 320px: clientWidth 305px, scrollWidth 320px — общее горизонтальное переполнение. Карточка available-budget имеет right 330px при right рамки 304px; obligations right 386px при right рамки 301px. Часть содержимого витрин обрезается.
- При внешних 390px: clientWidth/scrollWidth 375/375 — общего переполнения страницы **нет**. Однако obligations right 387px при right рамки 356px: остаётся внутреннее обрезание карточки. Оно не должно ошибочно считаться отсутствующим только по scrollWidth страницы.
- Контраст основного действия: фактический белый текст 16px на `#1BA39C` даёт приблизительно 3.10:1, ниже требуемых 4.5:1 для обычного текста. Hero eyebrow и вторичная ссылка используют brand-цвет; на светлой подложке `#E3F5F3` получается около 2.75:1. Подробный приоритет и привязки к исходникам фиксирует UI review.
- Escape закрывает мобильное меню, но фокус после сфокусированной ссылки «Возможности» уходит в AXWebArea, а не возвращается на кнопку открытия меню.

### Успешные наблюдения

- FAQ раскрывается и сворачивается; фокус сохраняется на кнопке вопроса.
- Новые изображения не обрезаются, десктопная двухколоночная и мобильная последовательная раскладки сохранены в обеих темах.
- Автоматизированные проверки: 60 тестов PASS; ESLint без ошибок; форматирование PASS.

### Приоритеты UI review

1. **P1 — `apps/web/app/components/landing/ui/LandingShowcase.vue:35`:** рамка обрезает карточку обязательных платежей; на мобильном часть финансовых данных недоступна визуально.
2. **P2 — `apps/web/app/components/landing/sections/HeroSection.vue:54`:** grid/card overflow первого экрана на узкой ширине; требуется устранить выход карточки за доступный размер.
3. **P2 — `apps/web/app/components/ui/Button.vue:151`:** белый обычный текст на brand-фоне даёт около 3.1:1. Сопутствующий низкий контраст текстовых ссылок: `HeroSection.vue:73`, `HeroSection.vue:95`, `FinalCtaSection.vue:88` в той же папке sections.
4. **P2 — `apps/web/app/components/landing/LandingHeader.vue:28`:** после Escape из мобильной навигации фокус не возвращается к её кнопке.

Замечания не исправлялись: область задачи — аудит. Это приоритеты UI review по наблюдениям и текущим исходникам; строки относятся к состоянию рабочей копии на момент проверки.

Final reviewer: **APPROVE полноты отчёта аудита**. Это не одобрение готовности лендинга: **UI readiness — BLOCK** из-за четырёх перечисленных замечаний.

### Вес и практические ограничения

Два подключённых WebP весят 521368 и 408766 байт, суммарно 930134 байта (около 0.93MB). Уменьшение растров под фактический размер показа — рекомендация по оптимизации, а не новое функциональное падение. Product code в рамках аудита не менялся. Полная production-сборка, локальный Playwright и проверка настоящим screen reader не выполнялись; accessibility-выводы ограничены CUA/AX и компонентными тестами.

### Evidence

Каталог: `C:/Users/user/.codex/visualizations/2026/11/14/01a1dae6-048e-7ce0-92af-d21ff7aa7a09/`.

- `audit-light-matrix.json`, `audit-1440-light.txt`, `audit-dark-matrix.json` — размеры и computed styles для матрицы.
- `audit-mobile-clipped-payments.png` — видимое обрезание платежей на мобильном.
- Orchestrator восстановил исходную тему через кнопку harness, сбросил viewport и закрыл проверочную вкладку. После проверки точного resolved path удалён только созданный `apps/web/public/__landing-audit.html`; его отсутствие подтверждено git status. Итоговый `git diff --check` — PASS. Временная debug-страница не остаётся в продукте.

Временный локальный harness показывал настоящее приложение в same-origin iframe. Он сохранял исходный ключ `harmofin-theme`, позволял выбрать темы и восстановить исходное значение. Кнопка «Проверить» только читала размеры DOM, computed colors и количество потенциально фокусируемых элементов; не меняла iframe DOM и не читала пользовательские финансовые данные. Исходное значение восстановлено, временный файл удалён. Debug-страница не предназначена для поставки и не оставлена в продукте.
