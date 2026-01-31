/**
 * Error Types
 *
 * Categorized errors for better client handling and debugging.
 */

/**
 * Error codes for categorization
 */
export const ErrorCode = {
  // Network errors (5xx equivalent)
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Client errors (4xx equivalent)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',

  // API errors
  API_ERROR: 'API_ERROR',
  CLOUDFLARE_API_ERROR: 'CLOUDFLARE_API_ERROR',

  // Tool errors
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',

  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Structured error with categorization
 */
export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
  retryable: boolean;
}

/**
 * Base error class with categorization
 */
export class McpError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      correlationId?: string;
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'McpError';
    this.code = code;
    this.details = options?.details;
    this.correlationId = options?.correlationId;
    this.retryable = options?.retryable ?? false;
  }

  toJSON(): StructuredError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      correlationId: this.correlationId,
      retryable: this.retryable,
    };
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends McpError {
  constructor(message: string, options?: { correlationId?: string; cause?: Error }) {
    super(ErrorCode.NETWORK_ERROR, message, {
      ...options,
      retryable: true,
    });
    this.name = 'NetworkError';
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends McpError {
  constructor(message: string, options?: { correlationId?: string; cause?: Error }) {
    super(ErrorCode.TIMEOUT_ERROR, message, {
      ...options,
      retryable: true,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Validation errors (invalid input)
 */
export class ValidationError extends McpError {
  constructor(
    message: string,
    options?: { details?: Record<string, unknown>; correlationId?: string }
  ) {
    super(ErrorCode.VALIDATION_ERROR, message, {
      ...options,
      retryable: false,
    });
    this.name = 'ValidationError';
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends McpError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    options?: { retryAfter?: number; correlationId?: string }
  ) {
    super(ErrorCode.RATE_LIMITED, message, {
      correlationId: options?.correlationId,
      retryable: true,
      details: options?.retryAfter ? { retryAfter: options.retryAfter } : undefined,
    });
    this.name = 'RateLimitError';
    this.retryAfter = options?.retryAfter;
  }
}

/**
 * Cloudflare API errors
 */
export class CloudflareApiError extends McpError {
  readonly statusCode?: number;
  readonly cfErrors?: Array<{ code: number; message: string }>;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      cfErrors?: Array<{ code: number; message: string }>;
      details?: Record<string, unknown>;
      correlationId?: string;
      cause?: Error;
    }
  ) {
    const retryable = options?.statusCode ? options.statusCode >= 500 : false;
    super(ErrorCode.CLOUDFLARE_API_ERROR, message, {
      ...options,
      retryable,
    });
    this.name = 'CloudflareApiError';
    this.statusCode = options?.statusCode;
    this.cfErrors = options?.cfErrors;
  }
}

/**
 * Categorize an unknown error
 */
export function categorizeError(
  error: unknown,
  correlationId?: string
): McpError {
  // Already categorized
  if (error instanceof McpError) {
    if (correlationId && !error.correlationId) {
      return new McpError(error.code, error.message, {
        details: error.details,
        correlationId,
        retryable: error.retryable,
        cause: error.cause instanceof Error ? error.cause : undefined,
      });
    }
    return error;
  }

  // TypeError often indicates network issues
  if (error instanceof TypeError) {
    return new NetworkError(error.message, { correlationId, cause: error });
  }

  // DOMException with AbortError name indicates timeout
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TimeoutError('Request timed out', { correlationId, cause: error });
  }

  // Generic Error
  if (error instanceof Error) {
    // Check message for hints
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return new TimeoutError(error.message, { correlationId, cause: error });
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
      return new NetworkError(error.message, { correlationId, cause: error });
    }
    if (msg.includes('rate limit')) {
      return new RateLimitError(error.message, { correlationId });
    }
    if (msg.includes('cloudflare api')) {
      return new CloudflareApiError(error.message, { correlationId, cause: error });
    }
    return new McpError(ErrorCode.UNKNOWN_ERROR, error.message, {
      correlationId,
      retryable: false,
      cause: error,
    });
  }

  // Non-Error thrown
  return new McpError(
    ErrorCode.UNKNOWN_ERROR,
    typeof error === 'string' ? error : 'An unknown error occurred',
    { correlationId, retryable: false }
  );
}

/**
 * Create an error response object for tool results
 */
export function createErrorResponse(error: McpError): {
  error: string;
  code: ErrorCode;
  retryable: boolean;
  correlationId?: string;
} {
  return {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    correlationId: error.correlationId,
  };
}
