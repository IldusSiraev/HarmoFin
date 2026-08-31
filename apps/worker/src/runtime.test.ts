import { describe, expect, it, vi } from 'vitest';

import { WorkerRuntime, type WorkerLogger } from './runtime.js';

function createFakeLogger(): WorkerLogger & { events: Array<Record<string, string>> } {
  const events: Array<Record<string, string>> = [];
  return {
    events,
    started() {
      events.push({ event: 'worker_started', service: 'worker' });
    },
    stopped(signal) {
      events.push({ event: 'worker_stopped', service: 'worker', signal });
    },
  };
}

describe('WorkerRuntime', () => {
  it('starts and stops without jobs', async () => {
    const logger = createFakeLogger();
    const runtime = new WorkerRuntime(logger);

    runtime.start();
    expect(runtime.state).toBe('running');
    await runtime.stop('SIGTERM');

    expect(runtime.state).toBe('stopped');
    expect(logger.events).toEqual([
      { event: 'worker_started', service: 'worker' },
      { event: 'worker_stopped', service: 'worker', signal: 'SIGTERM' },
    ]);
  });

  it('does not emit duplicate shutdown', async () => {
    const logger = createFakeLogger();
    const runtime = new WorkerRuntime(logger);

    runtime.start();
    await runtime.stop('SIGINT');
    await runtime.stop('SIGTERM');

    expect(logger.events.filter(({ event }) => event === 'worker_stopped')).toHaveLength(1);
  });

  it('keeps the process active until shutdown', async () => {
    const close = vi.fn();
    const createKeepAlive = vi.fn(() => ({ close }));
    const runtime = new WorkerRuntime(createFakeLogger(), createKeepAlive);

    runtime.start();

    expect(createKeepAlive).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    await runtime.stop('SIGTERM');

    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects starting after it stopped', async () => {
    const runtime = new WorkerRuntime(createFakeLogger());

    runtime.start();
    await runtime.stop('SIGTERM');

    expect(() => runtime.start()).toThrow('Worker has already stopped');
  });
});
