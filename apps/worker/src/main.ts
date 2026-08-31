import { createWorkerLogger } from './logger.js';
import { WorkerRuntime } from './runtime.js';
import { loadWorkerConfig } from './config.js';

const config = loadWorkerConfig(process.env);
const runtime = new WorkerRuntime(createWorkerLogger(config));

runtime.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void runtime.stop(signal).then(() => {
      process.exitCode = 0;
    });
  });
}
