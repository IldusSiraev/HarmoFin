export function lintDocument(document) {
  const issues = [];
  const seenOperationIds = new Set();

  for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathKey.startsWith('/api/v1/')) {
      issues.push(`Path "${pathKey}" is outside the /api/v1 contract prefix.`);
    }

    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operation || typeof operation !== 'object') continue;

      const location = `${method.toUpperCase()} ${pathKey}`;

      if (!operation.operationId) {
        issues.push(`Operation ${location} is missing operationId.`);
      } else if (seenOperationIds.has(operation.operationId)) {
        issues.push(`Operation ${location} has duplicate operationId "${operation.operationId}".`);
      } else {
        seenOperationIds.add(operation.operationId);
      }
    }
  }

  return issues;
}
