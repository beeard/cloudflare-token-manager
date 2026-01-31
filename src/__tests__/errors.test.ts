import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  McpError,
  NetworkError,
  TimeoutError,
  ValidationError,
  RateLimitError,
  CloudflareApiError,
  categorizeError,
  createErrorResponse,
} from '../lib/errors';

describe('McpError', () => {
  it('creates error with required properties', () => {
    const error = new McpError(ErrorCode.UNKNOWN_ERROR, 'Test error');

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(error.name).toBe('McpError');
    expect(error.retryable).toBe(false);
  });

  it('creates error with optional properties', () => {
    const error = new McpError(ErrorCode.UNKNOWN_ERROR, 'Test error', {
      details: { key: 'value' },
      correlationId: 'test-123',
      retryable: true,
    });

    expect(error.details).toEqual({ key: 'value' });
    expect(error.correlationId).toBe('test-123');
    expect(error.retryable).toBe(true);
  });

  it('toJSON returns structured error', () => {
    const error = new McpError(ErrorCode.VALIDATION_ERROR, 'Invalid input', {
      details: { field: 'name' },
      correlationId: 'test-123',
    });

    const json = error.toJSON();
    expect(json).toEqual({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid input',
      details: { field: 'name' },
      correlationId: 'test-123',
      retryable: false,
    });
  });
});

describe('NetworkError', () => {
  it('sets correct code and retryable', () => {
    const error = new NetworkError('Connection failed');

    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.name).toBe('NetworkError');
    expect(error.retryable).toBe(true);
  });
});

describe('TimeoutError', () => {
  it('sets correct code and retryable', () => {
    const error = new TimeoutError('Request timed out');

    expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
    expect(error.name).toBe('TimeoutError');
    expect(error.retryable).toBe(true);
  });
});

describe('ValidationError', () => {
  it('sets correct code and not retryable', () => {
    const error = new ValidationError('Invalid input');

    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.name).toBe('ValidationError');
    expect(error.retryable).toBe(false);
  });

  it('includes details', () => {
    const error = new ValidationError('Invalid input', {
      details: { field: 'email', reason: 'invalid format' },
    });

    expect(error.details).toEqual({ field: 'email', reason: 'invalid format' });
  });
});

describe('RateLimitError', () => {
  it('sets correct code and retryable', () => {
    const error = new RateLimitError('Too many requests');

    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.name).toBe('RateLimitError');
    expect(error.retryable).toBe(true);
  });

  it('includes retryAfter', () => {
    const error = new RateLimitError('Too many requests', { retryAfter: 30 });

    expect(error.retryAfter).toBe(30);
    expect(error.details).toEqual({ retryAfter: 30 });
  });
});

describe('CloudflareApiError', () => {
  it('sets correct code', () => {
    const error = new CloudflareApiError('API error');

    expect(error.code).toBe(ErrorCode.CLOUDFLARE_API_ERROR);
    expect(error.name).toBe('CloudflareApiError');
  });

  it('is retryable for 5xx status codes', () => {
    const error = new CloudflareApiError('Server error', { statusCode: 500 });

    expect(error.retryable).toBe(true);
    expect(error.statusCode).toBe(500);
  });

  it('is not retryable for 4xx status codes', () => {
    const error = new CloudflareApiError('Bad request', { statusCode: 400 });

    expect(error.retryable).toBe(false);
    expect(error.statusCode).toBe(400);
  });

  it('includes Cloudflare errors', () => {
    const cfErrors = [{ code: 1001, message: 'Invalid token' }];
    const error = new CloudflareApiError('API error', { cfErrors });

    expect(error.cfErrors).toEqual(cfErrors);
  });
});

describe('categorizeError', () => {
  it('returns McpError unchanged', () => {
    const original = new ValidationError('Test error');
    const result = categorizeError(original);

    expect(result).toBe(original);
  });

  it('adds correlationId to McpError if missing', () => {
    const original = new ValidationError('Test error');
    const result = categorizeError(original, 'new-correlation-id');

    expect(result.correlationId).toBe('new-correlation-id');
    expect(result.message).toBe('Test error');
  });

  it('categorizes TypeError as NetworkError', () => {
    const typeError = new TypeError('Failed to fetch');
    const result = categorizeError(typeError);

    expect(result).toBeInstanceOf(NetworkError);
    expect(result.code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('categorizes DOMException AbortError as TimeoutError', () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const result = categorizeError(abortError);

    expect(result).toBeInstanceOf(TimeoutError);
    expect(result.code).toBe(ErrorCode.TIMEOUT_ERROR);
  });

  it('categorizes timeout message as TimeoutError', () => {
    const error = new Error('Request timed out after 30s');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(TimeoutError);
  });

  it('categorizes network message as NetworkError', () => {
    const error = new Error('Network connection failed');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(NetworkError);
  });

  it('categorizes rate limit message as RateLimitError', () => {
    const error = new Error('Rate limit exceeded');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(RateLimitError);
  });

  it('categorizes string as UNKNOWN_ERROR', () => {
    const result = categorizeError('Something went wrong');

    expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(result.message).toBe('Something went wrong');
  });

  it('categorizes unknown value as UNKNOWN_ERROR', () => {
    const result = categorizeError({ unexpected: true });

    expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(result.message).toBe('An unknown error occurred');
  });
});

describe('createErrorResponse', () => {
  it('creates error response object', () => {
    const error = new ValidationError('Invalid input', {
      correlationId: 'test-123',
    });

    const response = createErrorResponse(error);

    expect(response).toEqual({
      error: 'Invalid input',
      code: ErrorCode.VALIDATION_ERROR,
      retryable: false,
      correlationId: 'test-123',
    });
  });
});
