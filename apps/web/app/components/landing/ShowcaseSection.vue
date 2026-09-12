<script setup lang="ts">
defineOptions({ name: 'LandingShowcaseSection' });
</script>

<template>
  <section class="showcase">
    <div class="showcase__content">
      <div class="showcase__image">
        <div class="showcase__placeholder">
          <p>Dashboard Preview</p>
        </div>
        <div class="showcase__annotation showcase__annotation--top">
          <span>Финансовые циклы</span>
        </div>
        <div class="showcase__annotation showcase__annotation--right">
          <span>Распределение по конвертам</span>
        </div>
        <div class="showcase__annotation showcase__annotation--bottom">
          <span>Полная сводка бюджета</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.showcase {
  padding: var(--hf-space-16) var(--hf-space-8);
  background: #0a0f16;
}

.showcase__content {
  max-width: 70rem;
  margin: 0 auto;
}

.showcase__image {
  position: relative;
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-slate-50);
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 20%),
    0 10px 10px -5px rgb(0 0 0 / 10%);
}

.showcase__placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  color: var(--hf-color-text-muted);
  font-size: 1.5rem;
  font-weight: 600;
}

.showcase__annotation {
  position: absolute;
  padding: var(--hf-space-2) var(--hf-space-3);
  color: white;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-action-primary);
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
}

.showcase__annotation::after {
  position: absolute;
  width: 0;
  height: 0;
  border: 6px solid transparent;
  content: '';
}

.showcase__annotation--top {
  top: 10%;
  left: 20%;
}

.showcase__annotation--top::after {
  top: 100%;
  left: 50%;
  border-top-color: var(--hf-color-action-primary);
  transform: translateX(-50%);
}

.showcase__annotation--right {
  top: 50%;
  right: 5%;
  transform: translateY(-50%);
}

.showcase__annotation--right::after {
  top: 50%;
  right: 100%;
  border-right-color: var(--hf-color-action-primary);
  transform: translateY(-50%);
}

.showcase__annotation--bottom {
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
}

.showcase__annotation--bottom::after {
  bottom: 100%;
  left: 50%;
  border-bottom-color: var(--hf-color-action-primary);
  transform: translateX(-50%);
}

@media (max-width: 767px) {
  .showcase__annotation {
    font-size: 0.75rem;
    padding: var(--hf-space-1) var(--hf-space-2);
  }

  .showcase__annotation::after {
    border-width: 4px;
  }
}
</style>
