import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { Env, MCPRequest, MCPResponse } from './types';
import { TOOLS, executeTool } from './tools';
import { listTemplates } from './templates';
import { CloudflareClient } from './cloudflare-client';
import {
  createRequestContext,
  TracingLogger,
  addCorrelationHeader,
} from './lib/tracing';
import { categorizeError, RateLimitError } from './lib/errors';
import { rateLimitHeaders } from './lib/rate-limit';

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time even on length mismatch
    const dummy = Buffer.from(a);
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const app = new Hono<{ Bindings: Env }>();

// Health check with bootstrap token verification
app.get('/health', async c => {
  // Basic health if no bootstrap token
  if (!c.env.CLOUDFLARE_BOOTSTRAP_TOKEN) {
    return c.json({
      status: 'degraded',
      service: 'cloudflare-token-manager',
      error: 'Bootstrap token not configured',
    }, 503);
  }

  // Verify bootstrap token works by listing accounts
  try {
    const client = new CloudflareClient(c.env.CLOUDFLARE_BOOTSTRAP_TOKEN);
    await client.listAccounts();
    return c.json({ status: 'ok', service: 'cloudflare-token-manager' });
  } catch {
    return c.json({
      status: 'degraded',
      service: 'cloudflare-token-manager',
      error: 'Bootstrap token verification failed',
    }, 503);
  }
});

// Public templates list
app.get('/templates', c => {
  const templates = listTemplates();
  return c.json({
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })),
  });
});

// MCP endpoint
app.post('/mcp', async c => {
  // Create request context for tracing
  const ctx = createRequestContext(c.req.raw);
  const logger = new TracingLogger(ctx.correlationId, ctx.startTime);

  // Helper to add correlation ID and optional rate limit headers to responses
  const respond = (
    response: MCPResponse,
    status: 200 | 401 | 429 | 503 = 200,
    extraHeaders?: Record<string, string>
  ) => {
    const res = c.json(response, status);
    const withCorrelation = addCorrelationHeader(res, ctx.correlationId);

    if (extraHeaders) {
      const headers = new Headers(withCorrelation.headers);
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
      return new Response(withCorrelation.body, {
        status: withCorrelation.status,
        statusText: withCorrelation.statusText,
        headers,
      });
    }

    return withCorrelation;
  };

  // Authenticate with constant-time comparison to prevent timing attacks
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey || !secureCompare(apiKey, c.env.MCP_API_KEY)) {
    logger.warn('Unauthorized request');
    return respond(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Unauthorized',
          data: { correlationId: ctx.correlationId },
        },
      } as MCPResponse,
      401
    );
  }

  // Check bootstrap token is configured - use 503 for service config issue
  if (!c.env.CLOUDFLARE_BOOTSTRAP_TOKEN) {
    logger.error('Bootstrap token not configured');
    return respond(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Bootstrap token not configured',
          data: { correlationId: ctx.correlationId },
        },
      } as MCPResponse,
      503
    );
  }

  let request: MCPRequest;
  try {
    request = await c.req.json();
  } catch {
    logger.warn('Invalid JSON in request body');
    return respond({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
        data: { correlationId: ctx.correlationId },
      },
    } as MCPResponse);
  }

  // Get client IP for rate limiting
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

  logger.info('Processing MCP request', { method: request.method, toolName: request.params?.name });

  const { response, rateLimitInfo } = await handleMCPRequest(request, c.env, clientIp, logger, ctx.correlationId);

  logger.info('Request completed', { duration: logger.getElapsedMs() });

  // Add rate limit headers if available
  const headers = rateLimitInfo
    ? rateLimitHeaders(rateLimitInfo.remaining, rateLimitInfo.resetAt)
    : undefined;

  const status = rateLimitInfo?.limited ? 429 : 200;
  return respond(response, status, headers);
});

interface RateLimitInfo {
  remaining: number;
  resetAt: number;
  limited: boolean;
}

interface MCPResult {
  response: MCPResponse;
  rateLimitInfo?: RateLimitInfo;
}

async function handleMCPRequest(
  request: MCPRequest,
  env: Env,
  clientIp: string,
  logger: TracingLogger,
  correlationId: string
): Promise<MCPResult> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        return {
          response: {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'cloudflare-token-manager',
                version: '1.0.0',
              },
              capabilities: {
                tools: {},
              },
            },
          },
        };
      }

      case 'tools/list': {
        return {
          response: {
            jsonrpc: '2.0',
            id,
            result: {
              tools: TOOLS,
            },
          },
        };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const args = (params?.arguments as Record<string, unknown>) || {};

        if (!toolName) {
          return {
            response: {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Missing tool name',
                data: { correlationId },
              },
            },
          };
        }

        const tool = TOOLS.find(t => t.name === toolName);
        if (!tool) {
          return {
            response: {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: `Unknown tool: ${toolName}`,
                data: { correlationId },
              },
            },
          };
        }

        try {
          const result = await executeTool(toolName, args, env, clientIp);
          return {
            response: {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                  },
                ],
              },
            },
          };
        } catch (error) {
          // Categorize error for better handling
          const categorized = categorizeError(error, correlationId);
          logger.error('Tool execution failed', {
            tool: toolName,
            errorCode: categorized.code,
            errorMessage: categorized.message,
          });

          // Return rate limit info in headers if applicable
          let rateLimitInfo: RateLimitInfo | undefined;
          if (categorized instanceof RateLimitError && categorized.retryAfter) {
            rateLimitInfo = {
              remaining: 0,
              resetAt: Date.now() + categorized.retryAfter * 1000,
              limited: true,
            };
          }

          return {
            response: {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{
                  type: 'text',
                  text: `Error: ${categorized.message}`,
                }],
                isError: true,
              },
            },
            rateLimitInfo,
          };
        }
      }

      case 'notifications/initialized':
      case 'ping': {
        return {
          response: {
            jsonrpc: '2.0',
            id,
            result: {},
          },
        };
      }

      default: {
        return {
          response: {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
              data: { correlationId },
            },
          },
        };
      }
    }
  } catch (error) {
    const categorized = categorizeError(error, correlationId);
    logger.error('Request handler failed', {
      errorCode: categorized.code,
      errorMessage: categorized.message,
    });
    return {
      response: {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: categorized.message,
          data: { correlationId },
        },
      },
    };
  }
}

export default app;
