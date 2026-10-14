import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const envPath = `${repoRoot}/.env`;
const DEFAULT_DATABASE_URL = 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';

function extractDatabaseUrl(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('DATABASE_URL=')) continue;
    let value = trimmed.slice('DATABASE_URL='.length).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function redactUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const tail = parsed.host + parsed.pathname;
    return parsed.username ? `${parsed.username}:***@${tail}` : tail;
  } catch {
    return '<неразрешённый URL>';
  }
}

function runPnpm(args) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (error) => {
      console.error(`Не удалось запустить pnpm: ${error.message}`);
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
}

function assertDisposableTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`DATABASE_URL не является корректным URL: ${redactUrl(rawUrl)}`);
    process.exit(1);
  }
  if (parsed.searchParams.size > 0) {
    console.error(
      'Query-параметры в DATABASE_URL запрещены для интеграционных тестов (см. apps/api/test/helpers/disposable-db.ts).',
    );
    process.exit(1);
  }
  let name;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    console.error(`DATABASE_URL не является корректным URL: ${redactUrl(rawUrl)}`);
    process.exit(1);
  }
  if (name !== 'harmofin_v22_test' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    console.error(
      `Интеграционные тесты только на локальной disposable-БД harmofin_v22_test. Получено: ${redactUrl(rawUrl)}`,
    );
    process.exit(1);
  }
}

const explicit = process.env.DATABASE_URL;
let target;
if (explicit) {
  target = explicit;
  console.log(
    `DATABASE_URL задан явно — запускаю интеграционные тесты без изменений: ${redactUrl(explicit)}`,
  );
} else {
  const fromEnv = existsSync(envPath) ? extractDatabaseUrl(readFileSync(envPath, 'utf8')) : null;
  const raw = fromEnv ?? DEFAULT_DATABASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    console.error(`Не удалось разобрать DATABASE_URL из .env: ${redactUrl(raw)}`);
    process.exit(1);
  }
  parsed.pathname = 'harmofin_v22_test';
  target = parsed.toString();
  console.log(
    `Локальный запуск без явного DATABASE_URL — интеграционные тесты на disposable-БД: ${redactUrl(target)}`,
  );
}

assertDisposableTarget(target);

process.env.DATABASE_URL = target;

const migrateCode = await runPnpm(['db:migrate']);
if (migrateCode !== 0) process.exit(migrateCode ?? 1);

const testCode = await runPnpm(['--filter', '@harmofin/api', 'test:integration']);
if (testCode !== 0) process.exit(testCode ?? 1);

process.exit(0);
