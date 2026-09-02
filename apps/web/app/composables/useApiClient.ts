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

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createApiClient(fetcher: Fetcher, apiUrl: string, origin: string) {
  let csrfToken: string | null = null;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = options.method?.toUpperCase() ?? 'GET';
    const headers = new Headers(options.headers);
    headers.set('Origin', origin);
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (
      isUnsafe(method) &&
      path !== '/api/v1/auth/login' &&
      path !== '/api/v1/auth/register' &&
      !path.startsWith('/api/v1/auth/recovery/')
    ) {
      csrfToken ??= await getCsrfToken();
      headers.set('X-CSRF-Token', csrfToken);
    }

    const response = await fetcher(`${apiUrl}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
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

  async function getCsrfToken(): Promise<string> {
    const response = await fetcher(`${apiUrl}/api/v1/auth/csrf`, {
      credentials: 'include',
      headers: { Origin: origin },
    });
    if (!response.ok)
      throw new ApiRequestError(response.status, (await response.json()) as ProblemDetails);
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }

  return { request };
}

export function useApiClient() {
  const config = useRuntimeConfig();
  const origin = import.meta.client ? window.location.origin : config.public.apiUrl;
  return createApiClient(globalThis.fetch.bind(globalThis), config.public.apiUrl, origin);
}

function isUnsafe(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}
