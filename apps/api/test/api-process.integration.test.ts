import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';

import { assertDisposableDatabase } from './helpers/disposable-db.js';

const processes: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stopProcess));
});

describe('API process', () => {
  it('starts through the real TypeScript entrypoint', async () => {
    const { port } = await startApi();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      version: '0.0.0-dev',
      revision: 'dev',
    });
  }, 20_000);

  it('builds the OpenAPI document under tsx', async () => {
    const { port } = await startApi();
    const response = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths['/api/v2/budgets/{budgetId}/transactions']).toBeDefined();
  }, 20_000);

  it('serves authenticated v2 list routes without 500 (no emitted decorator metadata)', async () => {
    const databaseUrl = assertDisposableDatabase(process.env.DATABASE_URL);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const { port } = await startApi();
    const base = `http://127.0.0.1:${port}/api`;
    const origin = 'http://localhost:3000';
    const email = `tsx-di-${randomUUID()}@harmofin.test`;
    let userId: string | undefined;
    try {
      const register = await fetch(`${base}/v1/auth/register`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'correct-password-10',
          workspaceName: 'DI',
          budgetName: 'DI',
        }),
      });
      expect(register.status).toBe(201);
      const body = (await register.json()) as { user: { id: string }; budget: { id: string } };
      userId = body.user.id;
      const cookie = (register.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
      expect(cookie).toContain('harmofin_session=');
      const b = `${base}/v2/budgets/${body.budget.id}`;
      const paths = [
        'transactions',
        'transfers',
        'obligations/plans',
        'obligations/occurrences',
        'income-plans',
        'income-plans/occurrences',
        'envelopes',
        'dashboard',
        'notifications',
        'exports/transactions.csv',
        'exports/assignments.csv',
        ...[
          'account-balances',
          'expenses-by-category',
          'expenses-by-period',
          'expenses-by-cycle',
          'incomes-by-cycle',
          'net-cash-flow',
          'savings-goals',
          'plan-vs-actual',
          'assignment-movements',
        ].map((key) => `reports/${key}`),
      ];
      const statuses: Record<string, number> = {};
      for (const path of paths) {
        const response = await fetch(`${b}/${path}`, { headers: { cookie, origin } });
        statuses[path] = response.status;
        await response.arrayBuffer();
      }
      const failing = Object.entries(statuses).filter(([, status]) => status >= 500);
      expect(failing).toEqual([]);
      expect(statuses['transactions']).toBe(200);
    } finally {
      if (userId) {
        const memberships = await prisma.workspaceMembership.findMany({
          where: { userId },
          select: { workspaceId: true },
        });
        await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
        await prisma.session.deleteMany({ where: { userId } });
        await prisma.workspaceMembership.deleteMany({ where: { userId } });
        for (const { workspaceId } of memberships) {
          await prisma.budget.deleteMany({ where: { workspaceId } });
          await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        }
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await prisma.$disconnect();
    }
  }, 60_000);
});

async function startApi(): Promise<{ port: number }> {
  {
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

    await waitForResponse(child, `http://127.0.0.1:${port}/api/v1/health/live`);
    return { port };
  }
}

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

  for (let attempt = 0; attempt < 150; attempt += 1) {
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
