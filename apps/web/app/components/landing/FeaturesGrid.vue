<script setup lang="ts">
import FeatureCard from './FeatureCard.vue';

defineOptions({ name: 'LandingFeaturesGrid' });
</script>

<template>
  <section class="features">
    <div class="features__grid">
      <FeatureCard
        icon="envelope"
        title="Конверты и счета"
        description="Разделяйте, где лежат деньги и на что они предназначены. Полная прозрачность распределения бюджета."
      />
      <FeatureCard
        icon="cycle"
        title="Финансовые циклы"
        description="Планируйте между выплатами зарплаты, а не по календарному месяцу. Гибкие периоды под вашу ситуацию."
      />
      <FeatureCard
        icon="control"
        title="Полный контроль"
        description="Отслеживайте доходы, расходы, переводы. Аналитика, уведомления, экспорт — всё для осознанного управления финансами."
      />
    </div>
  </section>
</template>

<style scoped>
.features {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-12) var(--hf-space-8);
}

.features__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-8);
}

@media (min-width: 768px) {
  .features__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
