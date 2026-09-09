import { describe, expect, it, vi } from 'vitest';

import { WorkerHealthServer } from './health-server.js';

async function startHealthServer(
  overrides: {
    ready?: boolean;
    databaseError?: Error;
  } = {},
): Promise<{ server: WorkerHealthServer; databaseCheck: ReturnType<typeof vi.fn> }> {
  const databaseCheck = vi.fn().mockImplementation(async () => {
    if (overrides.databaseError) throw overrides.databaseError;
  });
  const server = new WorkerHealthServer({
    runtime: { isReady: overrides.ready ?? true },
    databaseHealth: { check: databaseCheck },
    host: '127.0.0.1',
    port: 0,
  });

  await server.start();
  return { server, databaseCheck };
}

describe('WorkerHealthServer', () => {
  it('reports liveness without checking dependencies', async () => {
    const { server, databaseCheck } = await startHealthServer({ ready: false });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/live`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect(databaseCheck).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it('reports ready only after runtime started and database probe succeeds', async () => {
    const { server, databaseCheck } = await startHealthServer();

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/ready`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect(databaseCheck).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
    }
  });

  it('returns a safe unavailable response before runtime starts', async () => {
    const { server, databaseCheck } = await startHealthServer({ ready: false });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/ready`);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
      expect(databaseCheck).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it('does not disclose database errors in readiness responses', async () => {
    const { server } = await startHealthServer({
      databaseError: new Error('database probe failed'),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/ready`);

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe('{"status":"unavailable"}');
    } finally {
      await server.stop();
    }
  });
});
