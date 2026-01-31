/**
 * Request Tracing
 *
 * Correlation ID generation and propagation for debugging.
 */

/**
 * Generate a unique correlation ID
 * Format: ctm-{timestamp}-{random}
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `ctm-${timestamp}-${random}`;
}

/**
 * Extract correlation ID from request headers
 * Checks X-Correlation-ID and X-Request-ID headers
 */
export function extractCorrelationId(request: Request): string | null {
  return (
    request.headers.get('X-Correlation-ID') ||
    request.headers.get('X-Request-ID') ||
    null
  );
}

/**
 * Get or generate correlation ID from request
 */
export function getOrCreateCorrelationId(request: Request): string {
  return extractCorrelationId(request) || generateCorrelationId();
}

/**
 * Request context for tracing
 */
export interface RequestContext {
  correlationId: string;
  startTime: number;
  method: string;
  path: string;
  clientId?: string;
}

/**
 * Create request context from incoming request
 */
export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  return {
    correlationId: getOrCreateCorrelationId(request),
    startTime: Date.now(),
    method: request.method,
    path: url.pathname,
    clientId: request.headers.get('X-Client-ID') ||
              request.headers.get('CF-Connecting-IP') ||
              undefined,
  };
}

/**
 * Structured log entry
 */
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  correlationId: string;
  timestamp: string;
  duration?: number;
  data?: Record<string, unknown>;
}

/**
 * Logger with correlation ID support
 */
export class TracingLogger {
  private correlationId: string;
  private startTime: number;

  constructor(correlationId: string, startTime?: number) {
    this.correlationId = correlationId;
    this.startTime = startTime ?? Date.now();
  }

  private log(
    level: LogEntry['level'],
    message: string,
    data?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level,
      message,
      correlationId: this.correlationId,
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      data,
    };

    // Use appropriate console method
    switch (level) {
      case 'debug':
        console.debug(JSON.stringify(entry));
        break;
      case 'info':
        console.info(JSON.stringify(entry));
        break;
      case 'warn':
        console.warn(JSON.stringify(entry));
        break;
      case 'error':
        console.error(JSON.stringify(entry));
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  /**
   * Create a child logger with the same correlation ID
   */
  child(): TracingLogger {
    return new TracingLogger(this.correlationId, this.startTime);
  }

  /**
   * Get the correlation ID
   */
  getCorrelationId(): string {
    return this.correlationId;
  }

  /**
   * Get elapsed time in ms
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Add correlation ID header to response
 */
export function addCorrelationHeader(
  response: Response,
  correlationId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Correlation-ID', correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
