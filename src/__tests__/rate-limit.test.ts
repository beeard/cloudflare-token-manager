import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, getClientId, rateLimitHeaders } from '../lib/rate-limit';
import type { Env } from '../types';

// Mock KV namespace
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string, options?: unknown) => {
      const value = store.get(key);
      if (!value) return null;
      if (options === 'json') return JSON.parse(value);
      return value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('checkRateLimit', () => {
  let mockKV: KVNamespace;
  let env: Env;

  beforeEach(() => {
    mockKV = createMockKV();
    env = {
      CLOUDFLARE_BOOTSTRAP_TOKEN: 'test-token',
      MCP_API_KEY: 'test-api-key',
      RATE_LIMIT_KV: mockKV,
    };
  });

  it('allows first request', async () => {
    const result = await checkRateLimit(env, 'token-ops', 'client-1');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // 10 - 1
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('tracks multiple requests', async () => {
    await checkRateLimit(env, 'token-ops', 'client-1');
    await checkRateLimit(env, 'token-ops', 'client-1');
    const result = await checkRateLimit(env, 'token-ops', 'client-1');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7); // 10 - 3
  });

  it('rate limits after exceeding threshold', async () => {
    // Make 10 requests (the limit)
    for (let i = 0; i < 10; i++) {
      const result = await checkRateLimit(env, 'token-ops', 'client-1');
      expect(result.allowed).toBe(true);
    }

    // 11th request should be blocked
    const result = await checkRateLimit(env, 'token-ops', 'client-1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('separates rate limits by client', async () => {
    // Fill up client-1's quota
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(env, 'token-ops', 'client-1');
    }

    // client-2 should still be allowed
    const result = await checkRateLimit(env, 'token-ops', 'client-2');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('separates rate limits by operation', async () => {
    // Fill up token-ops quota
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(env, 'token-ops', 'client-1');
    }

    // Different operation should use default limits (100)
    const result = await checkRateLimit(env, 'other-ops', 'client-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('falls back to in-memory when KV not configured', async () => {
    const envWithoutKV: Env = {
      CLOUDFLARE_BOOTSTRAP_TOKEN: 'test-token',
      MCP_API_KEY: 'test-api-key',
    };

    const result = await checkRateLimit(envWithoutKV, 'token-ops', 'client-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);

    // Second request should work too
    const result2 = await checkRateLimit(envWithoutKV, 'token-ops', 'client-1');
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(8);
  });

  it('stores data in KV', async () => {
    await checkRateLimit(env, 'token-ops', 'client-1');

    expect(mockKV.put).toHaveBeenCalled();
    const putCall = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[0]).toBe('ratelimit:token-ops:client-1');
  });
});

describe('getClientId', () => {
  it('uses X-Client-ID header when present', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Client-ID': 'my-client' },
    });
    expect(getClientId(request)).toBe('client:my-client');
  });

  it('falls back to CF-Connecting-IP', () => {
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    });
    expect(getClientId(request)).toBe('ip:192.168.1.1');
  });

  it('returns unknown when no identifiers present', () => {
    const request = new Request('https://example.com');
    expect(getClientId(request)).toBe('ip:unknown');
  });

  it('prefers X-Client-ID over IP', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Client-ID': 'my-client',
        'CF-Connecting-IP': '192.168.1.1',
      },
    });
    expect(getClientId(request)).toBe('client:my-client');
  });
});

describe('rateLimitHeaders', () => {
  it('creates correct headers', () => {
    const resetAt = Date.now() + 30000;
    const headers = rateLimitHeaders(5, resetAt);

    expect(headers['X-RateLimit-Remaining']).toBe('5');
    expect(headers['X-RateLimit-Reset']).toBe(String(Math.ceil(resetAt / 1000)));
  });
});
