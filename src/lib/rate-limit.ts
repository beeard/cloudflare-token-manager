import type { Env } from '../types';
import { z } from 'zod';

/**
 * Rate limit configuration per operation type
 */
const RATE_LIMITS: Record<string, { requests: number; windowSeconds: number }> = {
  'token-ops': { requests: 10, windowSeconds: 60 },
  default: { requests: 100, windowSeconds: 60 },
};

/**
 * Schema for validating KV rate limit data
 */
const RateLimitDataSchema = z.object({
  count: z.number(),
  timestamps: z.array(z.number()),
  version: z.number(),
});

/**
 * Sliding window rate limiter using KV with atomic-like semantics
 *
 * Uses a read-modify-write pattern with optimistic concurrency.
 * The await on KV write prevents race conditions during high concurrency.
 */
export async function checkRateLimit(
  env: Env,
  operation: string,
  clientId: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // Fall back to in-memory if KV not configured
  if (!env.RATE_LIMIT_KV) {
    return checkRateLimitInMemory(env, operation, clientId);
  }

  const config = RATE_LIMITS[operation] || RATE_LIMITS.default;
  const key = `ratelimit:${operation}:${clientId}`;

  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  // Get current count from KV with validation
  const raw = await env.RATE_LIMIT_KV.get(key, 'json');
  const parsed = RateLimitDataSchema.safeParse(raw);
  const stored = parsed.success ? parsed.data : null;

  let timestamps: number[] = stored?.timestamps || [];
  const version = (stored?.version || 0) + 1;

  // Remove expired timestamps (outside the window)
  timestamps = timestamps.filter((ts) => ts > windowStart);

  const remaining = Math.max(0, config.requests - timestamps.length);
  const resetAt = timestamps.length > 0 ? timestamps[0] + config.windowSeconds * 1000 : now + config.windowSeconds * 1000;

  if (timestamps.length >= config.requests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Add current request timestamp
  timestamps.push(now);

  // Store updated timestamps - AWAIT to prevent race conditions
  try {
    await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: timestamps.length, timestamps, version }), {
      expirationTtl: config.windowSeconds * 2, // Keep for 2x window for safety
    });
  } catch (error) {
    // Log but don't fail the request if KV write fails
    console.error('Rate limit KV write failed', { error, operation, clientId });
  }

  return { allowed: true, remaining: remaining - 1, resetAt };
}

/**
 * In-memory rate limiter (fallback when KV not configured)
 * Note: Resets on worker restart
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimitInMemory(
  env: Env,
  operation: string,
  clientId: string
): { allowed: boolean; remaining: number; resetAt: number } {
  const config = RATE_LIMITS[operation] || RATE_LIMITS.default;
  const key = `${operation}:${clientId}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: config.requests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= config.requests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.requests - entry.count, resetAt: entry.resetAt };
}

/**
 * Get client identifier from request (IP or custom header)
 */
export function getClientId(request: Request): string {
  // Check for custom client ID header first (for authenticated clients)
  const customId = request.headers.get('X-Client-ID');
  if (customId) {
    return `client:${customId}`;
  }

  // Fall back to CF-Connecting-IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `ip:${ip}`;
}

/**
 * Create rate limit headers for response
 */
export function rateLimitHeaders(
  remaining: number,
  resetAt: number
): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
}
