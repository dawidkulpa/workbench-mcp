# HTTP Examples

## Making Requests Through Proxy

The sandbox has no direct internet access. All HTTP requests must go through the proxy sidecar.

### Using the Helper Module

```typescript
import { proxyGet, proxyPost } from '/toolbelt/http/index.js';

// GET request
const data = await proxyGet('http://homeassistant.local:8123/api/states');
console.log(data);

// POST request
const result = await proxyPost('http://homeassistant.local:8123/api/services/light/turn_on', {
  entity_id: 'light.living_room'
});
console.log(result);
```

### Manual Proxy Usage

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

## Allowed URLs

Only URLs in the allowlist can be accessed. Requests to URLs not in the allowlist will be rejected with a 403 error.
