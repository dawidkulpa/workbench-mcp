# Toolbelt
Read-only utilities available to sandbox containers at `/toolbelt`.

## Available Utilities

### HTTP Helper
Located at `/toolbelt/http/`, this helper provides examples for making HTTP requests through the proxy sidecar.

## Usage in Sandbox

```typescript
// The toolbelt is mounted at /toolbelt (read-only)
import { readFileSync } from 'fs';

// Read example code
const example = readFileSync('/toolbelt/http/examples.md', 'utf8');
console.log(example);
```

## Adding New Utilities

1. Create a new directory under `/toolbelt`
2. Add your utility files
3. Document usage in this README
4. Rebuild/restart the workbench service
