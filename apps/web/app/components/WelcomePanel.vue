<template>
  <main class="welcome-panel" aria-labelledby="welcome-title">
    <h1 id="welcome-title">HarmoFin</h1>
    <h2>Основание проекта готово</h2>
    <p>Продуктовые функции ещё не реализованы.</p>
  </main>
</template>

<style scoped>
.welcome-panel {
  box-sizing: border-box;
  display: grid;
  min-height: 100vh;
  align-content: center;
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem;
  color: #172033;
  background: #f7f8fb;
  font-family: system-ui, sans-serif;
}

h1 {
  margin: 0;
  font-size: clamp(2.5rem, 8vw, 5rem);
  letter-spacing: -0.05em;
}

h2 {
  margin: 1rem 0 0;
  font-size: clamp(1.5rem, 4vw, 2.25rem);
}

p {
  margin: 1rem 0 0;
  color: #44516b;
  font-size: 1.125rem;
  line-height: 1.6;
}
</style>
