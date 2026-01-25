import { describe, it, expect } from 'vitest';
import { getProxyName, getProxyPort } from '../../../src/docker/proxy.js';

/**
 * Unit tests for proxy helper functions.
 * The createProxy function requires Docker and is tested in integration tests.
 */
describe('Proxy Helpers', () => {
  describe('getProxyName', () => {
    it('should generate proxy container name from conversation ID', () => {
      expect(getProxyName('conv-123')).toBe('workbench-proxy-conv-123');
    });

    it('should handle complex conversation IDs', () => {
      expect(getProxyName('abc-def-ghi-123')).toBe('workbench-proxy-abc-def-ghi-123');
    });
  });

  describe('getProxyPort', () => {
    it('should return the standard proxy port', () => {
      expect(getProxyPort()).toBe(3128);
    });
  });
});
