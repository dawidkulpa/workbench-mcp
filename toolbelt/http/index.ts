/**
 * HTTP Helper for Sandbox
 *
 * Use this module to make HTTP requests through the proxy sidecar.
 * The sandbox has no direct internet access. All external HTTP requests
 * must go through the proxy sidecar at http://proxy:3128.
 *
 * The proxy enforces an allowlist configured by the host. Only URLs
 * matching the allowlist patterns will be allowed through.
 *
 * @example Basic GET request
 * ```typescript
 * import { proxyGet } from './toolbelt/http/index.js';
 *
 * const html = await proxyGet('https://api.example.com/data');
 * console.log(html);
 * ```
 *
 * @example POST with JSON body
 * ```typescript
 * import { proxyPost } from './toolbelt/http/index.js';
 *
 * const response = await proxyPost('https://api.example.com/items', {
 *   name: 'New Item',
 *   value: 42,
 * });
 * console.log(response);
 * ```
 *
 * @example Full control with proxyFetch
 * ```typescript
 * import { proxyFetch } from './toolbelt/http/index.js';
 *
 * const response = await proxyFetch('https://api.example.com/resource', {
 *   method: 'PUT',
 *   headers: { 'Authorization': 'Bearer token123' },
 *   body: JSON.stringify({ updated: true }),
 * });
 *
 * if (!response.ok) {
 *   throw new Error(`Request failed: ${response.status}`);
 * }
 *
 * const data = await response.json();
 * ```
 */

/** Proxy sidecar URL */
const PROXY_URL = 'http://proxy:3128';

/**
 * Error thrown when a proxy request fails.
 */
export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly targetUrl: string,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

/**
 * Fetch wrapper that routes requests through the proxy sidecar.
 *
 * @param url - The target URL to fetch
 * @param init - Standard fetch RequestInit options
 * @returns The Response from the target URL
 * @throws ProxyError if the proxy rejects the request (e.g., URL not in allowlist)
 *
 * @example
 * ```typescript
 * const response = await proxyFetch('https://api.example.com/data');
 * const json = await response.json();
 * ```
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(PROXY_URL, {
    ...init,
    method: init?.method ?? 'GET',
    headers: {
      ...init?.headers,
      'X-Target-URL': url,
    },
  });

  // Check for proxy-level errors (400, 403, 502)
  if (response.status === 400 || response.status === 403 || response.status === 502) {
    const errorBody = await response.text();
    let message: string;
    try {
      const parsed: unknown = JSON.parse(errorBody);
      message = isProxyErrorResponse(parsed) ? parsed.error : errorBody;
    } catch {
      message = errorBody;
    }
    throw new ProxyError(message, response.status, url);
  }

  return response;
}

/**
 * Type guard for proxy error response.
 */
function isProxyErrorResponse(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

/**
 * Simple GET request through the proxy.
 *
 * @param url - The target URL to fetch
 * @returns The response body as text
 * @throws ProxyError if the request is blocked or fails
 *
 * @example
 * ```typescript
 * const html = await proxyGet('https://example.com');
 * ```
 */
export async function proxyGet(url: string): Promise<string> {
  const response = await proxyFetch(url);
  return response.text();
}

/**
 * Simple POST request with JSON body through the proxy.
 *
 * @param url - The target URL
 * @param body - Object to serialize as JSON body
 * @returns The response body as text
 * @throws ProxyError if the request is blocked or fails
 *
 * @example
 * ```typescript
 * const result = await proxyPost('https://api.example.com/items', {
 *   name: 'Widget',
 *   count: 5,
 * });
 * ```
 */
export async function proxyPost(url: string, body: unknown): Promise<string> {
  const response = await proxyFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return response.text();
}

/**
 * GET request that parses response as JSON.
 *
 * @param url - The target URL
 * @returns The parsed JSON response
 * @throws ProxyError if the request is blocked or fails
 *
 * @example
 * ```typescript
 * interface User { id: string; name: string; }
 * const user = await proxyGetJson<User>('https://api.example.com/user/123');
 * console.log(user.name);
 * ```
 */
export async function proxyGetJson<T = unknown>(url: string): Promise<T> {
  const response = await proxyFetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json() as Promise<T>;
}

/**
 * POST request that sends and receives JSON.
 *
 * @param url - The target URL
 * @param body - Object to serialize as JSON body
 * @returns The parsed JSON response
 * @throws ProxyError if the request is blocked or fails
 *
 * @example
 * ```typescript
 * interface CreateResponse { id: string; created: boolean; }
 * const result = await proxyPostJson<CreateResponse>(
 *   'https://api.example.com/items',
 *   { name: 'Widget' }
 * );
 * console.log(result.id);
 * ```
 */
export async function proxyPostJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await proxyFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}
