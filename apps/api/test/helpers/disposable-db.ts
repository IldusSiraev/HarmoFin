const DISPOSABLE_DATABASE = 'harmofin_v22_test';

export function assertDisposableDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is required and must point to the disposable database.');
  const parsed = new URL(url);
  for (const param of ['host', 'hostaddr', 'service', 'options']) {
    if (parsed.searchParams.has(param)) {
      throw new Error(`Refusing DATABASE_URL with the "${param}" parameter.`);
    }
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name !== DISPOSABLE_DATABASE || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`Refusing to run cutover tests outside local ${DISPOSABLE_DATABASE}.`);
  }
  return url;
}

export function withApplicationName(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}
