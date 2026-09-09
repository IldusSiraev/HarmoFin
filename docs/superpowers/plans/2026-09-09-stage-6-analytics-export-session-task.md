# Stage 6: аналитика, цели накоплений и CSV-экспорт

## Назначение

Этот документ — задача для новой Claude Code сессии. Он задаёт implementation Stage 6 по утверждённым design и detailed plan. Работать task-by-task; после каждого утверждённого Task останавливаться и ждать явного подтверждения.

## Предусловие

Начинать с актуальной `main` после merge Stage 5:

```bash
git switch main
git pull --ff-only
git switch -c feat/stage-6-analytics-export
```

Работать только в текущем checkout. Не создавать worktree, не запускать subagents, workflows или agent-driven development. Не переходить к следующему Task автоматически.

## Обязательные источники

До реализации прочитать:

- `CLAUDE.md`;
- `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`: разделы 7.4, 13, 14.3, 14.6–14.7, 17.2–17.4 и 21;
- `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`: разделы 4.6, 9, 19 Stage 6 и export/security requirements;
- `docs/superpowers/specs/2026-09-09-stage-6-analytics-export-design.md`;
- `docs/superpowers/plans/2026-09-09-stage-6-analytics-export.md`;
- существующие `reports`, `transactions`, `envelopes`, `operations`, analytics web components и Stage 5 plans/occurrences.

## Scope

Реализовать полный Stage 6:

- typed server report contracts;
- plan/fact для `INCOME` и `EXPENSE` occurrences;
- server projection progress накопительных целей;
- owner-only synchronous UTF-8 CSV export отфильтрованного журнала до 10,000 строк;
- typed analytics UI, goal progress и owner CSV download;
- responsive/accessibility polish и CI-only browser proof.

## Неподвижные правила

- Суммы и server calculations: `BIGINT`/canonical minor strings. Никаких float calculations в client.
- Только `CONFIRMED` financial records влияют на actual values, balance и goal progress.
- Plan/fact не создаёт операции; `SAVINGS` occurrence не получает искусственный actual amount.
- Все reads/exports filter-ят `workspace_id`, `budget_id`, membership и role в database query. Чужие IDs возвращают `404 RESOURCE_NOT_FOUND`.
- CSV download доступен только `OWNER`; `EDITOR` и `VIEWER` получают `403 FORBIDDEN`.
- CSV: UTF-8 BOM, semicolon delimiter, RFC 4180 quotes, CRLF, formula-injection escape, fixed trusted filename, максимум 10,000 rows. Нет XLSX, S3, export worker, temp files или signed links.
- UI и user-facing errors — русский. Новые API schemas/OpenAPI docs обязательны.
- Не запускать `pnpm test:e2e` локально без нового явного разрешения. Сценарий писать только для CI.

## Implementation milestones

1. Typed reports, `plan-vs-actual` и server journal `planId` filter.
2. Typed goal-progress projection.
3. CSV export API, owner policy и CSV encoder.
4. Analytics UI для plan/fact и goals.
5. Owner CSV download в operations journal.
6. Cross-cutting integration, responsive/accessibility и CI-only Playwright coverage.
7. Final quality gate and inline review.

## Final verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
```

Не merge, push, create PR или delete branch без отдельного подтверждения пользователя.
