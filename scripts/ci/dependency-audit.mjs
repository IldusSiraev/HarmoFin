export function filterUnreviewedAdvisories(advisories, exceptions) {
  return advisories.filter((advisory) => !matchesException(advisory, exceptions));
}

function matchesException(advisory, exceptions) {
  return exceptions.some(
    (exception) =>
      exception.ghsa === advisory.github_advisory_id && exception.module === advisory.module_name,
  );
}
