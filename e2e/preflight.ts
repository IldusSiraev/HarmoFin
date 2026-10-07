// Pre-flight port guard (Windows-centric, POSIX-compatible): local dev servers
// started by earlier `pnpm test:e2e` runs survive as orphaned `node --watch`
// trees. An orphan that no longer answers the health endpoint keeps its port
// (EADDRINUSE for the fresh server, ECONNRESET for tests). Healthy servers are
// left alone, so the normal reuse-existing-server workflow is unchanged.
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import process from 'node:process';

import { apiOrigin, webOrigin } from './env';

const TARGETS = [
  { name: 'api', url: `${apiOrigin}/api/v1/health/live` },
  { name: 'web', url: `${webOrigin}/register` },
];

function portOf(url: string): number {
  const parsed = new URL(url);
  return Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
}

// A connectable (or stuck) port means someone owns it; only ECONNREFUSED means free.
function portOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (occupied: boolean) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(3_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(true));
    socket.once('error', (error) =>
      finish((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED'),
    );
  });
}

async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function listenersOnPort(port: number): number[] {
  if (os.platform() === 'win32') {
    // netstat -ano: proto  local:port  foreign  state  pid — pid is the last field.
    const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pattern = new RegExp(`:(${port})\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, 'gm');
    return [...new Set([...output.matchAll(pattern)].map((match) => Number(match[2])))];
  }
  try {
    const output = execFileSync('lsof', ['-', 'ti', `tcp:${port}`], { encoding: 'utf8' });
    return [...new Set(output.trim().split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    return []; // lsof exits 1 when there are no matches: no listener found.
  }
}

function killListeners(pids: number[]): void {
  for (const pid of pids) {
    if (os.platform() === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  }
}

async function waitUntilFree(port: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await portOccupied(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export default async function preflight(): Promise<void> {
  for (const target of TARGETS) {
    const port = portOf(target.url);
    if (!(await portOccupied(port))) {
      console.log(`[preflight] ${target.name}: port ${port} is free`);
      continue;
    }
    if (await healthy(target.url)) {
      console.log(`[preflight] ${target.name}: healthy server on port ${port}, reusing it`);
      continue;
    }
    const pids = listenersOnPort(port);
    if (pids.length === 0) {
      console.log(`[preflight] ${target.name}: port ${port} unresponsive, no listener to stop`);
      continue;
    }
    const killed = pids.join(', ');
    console.log(
      `[preflight] ${target.name}: killing stale listener(s) PID ${killed} on port ${port}`,
    );
    killListeners(pids);
    await waitUntilFree(port);
  }
}
