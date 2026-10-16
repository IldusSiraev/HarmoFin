<script setup lang="ts">
import { definePageMeta } from '#imports';

defineOptions({ name: 'AppHelpPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });
</script>

<template>
  <div class="help-page">
    <section class="help-page__content" data-testid="help-v2">
      <p class="help-page__kicker">Справка</p>
      <h1>Как пользоваться HarmoFin</h1>
      <p class="help-page__description">
        Четыре числа показывают, где ваши деньги и сколько из них уже отложено на цели.
      </p>

      <dl class="help-page__terms">
        <div class="help-page__term">
          <dt>На счетах</dt>
          <dd>Сколько денег реально лежит на ваших счетах и в наличных.</dd>
        </div>
        <div class="help-page__term">
          <dt>Отложено</dt>
          <dd>
            Часть денег, которую вы распределили по конвертам: на обязательные платежи, накопления и
            другие цели. Конверт — это пометка, а не отдельный кошелёк: деньги остаются на ваших
            счетах.
          </dd>
        </div>
        <div class="help-page__term">
          <dt>Не распределено</dt>
          <dd>Деньги на счетах, которые ещё не отмечены ни для одной цели.</dd>
        </div>
        <div class="help-page__term">
          <dt>Можно потратить</dt>
          <dd>
            Сколько можно тратить в текущем периоде, не трогая отложенное на обязательные платежи и
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
          <summary>Меняет ли перевод между счетами распределение по конвертам?</summary>
          <p>
            Перевод между счетами не меняет распределение по конвертам: меняется только то, на каком
            счёте лежат деньги. Чтобы изменить цель денег, переложите их между конвертами.
          </p>
        </details>
        <details>
          <summary>Входит ли ожидаемый доход в «На счетах»?</summary>
          <p>
            Ожидаемый доход не входит в «На счетах» и не покрывает обязательные платежи, пока вы не
            записали его как фактическое поступление.
          </p>
        </details>
        <details>
          <summary>Какие обязательные платежи учитываются?</summary>
          <p>
            Учитываются ближайшие обязательные платежи. Более поздние появятся по мере приближения.
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
