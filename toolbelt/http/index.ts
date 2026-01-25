/**
 * HTTP Helper for Sandbox
 * Use this module to make HTTP requests through the proxy sidecar.
 *
 * The sandbox has no direct internet access. All external HTTP requests
 * must go through the proxy sidecar at http://proxy:3128.
 */

/**
 * Fetch wrapper that routes through the proxy.
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  // The proxy sidecar is available at http://proxy:3128
  const proxyUrl = 'http://proxy:3128';

  // Construct the proxied request
  const response = await fetch(proxyUrl, {
    ...init,
    method: init?.method ?? 'GET',
    headers: {
      ...init?.headers,
      'X-Target-URL': url,
    },
  });

  return response;
}

/**
 * Simple GET request through proxy.
 */
export async function proxyGet(url: string): Promise<string> {
  const response = await proxyFetch(url);
  return response.text();
}

/**
 * Simple POST request through proxy.
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
