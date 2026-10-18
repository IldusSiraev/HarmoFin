// Registers public/sw.js (installability + offline fallback page only).
// Development builds skip it: a worker left over from a previous session would
// otherwise sit between the browser and the dev server.
export async function registerServiceWorker(options: {
  dev: boolean;
  container: ServiceWorkerContainer | undefined;
}): Promise<void> {
  if (options.dev || !options.container) return;

  try {
    await options.container.register('/sw.js', { scope: '/' });
  } catch {
    // Installability is a progressive enhancement; the app works without it.
  }
}
