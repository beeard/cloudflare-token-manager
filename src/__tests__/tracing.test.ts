import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCorrelationId,
  extractCorrelationId,
  getOrCreateCorrelationId,
  createRequestContext,
  TracingLogger,
  addCorrelationHeader,
} from '../lib/tracing';

describe('generateCorrelationId', () => {
  it('generates unique IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();

    expect(id1).not.toBe(id2);
  });

  it('starts with ctm- prefix', () => {
    const id = generateCorrelationId();
    expect(id.startsWith('ctm-')).toBe(true);
  });

  it('has reasonable length', () => {
    const id = generateCorrelationId();
    expect(id.length).toBeGreaterThan(10);
    expect(id.length).toBeLessThan(30);
  });
});

describe('extractCorrelationId', () => {
  it('extracts X-Correlation-ID header', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Correlation-ID': 'test-123' },
    });

    expect(extractCorrelationId(request)).toBe('test-123');
  });

  it('extracts X-Request-ID header', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Request-ID': 'req-456' },
    });

    expect(extractCorrelationId(request)).toBe('req-456');
  });

  it('prefers X-Correlation-ID over X-Request-ID', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Correlation-ID': 'corr-123',
        'X-Request-ID': 'req-456',
      },
    });

    expect(extractCorrelationId(request)).toBe('corr-123');
  });

  it('returns null if no ID present', () => {
    const request = new Request('https://example.com');
    expect(extractCorrelationId(request)).toBeNull();
  });
});

describe('getOrCreateCorrelationId', () => {
  it('returns existing ID if present', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Correlation-ID': 'existing-id' },
    });

    expect(getOrCreateCorrelationId(request)).toBe('existing-id');
  });

  it('generates new ID if none present', () => {
    const request = new Request('https://example.com');
    const id = getOrCreateCorrelationId(request);

    expect(id).toBeDefined();
    expect(id.startsWith('ctm-')).toBe(true);
  });
});

describe('createRequestContext', () => {
  it('creates context with all properties', () => {
    const request = new Request('https://example.com/api/test', {
      method: 'POST',
      headers: { 'X-Client-ID': 'client-123' },
    });

    const ctx = createRequestContext(request);

    expect(ctx.correlationId).toBeDefined();
    expect(ctx.startTime).toBeLessThanOrEqual(Date.now());
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/api/test');
    expect(ctx.clientId).toBe('client-123');
  });

  it('uses CF-Connecting-IP as fallback for clientId', () => {
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    });

    const ctx = createRequestContext(request);
    expect(ctx.clientId).toBe('192.168.1.1');
  });
});

describe('TracingLogger', () => {
  it('logs without throwing', () => {
    const logger = new TracingLogger('test-corr-id');
    // Just verify that logging doesn't throw
    expect(() => logger.info('Test message')).not.toThrow();
    expect(() => logger.debug('debug msg')).not.toThrow();
    expect(() => logger.warn('warn msg')).not.toThrow();
    expect(() => logger.error('error msg')).not.toThrow();
  });

  it('logs with data without throwing', () => {
    const logger = new TracingLogger('test-id');
    expect(() => logger.info('Test message', { key: 'value' })).not.toThrow();
  });

  it('getCorrelationId returns ID', () => {
    const logger = new TracingLogger('my-corr-id');
    expect(logger.getCorrelationId()).toBe('my-corr-id');
  });

  it('getElapsedMs returns elapsed time', async () => {
    const startTime = Date.now() - 50;
    const logger = new TracingLogger('test-id', startTime);

    expect(logger.getElapsedMs()).toBeGreaterThanOrEqual(50);
  });

  it('child logger shares correlation ID', () => {
    const parent = new TracingLogger('parent-id');
    const child = parent.child();

    expect(child.getCorrelationId()).toBe('parent-id');
  });
});

describe('addCorrelationHeader', () => {
  it('adds correlation ID to response', () => {
    const response = new Response('body', { status: 200 });
    const withHeader = addCorrelationHeader(response, 'test-corr-id');

    expect(withHeader.headers.get('X-Correlation-ID')).toBe('test-corr-id');
    expect(withHeader.status).toBe(200);
  });

  it('preserves existing headers', () => {
    const response = new Response('body', {
      headers: { 'Content-Type': 'application/json' },
    });
    const withHeader = addCorrelationHeader(response, 'test-id');

    expect(withHeader.headers.get('Content-Type')).toBe('application/json');
    expect(withHeader.headers.get('X-Correlation-ID')).toBe('test-id');
  });
});
