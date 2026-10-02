<script setup lang="ts">
import { computed } from 'vue';
import { definePageMeta } from '#imports';

import { useAuth } from '../../composables/useAuth.js';

defineOptions({ name: 'AppHelpPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
// Model 2 budgets get the new explanation; model 1 keeps the legacy text until cutover.
const isV2 = computed(
  () => auth.currentData.value?.workspaces[0]?.budgets[0]?.planModelVersion === 2,
);
</script>

<template>
  <div class="help-page">
    <section v-if="isV2" class="help-page__content" data-testid="help-v2">
      <p class="help-page__kicker">Справка</p>
      <h1>Как пользоваться HarmoFin</h1>
      <p class="help-page__description">
        Четыре числа показывают, где ваши деньги и сколько из них уже предназначено на цели.
      </p>

      <dl class="help-page__terms">
        <div class="help-page__term">
          <dt>На счетах</dt>
          <dd>Сколько денег реально лежит на ваших счетах и в наличных.</dd>
        </div>
        <div class="help-page__term">
          <dt>Назначено</dt>
          <dd>
            Часть денег, которую вы отметили для обязательных платежей, накоплений и других целей.
            Назначение — это пометка, а не отдельный кошелёк: деньги остаются на ваших счетах.
          </dd>
        </div>
        <div class="help-page__term">
          <dt>Свободно для назначения</dt>
          <dd>Деньги на счетах, которые ещё не отмечены ни для одной цели.</dd>
        </div>
        <div class="help-page__term">
          <dt>Можно потратить</dt>
          <dd>
            Сколько можно тратить в текущем периоде, не трогая назначенное на обязательные платежи и
            накопления. Число рассчитывает сервер.
          </dd>
        </div>
      </dl>

      <h2>Частые вопросы</h2>

      <div class="help-page__faq">
        <details>
          <summary>Что, если заплатил меньше плана или больше?</summary>
          <p>
            Садик: план 3 000 ₽, оплачено 2 000 ₽. Платёж записан на 2 000 ₽, а недостающую часть вы
            либо оплатите позже, либо пропустите — отдельного кошелька для разницы нет. Аренда: план
            40 000 ₽, оплата 35 000 ₽ — если нужно ещё 5 000 ₽, это доплата: внесите её отдельной
            операцией. Каждая оплата — самостоятельная операция.
          </p>
        </details>
        <details>
          <summary>Двигает ли перевод между счетами назначения?</summary>
          <p>
            Перевод между счетами не двигает назначения: меняется только то, на каком счёте лежат
            деньги. Чтобы изменить цель денег, перераспределите назначение явным действием.
          </p>
        </details>
        <details>
          <summary>Входит ли ожидаемый доход в «На счетах»?</summary>
          <p>
            Ожидаемый доход не входит в «На счетах» и не защищает обязательства, пока вы не записали
            его как фактическое поступление.
          </p>
        </details>
        <details>
          <summary>Какие обязательства учитываются?</summary>
          <p>
            Учитываются обязательства в пределах горизонта: ближайшие платежи, которые сервер
            считает защищаемыми сейчас. Более поздние платежи появятся по мере приближения.
          </p>
        </details>
        <details>
          <summary>Что будет, если изменить начало финансового месяца?</summary>
          <p>
            Изменение цикла действует с будущего периода: прошлые периоды и их цели сохраняются.
            Перед подтверждением HarmoFin показывает, когда изменение вступит в силу.
          </p>
        </details>
        <details>
          <summary>Почему не меняется часовой пояс?</summary>
          <p>
            После подтверждённых операций смена часового пояса может сдвинуть даты прошлых записей.
            Сервер ответит ошибкой TIMEZONE_CHANGE_REQUIRES_RECONCILIATION и не изменит историю. В
            пустом бюджете часовой пояс менять можно.
          </p>
        </details>
      </div>
    </section>
    <section v-else class="help-page__content">
      <p class="help-page__kicker">Справка</p>
      <h1>Как пользоваться HarmoFin</h1>
      <p class="help-page__description">
        Пять понятий, которых достаточно, чтобы понимать всё остальное в HarmoFin.
      </p>

      <dl class="help-page__terms">
        <div class="help-page__term">
          <dt>Счёт</dt>
          <dd>Где физически находятся деньги: карта, банковский счёт или наличные.</dd>
        </div>
        <div class="help-page__term">
          <dt>Конверт</dt>
          <dd>
            Для чего эти деньги предназначены — продукты, ипотека, ремонт. Один счёт может
            одновременно содержать деньги нескольких конвертов.
          </dd>
        </div>
        <div class="help-page__term">
          <dt>Категория</dt>
          <dd>На что деньги фактически потрачены — не путать с конвертом.</dd>
        </div>
        <div class="help-page__term">
          <dt>Финансовый месяц</dt>
          <dd>
            Ваш период планирования денег между двумя поступлениями. Не обязательно начинается 1-го
            числа — можно настроить в Настройках.
          </dd>
        </div>
        <div class="help-page__term">
          <dt>Можно потратить</dt>
          <dd>
            Сколько денег доступно в текущем периоде с учётом фактических доходов и того, что уже
            распределено по конвертам.
          </dd>
        </div>
      </dl>

      <h2>Частые вопросы</h2>

      <div class="help-page__faq">
        <details>
          <summary>Чем счёт отличается от конверта?</summary>
          <p>
            Счёт — это физическое место (карта, наличные). Конверт — назначение денег (продукты,
            ипотека). На одной карте может одновременно лежать несколько конвертов.
          </p>
        </details>
        <details>
          <summary>Что делать с ещё не распределёнными деньгами?</summary>
          <p>
            Откройте доход в журнале операций и распределите его по конвертам. Пока деньги не
            распределены, HarmoFin показывает их отдельно и не считает доступными для трат.
          </p>
        </details>
        <details>
          <summary>Почему «Можно потратить» меньше остатка на счёте?</summary>
          <p>
            Остаток счёта — все деньги на нём. «Можно потратить» — только та часть, что относится к
            текущему периоду и ещё не назначена на обязательные платежи или накопления.
          </p>
        </details>
        <details>
          <summary>Почему счёт или конверт ушёл в минус?</summary>
          <p>
            Расход превысил доступные деньги. HarmoFin предупреждает об этом до сохранения. В
            Настройках можно запретить сохранять такие расходы совсем.
          </p>
        </details>
        <details>
          <summary>Я ввёл не ту сумму дохода, которую планировал — это ошибка?</summary>
          <p>
            Нет. HarmoFin всегда использует фактически полученную сумму, а не плановую. Плановые
            значения — только ориентир.
          </p>
        </details>
      </div>
    </section>
  </div>
</template>

<style scoped>
.help-page {
  min-height: 100vh;
  color: var(--hf-color-text);
  background: var(--hf-color-page-background);
}

.help-page__content {
  max-width: 44rem;
  margin: var(--hf-space-8) auto 0;
  padding: var(--hf-space-8);
}

.help-page__kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: uppercase;
}

.help-page h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3rem);
  letter-spacing: -0.04em;
}

.help-page h2 {
  margin: var(--hf-space-10) 0 0;
}

.help-page__description {
  margin: var(--hf-space-3) 0 0;
  color: var(--hf-color-text-muted);
}

.help-page__terms {
  display: grid;
  gap: var(--hf-space-4);
  margin: var(--hf-space-6) 0 0;
}

.help-page__term {
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
}

.help-page__term dt {
  font-weight: var(--hf-font-weight-semibold);
}

.help-page__term dd {
  margin: var(--hf-space-1) 0 0;
  color: var(--hf-color-text-muted);
}

.help-page__faq {
  display: grid;
  gap: var(--hf-space-3);
  margin: var(--hf-space-5) 0 0;
}

.help-page__faq details {
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
}

.help-page__faq summary {
  cursor: pointer;
  font-weight: var(--hf-font-weight-semibold);
}

.help-page__faq p {
  margin: var(--hf-space-3) 0 0;
  color: var(--hf-color-text-muted);
}
</style>
