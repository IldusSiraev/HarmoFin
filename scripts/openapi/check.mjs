import { readFileSync } from 'node:fs';

import { findBreakingChanges } from './breaking-changes.mjs';
import { lintDocument } from './lint.mjs';

const [headPath, basePath] = process.argv.slice(2);

if (!headPath) {
  console.error('Usage: node scripts/openapi/check.mjs <head.json> [base.json]');
  process.exit(2);
}

const head = JSON.parse(readFileSync(headPath, 'utf8'));
const lintIssues = lintDocument(head);

for (const issue of lintIssues) {
  console.error(`lint: ${issue}`);
}

let breakingChanges = [];
if (basePath) {
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  breakingChanges = findBreakingChanges(base, head);
  for (const change of breakingChanges) {
    console.error(`breaking change: ${change}`);
  }
}

if (lintIssues.length === 0 && breakingChanges.length === 0) {
  console.log('OpenAPI contract check passed.');
  process.exit(0);
}

process.exit(1);
