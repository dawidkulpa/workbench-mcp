# HTTP Examples

The sandbox has no direct internet access. All HTTP requests must go through the proxy sidecar.

## Import

```typescript
import {
  proxyFetch,
  proxyGet,
  proxyPost,
  proxyGetJson,
  proxyPostJson,
  ProxyError,
} from '/toolbelt/http/index.js';
```

## Basic GET Request

```typescript
const html = await proxyGet('https://example.com');
console.log(html);
```

## GET JSON Response

```typescript
interface ApiResponse {
  id: string;
  name: string;
  data: unknown[];
}

const result = await proxyGetJson<ApiResponse>('https://api.example.com/resource');
console.log(result.name);
```

## POST with JSON Body

```typescript
const response = await proxyPost('https://api.example.com/items', {
  name: 'New Item',
  value: 42,
});
console.log(response);
```

## POST JSON and Get JSON Response

```typescript
interface CreateResponse {
  id: string;
  created: boolean;
}

const result = await proxyPostJson<CreateResponse>(
  'https://api.example.com/items',
  { name: 'Widget', count: 5 }
);
console.log('Created item:', result.id);
```

## Full Control with proxyFetch

```typescript
const response = await proxyFetch('https://api.example.com/resource', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer token123',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ updated: true }),
});

if (!response.ok) {
  throw new Error(`Request failed: ${response.status}`);
}

const data = await response.json();
console.log(data);
```

## Manual Proxy Usage (Low-Level)

```typescript
// The proxy listens on http://proxy:3128
const response = await fetch('http://proxy:3128', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Target-URL': 'http://homeassistant.local:8123/api/states',
  },
});
const data = await response.json();
```

## Error Handling

The proxy may reject requests for URLs not in the allowlist:

```typescript
try {
  const data = await proxyGet('https://blocked-site.com');
} catch (error) {
  if (error instanceof ProxyError) {
    console.error(`Proxy blocked request: ${error.message}`);
    console.error(`Target URL: ${error.targetUrl}`);
    console.error(`Status code: ${error.statusCode}`);
  } else {
    throw error;
  }
}
```

## Common Status Codes

| Code | Meaning |
|------|---------|
| 403 | URL not in allowlist |
| 400 | Invalid or missing X-Target-URL header |
| 502 | Proxy failed to reach target |

## Allowlist

Only URLs in the allowlist can be accessed. Requests to URLs not in the allowlist will be rejected with a 403 error.
