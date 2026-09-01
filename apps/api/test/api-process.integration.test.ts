import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const processes: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stopProcess));
});

describe('API process', () => {
  it('starts through the real TypeScript entrypoint', async () => {
    const port = await reservePort();
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: String(port),
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
        WEB_ORIGIN: 'http://localhost:3000',
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: 'http://localhost:3000',
        LOG_LEVEL: 'silent',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.push(child);

    const response = await waitForResponse(child, `http://127.0.0.1:${port}/api/v1/health/live`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve an API port');
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForResponse(child: ChildProcess, url: string): Promise<Response> {
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited with ${child.exitCode}: ${output.join('')}`);
    }

    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`API process did not become ready: ${output.join('')}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
