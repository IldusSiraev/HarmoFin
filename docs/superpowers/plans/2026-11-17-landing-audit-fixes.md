# Исправления аудита лендинга

## Packet и план

Writer: `landing_fixes`, единственный writer. Цель — исправить четыре подтверждённых дефекта из `identity/illustrations/landing-audit-2026-11-16.md` и уменьшить загружаемые иллюстрации. Source of truth: Calm Fintech guidelines, действующие компоненты и согласованные иллюстрации. Финансовая логика, тексты, API и доступ не меняются. Без новых зависимостей, worktree, commit/push и локального Playwright.

1. Устранить intrinsic min-width первого экрана и вложенные отступы мобильных витрин.
2. Уместить заголовок и полную сумму ближайшего платежа: shared-компонент исправляется на уровне его responsive layout, сохраняет ссылки и статусы.
3. Обеспечить белому тексту brand-кнопок контраст 4.5:1 во всех enabled-состояниях и обеих темах; ссылки используют текстовый токен. Декоративный brand не меняется.
4. Возвращать фокус после Escape только если меню было открыто.
5. Создать WebP 640/960px, srcset/sizes; исходные PNG и прежние ассеты сохраняются.
6. Focused checks, независимые UI/QA/final reviews, CUA-матрица 1440/768/390/320 в обеих темах, затем production build после остановки dev.

## Реализация

- Убрана принудительная ширина body 320px, которая переполняла usable viewport 305px при классическом scrollbar. Hero использует minmax(0,1fr), min-width:0 и адаптивный размер суммы только в витрине.
- До 600px LandingShowcase не добавляет вторую рамку и padding поверх настоящей карточки.
- Каждая строка UpcomingObligations получает именованный inline-size container. При узком контейнере сумма занимает собственную строку; дата и стрелка сохраняются. Это действует и для узких ячеек многоколоночного списка на планшете, независимо от ширины всей карточки. Заголовок допускает перенос MoreLink.
- Action-brand: #127A75, hover #0B6E67, active #095E59. Палитра логотипа и декоративные цвета остаются прежними. Новые математические regression tests проверяют контраст enabled-состояний в обеих темах.
- Escape regression сначала воспроизведён падающим тестом, после исправления проходит; отдельный тест защищает закрытое меню от перехвата фокуса.
- `identity/illustrations/optimize.mjs` воспроизводит WebP через переданный путь к существующему Sharp; зависимость продукта не добавляется. PNG не ретушировались. Выбраны quality90/alphaQuality100, размеры640/960, старая композиция сохранена.

## Receipt

- Focused Vitest: 19 файлов, 115 тестов PASS, 6.54s. Сюда входят landing, brand, styles, Button, UpcomingObligations, AvailableBudgetCard и три landing-data файла.
  Команда из `apps/web`: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts app/components/landing app/components/brand app/assets/styles app/components/ui/Button.test.ts app/components/dashboard/UpcomingObligations.test.ts app/components/dashboard/AvailableBudgetCard.test.ts app/data/landing.test.ts app/data/landing-demo.test.ts app/data/landing-seo.test.ts`.
- После переноса container query на каждую строку: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts app/components/dashboard/UpcomingObligations.test.ts app/assets/styles/brand-contrast.test.ts app/components/landing/LandingHeader.test.ts` — PASS, 3 файла, 16 тестов, 2.27s.
- Первоначальные сбои загрузки static srcset через Vite/happy-dom устранены использованием bound srcset; тесты прошли. Escape сначала RED, затем GREEN.
- Prettier затронутых текстовых файлов и git diff --check: PASS. Scoped ESLint девяти Vue/test файлов: exit0, 0 ошибок, 22 formatter/style предупреждения.
- Combined WebP: 640px — 58486 байт (против исходных 930134, на 93.7% меньше); 960px — 96200 байт (на 89.7% меньше). Это lossy quality90 с полным alphaQuality100; визуальный контроль сравнения выполняет root.
- CUA root: восемь сочетаний 1440/768/390/320px и обеих тем прошли проверку. Карточки и суммы строк внутри собственных ячеек; Escape возвращает фокус на кнопку меню. Обе иллюстрации просмотрены в фактическом размере, видимого ухудшения от компрессии не отмечено.
- Evidence: `landing-fixes-dark.json`, `landing-fixes-light.json`, снимки `landing-fixed-payments-320.png`, `landing-fixed-final-dark.png` в `C:/Users/user/.codex/visualizations/2026/11/14/01a1dae6-048e-7ce0-92af-d21ff7aa7a09/`.
- Root восстановил исходную тему и viewport, закрыл вкладку и удалил временный `public/__landing-audit.html`. Известный dev-процесс остановлен перед production build.
- Production build: `node node_modules/nuxt/bin/nuxt.mjs build` из `apps/web`, вне sandbox — PASS, exit0, 3m21s. Первый запуск в sandbox компилировался, но EPERM symlink для nostics приводил к runtime500; повтор вне sandbox устранил проблему без изменений исходников. Остались предупреждения DEP0155 внешних зависимостей и времени плагинов.
- Production smoke: `node .output/server/index.mjs`, HTTP GET / — 200; HTML содержит HarmoFin и адаптивный WebP. `.output/public/__landing-audit.html` отсутствует.
- QA и UI/UX: APPROVE. Final review после build/smoke: APPROVE. Root завершил build receipt после остановки writer.
