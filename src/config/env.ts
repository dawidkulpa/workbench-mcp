import { z } from 'zod';

/**
 * Custom boolean coercion that handles string 'false' correctly.
 */
const booleanFromString = z
  .union([z.boolean(), z.string().transform((val) => val.toLowerCase() === 'true')])
  .default(false);

/**
 * Environment configuration schema with Zod validation.
 * All external configuration is validated at startup.
 */
const EnvSchema = z.object({
  // Server
  WORKBENCH_PORT: z.coerce.number().positive().default(3000),
  WORKBENCH_LOG_LEVEL: z.enum(['info', 'debug', 'warn', 'error']).default('info'),
  WORKBENCH_API_TOKEN: z.string().optional(),
  WORKBENCH_MAX_SESSIONS: z.coerce.number().positive().default(5),
  WORKBENCH_IDLE_TIMEOUT_MIN: z.coerce.number().positive().default(10),
  WORKBENCH_AUDIT_LOG_PATH: z.string().default('./audit.jsonl'),
  WORKBENCH_AUDIT_VERBOSE: booleanFromString,

  // Docker
  WORKBENCH_SANDBOX_IMAGE: z.string().default('workbench-sandbox:1.0'),
  WORKBENCH_PROXY_IMAGE: z.string().default('workbench-proxy:1.0'),
  WORKBENCH_TOOLBELT_HOST_PATH: z.string().optional(),
  WORKBENCH_SANDBOX_CPU: z.coerce.number().positive().default(0.5),
  WORKBENCH_SANDBOX_MEM: z.string().default('512m'),
  WORKBENCH_EXEC_TIMEOUT_MS: z.coerce.number().positive().default(60000),

  // Proxy
  WORKBENCH_FETCH_ALLOWLIST: z
    .string()
    .default('')
    .transform((val: string): string[] => (val ? val.split(',').map((s: string) => s.trim()) : [])),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

/**
 * Derived configuration with computed values.
 */
export interface Config {
  server: {
    port: number;
    logLevel: 'info' | 'debug' | 'warn' | 'error';
    apiToken: string | undefined;
  };
  session: {
    maxSessions: number;
    idleTimeoutMs: number;
  };
  docker: {
    sandboxImage: string;
    proxyImage: string;
    toolbeltHostPath: string | undefined;
    sandboxCpu: number;
    sandboxMem: string;
    execTimeoutMs: number;
  };
  proxy: {
    allowlist: string[];
  };
  audit: {
    logPath: string;
    verbose: boolean;
  };
  env: 'development' | 'production' | 'test';
}

/**
 * Parse and validate environment variables, returning a structured config.
 * Throws ZodError if validation fails.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.parse(env);

  return {
    server: {
      port: parsed.WORKBENCH_PORT,
      logLevel: parsed.WORKBENCH_LOG_LEVEL,
      apiToken: parsed.WORKBENCH_API_TOKEN,
    },
    session: {
      maxSessions: parsed.WORKBENCH_MAX_SESSIONS,
      idleTimeoutMs: parsed.WORKBENCH_IDLE_TIMEOUT_MIN * 60 * 1000,
    },
    docker: {
      sandboxImage: parsed.WORKBENCH_SANDBOX_IMAGE,
      proxyImage: parsed.WORKBENCH_PROXY_IMAGE,
      toolbeltHostPath: parsed.WORKBENCH_TOOLBELT_HOST_PATH,
      sandboxCpu: parsed.WORKBENCH_SANDBOX_CPU,
      sandboxMem: parsed.WORKBENCH_SANDBOX_MEM,
      execTimeoutMs: parsed.WORKBENCH_EXEC_TIMEOUT_MS,
    },
    proxy: {
      allowlist: parsed.WORKBENCH_FETCH_ALLOWLIST,
    },
    audit: {
      logPath: parsed.WORKBENCH_AUDIT_LOG_PATH,
      verbose: parsed.WORKBENCH_AUDIT_VERBOSE,
    },
    env: parsed.NODE_ENV,
  };
}
