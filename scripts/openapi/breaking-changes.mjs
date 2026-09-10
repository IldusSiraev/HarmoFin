const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function findBreakingChanges(base, head) {
  const changes = [];
  const basePaths = base.paths ?? {};
  const headPaths = head.paths ?? {};

  for (const [pathKey, basePathItem] of Object.entries(basePaths)) {
    const headPathItem = headPaths[pathKey];
    if (!headPathItem) {
      changes.push(`removed path "${pathKey}"`);
      continue;
    }

    for (const method of HTTP_METHODS) {
      const baseOperation = basePathItem[method];
      if (!baseOperation) continue;

      const location = `${method} ${pathKey}`;
      const headOperation = headPathItem[method];
      if (!headOperation) {
        changes.push(`removed operation "${location}"`);
        continue;
      }

      changes.push(...responseChanges(baseOperation, headOperation, location));
      changes.push(...requestBodyChanges(baseOperation, headOperation, location));
    }
  }

  return changes;
}

function responseChanges(baseOperation, headOperation, location) {
  const changes = [];
  const baseResponses = baseOperation.responses ?? {};
  const headResponses = headOperation.responses ?? {};

  for (const status of Object.keys(baseResponses)) {
    if (!(status in headResponses)) {
      changes.push(`removed response status "${status}" for "${location}"`);
    }
  }

  return changes;
}

function requestBodyChanges(baseOperation, headOperation, location) {
  const changes = [];
  const baseRequired = new Set(requiredFields(baseOperation));
  const headRequired = requiredFields(headOperation);

  for (const field of headRequired) {
    if (!baseRequired.has(field)) {
      changes.push(`new required request field "${field}" for "${location}"`);
    }
  }

  return changes;
}

function requiredFields(operation) {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  return Array.isArray(schema?.required) ? schema.required : [];
}
