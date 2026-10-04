-- HarmoFin: полный сброс учётных данных одного бюджета и перевод его на модель v2.
-- Runbook: docs/runbooks/budget-reset.md. Перед запуском обязателен backup (docs/runbooks/database-restore.md).
--
-- Запуск: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/runbooks/budget-reset.sql
-- По умолчанию dry-run: блок печатает счётчики (NOTICE) и откатывает всё исключением.
-- Для фиксации измените commit_changes на true.
--
-- Скрипт использует DELETE ... WHERE budget_id = v_budget_id, UPDATE audit_events (budget_id -> NULL) и UPDATE budgets по id.
-- Нет DROP, TRUNCATE, отключения триггеров и FK. Весь блок выполняется в одной транзакции.

DO $$
DECLARE
  -- === Параметры ===
  target_email   text    := 'owner@example.com';
  commit_changes boolean := false;
  -- ==================

  v_user_id      uuid;
  v_user_count   integer;
  v_budget_count integer;
  v_owner_count  integer;
  v_budget_id    uuid;
  v_workspace_id uuid;
  v_timezone     text;
  v_today        date;
  v_n            bigint;
  v_total        bigint;
  v_counts       jsonb := '{}'::jsonb;
  v_table        text;
  v_left         bigint;
BEGIN
  -- Не ждём чужие блокировки бесконечно: остановите API и worker перед запуском.
  PERFORM set_config('lock_timeout', '10s', true);

  IF lower(btrim(target_email)) = 'owner@example.com' THEN
    RAISE EXCEPTION 'target_email не задан: замените значение-заглушку на email пользователя';
  END IF;

  -- 1. Пользователь: email хранится в нижнем регистре, сравниваем без учёта регистра.
  SELECT count(*) INTO v_user_count
    FROM users WHERE lower(email) = lower(btrim(target_email));
  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'Пользователь с email % найден % раз, ожидается ровно один', target_email, v_user_count;
  END IF;
  SELECT id INTO v_user_id FROM users WHERE lower(email) = lower(btrim(target_email));

  -- 2. Бюджет: ровно один во всех рабочих пространствах, где пользователь активный OWNER.
  SELECT count(*) INTO v_budget_count
    FROM budgets b
    JOIN workspace_memberships m ON m.workspace_id = b.workspace_id
   WHERE m.user_id = v_user_id AND m.role = 'OWNER' AND m.is_active AND m.removed_at IS NULL;
  IF v_budget_count <> 1 THEN
    RAISE EXCEPTION 'У пользователя % бюджетов с активным членством OWNER: %, ожидается ровно один', target_email, v_budget_count;
  END IF;
  SELECT b.id, b.workspace_id, b.timezone INTO v_budget_id, v_workspace_id, v_timezone
    FROM budgets b
    JOIN workspace_memberships m ON m.workspace_id = b.workspace_id
   WHERE m.user_id = v_user_id AND m.role = 'OWNER' AND m.is_active AND m.removed_at IS NULL
     FOR UPDATE OF b;

  -- Рабочее пространство должно иметь ровно одного активного OWNER: иначе сброс затронул бы чужие данные.
  SELECT count(*) INTO v_owner_count
    FROM workspace_memberships
   WHERE workspace_id = v_workspace_id AND role = 'OWNER' AND is_active AND removed_at IS NULL;
  IF v_owner_count <> 1 THEN
    RAISE EXCEPTION 'В рабочем пространстве % активных OWNER: %, ожидается ровно один', v_workspace_id, v_owner_count;
  END IF;

  RAISE NOTICE 'Бюджет % (workspace %) выбран для сброса, commit_changes=%', v_budget_id, v_workspace_id, commit_changes;

  -- 3. Удаление дочерних таблиц раньше родительских (все FK ON DELETE RESTRICT).
  DELETE FROM plan_payments WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('plan_payments', v_n);

  DELETE FROM notifications WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notifications', v_n);

  DELETE FROM envelope_assignments WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelope_assignments', v_n);

  DELETE FROM envelope_movements WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelope_movements', v_n);

  DELETE FROM envelope_periods WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelope_periods', v_n);

  DELETE FROM envelope_funding_rules WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelope_funding_rules', v_n);

  DELETE FROM envelope_reallocations WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelope_reallocations', v_n);

  DELETE FROM income_allocations WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('income_allocations', v_n);

  DELETE FROM transfer_parts WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('transfer_parts', v_n);

  DELETE FROM transfers WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('transfers', v_n);

  DELETE FROM plan_occurrences WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('plan_occurrences', v_n);

  DELETE FROM regular_plans WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('regular_plans', v_n);

  DELETE FROM transactions WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('transactions', v_n);

  DELETE FROM idempotency_records WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('idempotency_records', v_n);

  -- Аудит не удаляется: история отвязывается от бюджета (workspace_id, actor, entity_id сохраняются).
  UPDATE audit_events SET budget_id = NULL WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('audit_events_detached', v_n);

  DELETE FROM budget_cycle_revisions WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('budget_cycle_revisions', v_n);

  DELETE FROM envelopes WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('envelopes', v_n);

  -- categories ссылаются сами на себя (parent) с ON DELETE RESTRICT: удаляем листья слоями.
  v_total := 0;
  LOOP
    DELETE FROM categories c
     WHERE c.budget_id = v_budget_id
       AND NOT EXISTS (
         SELECT 1 FROM categories ch WHERE ch.budget_id = c.budget_id AND ch.parent_id = c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    v_total := v_total + v_n;
  END LOOP;
  IF EXISTS (SELECT 1 FROM categories WHERE budget_id = v_budget_id) THEN
    RAISE EXCEPTION 'Не удалось удалить категории бюджета: обнаружен цикл parent_id';
  END IF;
  v_counts := v_counts || jsonb_build_object('categories', v_total);

  DELETE FROM accounts WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('accounts', v_n);

  -- 4. Защита от пропусков: ни одна таблица с budget_id не должна сохранить строки бюджета.
  FOR v_table IN
    SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'budget_id' AND t.table_type = 'BASE TABLE'
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE budget_id = $1', v_table) INTO v_left USING v_budget_id;
    IF v_left > 0 THEN
      RAISE EXCEPTION 'Таблица % сохранила % строк бюджета: скрипт не покрывает её, изменения откатываются', v_table, v_left;
    END IF;
  END LOOP;

  -- 5. Бюджет: модель v2 с сегодняшней датой в часовом поясе бюджета, правило распределения дохода сброшено.
  --    name, timezone, валюта, cycle_start_day, period_boundary_offset, allow_negative_balance, status не меняются.
  v_today := (now() AT TIME ZONE v_timezone)::date;
  UPDATE budgets
     SET plan_model_version = 2,
         plan_model_activated_on = v_today,
         income_allocation_rule_enabled = false,
         income_allocation_source_category_id = NULL,
         income_allocation_target_envelope_id = NULL,
         updated_at = now()
   WHERE id = v_budget_id;

  -- 6. Один след в аудите без бюджета (его строки удалены выше) и без сумм: только счётчики.
  INSERT INTO audit_events (id, actor_user_id, workspace_id, budget_id, entity_type, entity_id, action, new_values, source)
  VALUES (gen_random_uuid(), v_user_id, v_workspace_id, NULL, 'budget', v_budget_id, 'budget.reset',
          jsonb_build_object('deletedRows', v_counts, 'planModelVersion', 2, 'committed', commit_changes),
          'runbook');

  -- 7. Отчёт: только число строк, без финансовых значений.
  FOR v_table IN SELECT jsonb_object_keys(v_counts) LOOP
    RAISE NOTICE 'обработано в % (удалено; для audit_events_detached отвязано): %', v_table, v_counts ->> v_table;
  END LOOP;
  RAISE NOTICE 'budgets: plan_model_version=2, plan_model_activated_on=% (timezone %)', v_today, v_timezone;

  IF NOT commit_changes THEN
    RAISE EXCEPTION 'DRY RUN: изменения откатены';
  END IF;
END
$$;
