/**
 * Workbench Proxy Sidecar
 *
 * A lightweight HTTP proxy that enforces URL allowlists.
 * Sandbox containers can only access external URLs through this proxy.
 *
 * Environment Variables:
 * - PROXY_PORT: Port to listen on (default: 3128)
 * - PROXY_ALLOWLIST: Comma-separated list of allowed URL patterns
 *
 * Protocol:
 * - Send HTTP requests with X-Target-URL header containing the actual target
 * - Proxy will check against allowlist and forward if allowed
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = parseInt(process.env.PROXY_PORT ?? '3128', 10);
const ALLOWLIST_RAW = process.env.PROXY_ALLOWLIST ?? '';

/**
 * Parse allowlist from environment.
 * Supports patterns like:
 * - "api.example.com" - exact domain match
 * - "*.example.com" - wildcard subdomain
 * - "https://api.example.com/v1/*" - path prefix
 */
function parseAllowlist(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const ALLOWLIST = parseAllowlist(ALLOWLIST_RAW);

/**
 * Check if a URL matches an allowlist pattern.
 */
function matchesPattern(url: string, pattern: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const fullUrl = urlObj.href;

    // Exact domain match
    if (pattern === hostname) {
      return true;
    }

    // Wildcard subdomain: *.example.com
    if (pattern.startsWith('*.')) {
      const baseDomain = pattern.slice(2);
      if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
        return true;
      }
    }

    // URL prefix match: https://api.example.com/v1/*
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (fullUrl.startsWith(prefix)) {
        return true;
      }
    }

    // Exact URL match
    if (fullUrl === pattern) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if URL is allowed by allowlist.
 */
function isAllowed(url: string): boolean {
  if (ALLOWLIST.length === 0) {
    // Empty allowlist = nothing allowed
    return false;
  }

  return ALLOWLIST.some((pattern) => matchesPattern(url, pattern));
}

/**
 * Log a request (structured for easy parsing).
 */
function logRequest(
  method: string,
  targetUrl: string,
  allowed: boolean,
  statusCode: number,
  durationMs: number,
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    method,
    targetUrl,
    allowed,
    statusCode,
    durationMs,
  };
  console.log(JSON.stringify(logEntry));
}

/**
 * Send an error response.
 */
function sendError(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, statusCode }));
}

/**
 * Forward request to target URL.
 */
async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
): Promise<void> {
  const startTime = Date.now();
  const method = req.method ?? 'GET';

  try {
    // Collect request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    // Build headers (exclude internal headers)
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase().startsWith('x-target') || key.toLowerCase() === 'host') {
        continue;
      }
      if (value) {
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    // Forward the request using native fetch
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      // Don't follow redirects automatically - let client handle
      redirect: 'manual',
    });

    // Forward response status and headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.writeHead(response.status, responseHeaders);

    // Stream response body
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    res.end();

    logRequest(method, targetUrl, true, response.status, Date.now() - startTime);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendError(res, 502, `Failed to forward request: ${errorMessage}`);
    logRequest(method, targetUrl, true, 502, Date.now() - startTime);
  }
}

/**
 * Handle incoming proxy request.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startTime = Date.now();
  const method = req.method ?? 'GET';

  // Get target URL from header
  const targetUrl = req.headers['x-target-url'];

  if (!targetUrl || Array.isArray(targetUrl)) {
    sendError(res, 400, 'Missing or invalid X-Target-URL header');
    logRequest(method, '', false, 400, Date.now() - startTime);
    return;
  }

  // Validate URL format
  try {
    new URL(targetUrl);
  } catch {
    sendError(res, 400, `Invalid target URL: ${targetUrl}`);
    logRequest(method, targetUrl, false, 400, Date.now() - startTime);
    return;
  }

  // Check allowlist
  if (!isAllowed(targetUrl)) {
    sendError(res, 403, `URL not in allowlist: ${targetUrl}`);
    logRequest(method, targetUrl, false, 403, Date.now() - startTime);
    return;
  }

  // Forward the request
  await forwardRequest(req, res, targetUrl);
}

/**
 * Health check endpoint.
 */
function handleHealth(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', allowlistCount: ALLOWLIST.length }));
}

// Create and start server
const server = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    handleHealth(res);
    return;
  }

  // All other requests are proxy requests
  handleRequest(req, res).catch((error) => {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
      sendError(res, 500, 'Internal server error');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'startup',
      port: PORT,
      allowlist: ALLOWLIST,
    }),
  );
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'shutdown' }));
  server.close(() => process.exit(0));
});
