<script setup lang="ts">
defineOptions({ name: 'LandingHeroSection' });
</script>

<template>
  <section class="hero">
    <div class="hero__content">
      <h1 class="hero__wordmark">HarmoFin</h1>
      <p class="hero__tagline">
        Управляйте семейным бюджетом с полным контролем. Конверты, циклы, планы — всё в одном месте.
      </p>
      <div class="hero__actions">
        <NuxtLink to="/register" class="hero__cta hero__cta--primary">Начать бесплатно</NuxtLink>
        <NuxtLink to="/login" class="hero__cta hero__cta--secondary">Войти</NuxtLink>
      </div>
    </div>
    <div class="hero__illustration">
      <div class="envelope envelope--1">
        <div class="envelope__flap"></div>
        <div class="envelope__money"></div>
      </div>
      <div class="envelope envelope--2">
        <div class="envelope__flap"></div>
        <div class="envelope__money"></div>
      </div>
      <div class="envelope envelope--3">
        <div class="envelope__flap envelope__flap--open"></div>
        <div class="envelope__money envelope__money--visible"></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-8);
  align-items: center;
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-12) var(--hf-space-8);
  background: linear-gradient(180deg, #f8fafc 0%, #f2f4f7 100%);
}

@media (min-width: 768px) {
  .hero {
    grid-template-columns: 1fr 1fr;
    padding: var(--hf-space-16) var(--hf-space-8);
  }
}

.hero__content {
  display: grid;
  gap: var(--hf-space-6);
}

.hero__wordmark {
  margin: 0;
  color: var(--hf-color-text);
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.hero__tagline {
  max-width: 32rem;
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: 1.25rem;
  line-height: 1.6;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-2);
}

.hero__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--hf-space-3) var(--hf-space-6);
  border-radius: var(--hf-control-radius);
  font-weight: 600;
  text-decoration: none;
  transition: all var(--hf-transition-fast);
}

.hero__cta--primary {
  color: white;
  border: 2px solid var(--hf-color-action-primary);
  background: var(--hf-color-action-primary);
}

.hero__cta--primary:hover {
  background: var(--hf-color-action-primary-hover);
  border-color: var(--hf-color-action-primary-hover);
}

.hero__cta--primary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.hero__cta--secondary {
  color: var(--hf-color-action-primary);
  border: 2px solid var(--hf-color-action-primary);
  background: transparent;
}

.hero__cta--secondary:hover {
  background: var(--hf-color-action-primary);
  color: white;
}

.hero__cta--secondary:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.hero__illustration {
  position: relative;
  display: grid;
  place-items: center;
  height: 20rem;
}

.envelope {
  position: absolute;
  width: 10rem;
  height: 6rem;
  border: 2px solid currentcolor;
  border-radius: 4px;
  transition: transform var(--hf-transition-base);
}

.envelope--1 {
  top: 2rem;
  left: 1rem;
  color: #2c5b8a;
  transform: rotate(-8deg);
}

.envelope--2 {
  top: 5rem;
  right: 1rem;
  color: #22a06b;
  transform: rotate(5deg);
}

.envelope--3 {
  top: 8rem;
  left: 50%;
  color: var(--hf-color-action-primary);
  transform: translateX(-50%) rotate(-2deg);
  animation: envelope-open 3s ease-in-out infinite;
}

@keyframes envelope-open {
  0%,
  100% {
    transform: translateX(-50%) rotate(-2deg);
  }
  50% {
    transform: translateX(-50%) rotate(-2deg) translateY(-4px);
  }
}

.envelope__flap {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
  border-bottom: 2px solid currentcolor;
  background: currentcolor;
  opacity: 0.1;
  transform-origin: bottom center;
  transition: transform var(--hf-transition-base);
}

.envelope__flap--open {
  transform: rotateX(180deg);
}

.envelope__money {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 60%;
  height: 40%;
  border: 1px solid currentcolor;
  background: currentcolor;
  opacity: 0;
  transform: translate(-50%, -50%);
  transition:
    opacity var(--hf-transition-base),
    transform var(--hf-transition-base);
}

.envelope__money--visible {
  opacity: 0.3;
  transform: translate(-50%, -80%);
}

@media (max-width: 767px) {
  .hero__illustration {
    order: -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .envelope--3 {
    animation: none;
  }
}
</style>
