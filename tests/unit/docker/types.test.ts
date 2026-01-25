import { describe, it, expect } from 'vitest';
import { WORKBENCH_LABELS, CONTAINER_TYPES } from '../../../src/docker/types.js';

/**
 * Unit tests for Docker types and constants.
 *
 * Note: DockerClient requires a real Docker daemon for meaningful tests.
 * Integration tests in tests/integration/ cover actual Docker operations.
 */
describe('Docker Types', () => {
  describe('WORKBENCH_LABELS', () => {
    it('should have correct label keys', () => {
      expect(WORKBENCH_LABELS.MANAGED).toBe('workbench.managed');
      expect(WORKBENCH_LABELS.CONVERSATION_ID).toBe('workbench.conversationId');
      expect(WORKBENCH_LABELS.CONTAINER_TYPE).toBe('workbench.containerType');
    });
  });

  describe('CONTAINER_TYPES', () => {
    it('should have correct container types', () => {
      expect(CONTAINER_TYPES.SANDBOX).toBe('sandbox');
      expect(CONTAINER_TYPES.PROXY).toBe('proxy');
    });
  });
});
