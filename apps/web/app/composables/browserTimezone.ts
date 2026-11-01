export function browserTimezone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return null;
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes(zone) ? zone : null;
}
