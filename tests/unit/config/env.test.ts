import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';

describe('loadConfig', () => {
  it('should load default configuration', () => {
    const config = loadConfig({});

    expect(config.server.port).toBe(3000);
    expect(config.server.logLevel).toBe('info');
    expect(config.session.maxSessions).toBe(5);
    expect(config.session.idleTimeoutMs).toBe(10 * 60 * 1000);
    expect(config.docker.sandboxCpu).toBe(0.5);
    expect(config.docker.sandboxMem).toBe('512m');
    expect(config.proxy.allowlist).toEqual([]);
  });

  it('should override defaults with environment variables', () => {
    const config = loadConfig({
      WORKBENCH_PORT: '4000',
      WORKBENCH_MAX_SESSIONS: '10',
      WORKBENCH_LOG_LEVEL: 'debug',
    });

    expect(config.server.port).toBe(4000);
    expect(config.server.logLevel).toBe('debug');
    expect(config.session.maxSessions).toBe(10);
  });

  it('should parse allowlist correctly', () => {
    const config = loadConfig({
      WORKBENCH_FETCH_ALLOWLIST: 'http://localhost:3000, http://example.com:8080',
    });

    expect(config.proxy.allowlist).toEqual(['http://localhost:3000', 'http://example.com:8080']);
  });

  it('should handle empty allowlist', () => {
    const config = loadConfig({
      WORKBENCH_FETCH_ALLOWLIST: '',
    });

    expect(config.proxy.allowlist).toEqual([]);
  });

  it('should convert idle timeout to milliseconds', () => {
    const config = loadConfig({
      WORKBENCH_IDLE_TIMEOUT_MIN: '15',
    });

    expect(config.session.idleTimeoutMs).toBe(15 * 60 * 1000);
  });

  it('should throw on invalid log level', () => {
    expect(() =>
      loadConfig({
        WORKBENCH_LOG_LEVEL: 'invalid',
      }),
    ).toThrow();
  });

  it('should throw on negative port', () => {
    expect(() =>
      loadConfig({
        WORKBENCH_PORT: '-1',
      }),
    ).toThrow();
  });

  it('should coerce boolean values', () => {
    const configTrue = loadConfig({
      WORKBENCH_AUDIT_VERBOSE: 'true',
    });
    expect(configTrue.audit.verbose).toBe(true);

    const configFalse = loadConfig({
      WORKBENCH_AUDIT_VERBOSE: 'false',
    });
    expect(configFalse.audit.verbose).toBe(false);
  });
});
