import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterUnreviewedAdvisories } from './dependency-audit.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const exceptionsPath = resolve(scriptDir, 'security-exceptions.json');

const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8'));

let auditOutput;
try {
  auditOutput = execFileSync('pnpm', ['audit', '--audit-level', 'high', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
} catch (error) {
  auditOutput = error.stdout ?? '';
}

const report = JSON.parse(auditOutput || '{}');
const advisories = Object.values(report.advisories ?? {});
const unreviewed = filterUnreviewedAdvisories(advisories, exceptions);

if (unreviewed.length === 0) {
  console.log(
    `Dependency audit passed: ${advisories.length} high/critical advisories, all reviewed or none found.`,
  );
  process.exit(0);
}

console.error(`Dependency audit failed: ${unreviewed.length} unreviewed high/critical advisories.`);
for (const advisory of unreviewed) {
  console.error(`- ${advisory.module_name} (${advisory.github_advisory_id}): ${advisory.title}`);
}
process.exit(1);
