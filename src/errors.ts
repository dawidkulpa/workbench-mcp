/**
 * Base error class for all Workbench errors.
 * Includes error code and HTTP status for consistent error handling.
 */
export class WorkbenchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'WorkbenchError';
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { error: string; code: string; statusCode: number } {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Session not found for the given conversation ID.
 */
export class SessionNotFoundError extends WorkbenchError {
  constructor(conversationId: string) {
    super(`Session not found for conversation: ${conversationId}`, 'SESSION_NOT_FOUND', 404);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Maximum number of concurrent sessions reached.
 */
export class MaxSessionsError extends WorkbenchError {
  constructor(maxSessions: number) {
    super(`Maximum sessions (${maxSessions}) reached`, 'MAX_SESSIONS_REACHED', 503);
    this.name = 'MaxSessionsError';
  }
}

/**
 * Required conversation ID header is missing.
 */
export class MissingConversationIdError extends WorkbenchError {
  constructor() {
    super('X-Conversation-Id header is required', 'MISSING_CONVERSATION_ID', 400);
    this.name = 'MissingConversationIdError';
  }
}

/**
 * Invalid path (e.g., path traversal attempt).
 */
export class InvalidPathError extends WorkbenchError {
  constructor(message: string = 'Path must be within /workspace') {
    super(message, 'INVALID_PATH', 400);
    this.name = 'InvalidPathError';
  }
}

/**
 * Docker operation failed.
 */
export class DockerError extends WorkbenchError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message, 'DOCKER_ERROR', 500);
    this.name = 'DockerError';
  }
}

/**
 * Command execution timed out.
 */
export class ExecTimeoutError extends WorkbenchError {
  constructor(timeoutMs: number) {
    super(`Command execution timed out after ${timeoutMs}ms`, 'EXEC_TIMEOUT', 408);
    this.name = 'ExecTimeoutError';
  }
}
