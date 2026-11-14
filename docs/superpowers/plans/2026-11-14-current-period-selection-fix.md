# План: текущий период — 14.11.2026

## Packet

Цель: однозначный серверный текущий конверт по действующему слоту цикла.
Граница: envelope-plan application/repository, регрессионные unit-тесты.
Запрещено: менять суммы, операции, даты периодов, схему, продакшн; commit/push/deploy/Playwright/worktree.
Source of truth: функциональная спецификация §21.4; Envelope Plan v2.2 §5.1; cycle-settings-at.ts.
Writer: period_fix (единственный).
Acceptance: одинаковые даты у FIRST/SECOND не делают оба текущими; обратная половина, локальная граница суток и ревизия работают; денежные поля сохранены.
Reviewers: QA, Financial, API, final; назначает root после receipt.

## Шаги и проверки

1. RED: повторить пересечение 10–24 ноября с первой/второй половиной, локальной границей.
2. GREEN: читать бюджетные настройки и слот конверта, применять revision-aware текущий слот.
3. Проверить исторические/будущие периоды, null-slot и ревизию.
4. API unit, typecheck, ESLint изменённых файлов; независимые review.

## Evidence

Исходный RED: 3 assertion failures current=true вместо false; остальные 518 API unit-тестов прошли.
После исправления focused unit: 6/6 прошли (14:09, локальное время).
API typecheck: exit 0 после исправления необязательного параметра тестового tuple (прямой node/typescript, session 69124).
ESLint трёх изменённых API файлов: exit 0.
Существующий frontend AppOperationDialogs.test.ts: 35/35 passed, прямой node/vitest из apps/web.
Финальный focused unit: 6/6 passed, независимо повторён root.
Полный API unit suite: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts` из `apps/api` — exit 0, 79 файлов / 524 теста passed; выполнено root.
Независимые проверки: Financial — APPROVE; QA — APPROVE; final review — APPROVE.
DB integration и local Playwright не выполнялись. Данные продакшна не менялись.
