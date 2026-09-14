export interface ProblemDetails {
  code: string;
  detail: string;
  fieldErrors?: Array<{ field: string; message: string; code: string }>;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail);
  }
}

export interface RequestClient {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  requestBlob(path: string, options?: RequestInit): Promise<Blob>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CsrfStore {
  get(): string | null;
  set(token: string | null): void;
}

export function createCsrfStore(): CsrfStore {
  let token: string | null = null;
  return {
    get: () => token,
    set: (value) => {
      token = value;
    },
  };
}

// One token per browser tab, shared by every client instance: the API rotates
// the CSRF token on each /auth/csrf read, so a second cache would invalidate
// the token the first one still holds. On the server each call gets its own
// store — a shared one would leak between users.
const browserCsrfStore = createCsrfStore();

export function createApiClient(
  fetcher: Fetcher,
  apiUrl: string,
  origin: string,
  csrfStore: CsrfStore = createCsrfStore(),
) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = options.method?.toUpperCase() ?? 'GET';
    const needsCsrf = requiresCsrf(method, path);
    let response = await send(path, options, method, needsCsrf);

    // A stale token is rejected before anything is written, so repeating the
    // request once with a fresh one cannot duplicate a financial movement —
    // and it keeps the caller's idempotency key.
    if (needsCsrf && response.status === 403) {
      const problem = await readProblem(response);
      if (problem?.code !== 'CSRF_INVALID') {
        throw new ApiRequestError(
          403,
          problem ?? { code: 'REQUEST_FAILED', detail: 'Не удалось выполнить запрос.' },
        );
      }
      csrfStore.set(null);
      response = await send(path, options, method, needsCsrf);
    }

    if (
      response.status === 204 ||
      response.headers.get('content-length') === '0' ||
      !response.headers.get('content-type')?.includes('json')
    ) {
      if (!response.ok) {
        throw new ApiRequestError(response.status, {
          code: 'REQUEST_FAILED',
          detail: 'Не удалось выполнить запрос. Повторите попытку.',
        });
      }
      return undefined as T;
    }
    const body = (await response.json()) as T | ProblemDetails;
    if (!response.ok) throw new ApiRequestError(response.status, body as ProblemDetails);
    return body as T;
  }

  async function send(
    path: string,
    options: RequestInit,
    method: string,
    needsCsrf: boolean,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set('Origin', origin);
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (needsCsrf) {
      const token = csrfStore.get() ?? (await getCsrfToken());
      csrfStore.set(token);
      headers.set('X-CSRF-Token', token);
    }

    return fetcher(`${apiUrl}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
  }

  async function readProblem(response: Response): Promise<ProblemDetails | null> {
    if (!response.headers.get('content-type')?.includes('json')) return null;
    try {
      return (await response.json()) as ProblemDetails;
    } catch {
      return null;
    }
  }

  async function requestBlob(path: string, options: RequestInit = {}): Promise<Blob> {
    const method = options.method?.toUpperCase() ?? 'GET';
    const response = await send(path, options, method, requiresCsrf(method, path));
    if (!response.ok) {
      const problem = response.headers.get('content-type')?.includes('json')
        ? ((await response.json()) as ProblemDetails)
        : {
            code: 'REQUEST_FAILED',
            detail: 'Не удалось выполнить запрос. Повторите попытку.',
          };
      throw new ApiRequestError(response.status, problem);
    }
    return response.blob();
  }

  async function getCsrfToken(): Promise<string> {
    const response = await fetcher(`${apiUrl}/api/v1/auth/csrf`, {
      credentials: 'include',
      headers: { Origin: origin },
    });
    if (!response.ok)
      throw new ApiRequestError(response.status, (await response.json()) as ProblemDetails);
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }

  return { request, requestBlob };
}

export function useApiClient() {
  const config = useRuntimeConfig();
  const origin = import.meta.client ? window.location.origin : config.public.apiUrl;
  return createApiClient(
    globalThis.fetch.bind(globalThis),
    config.public.apiUrl,
    origin,
    import.meta.client ? browserCsrfStore : createCsrfStore(),
  );
}

function isUnsafe(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function requiresCsrf(method: string, path: string): boolean {
  return (
    isUnsafe(method) &&
    path !== '/api/v1/auth/login' &&
    path !== '/api/v1/auth/register' &&
    !path.startsWith('/api/v1/auth/recovery/')
  );
}
