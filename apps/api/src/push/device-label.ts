// A short human name for a device ("Chrome, Android"). Only this label is stored, never the full
// User-Agent. Order matters: Edge, Opera and Yandex also say "Chrome"; Android also says "Linux";
// iPhone also says "Mac OS X".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/Edg(?:A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\/|(?:iPhone|iPad).*AppleWebKit\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const MAX_LABEL_LENGTH = 80;

function firstMatch(userAgent: string, table: ReadonlyArray<readonly [RegExp, string]>) {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function deviceLabel(userAgent: string | undefined): string {
  const value = userAgent ?? '';
  const browser = firstMatch(value, BROWSERS) ?? 'Браузер';
  const system = firstMatch(value, SYSTEMS);
  return (system ? `${browser}, ${system}` : browser).slice(0, MAX_LABEL_LENGTH);
}
