# Changelog

## [1.2.0] - 2026-01-31

### Security
- **Timing attack prevention**: API key comparison now uses `timingSafeEqual` from Node.js crypto module
- **IP CIDR validation**: Added `validateIpCidrArray()` to validate IP addresses before passing to Cloudflare API

### Added
- Rate limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) now included in HTTP responses
- HTTP 429 status code returned when rate limited (previously 200 with error in body)
- 9 new tests for IP CIDR array validation (124 total)

### Changed
- Permission groups cache moved from instance-level to module-level for better reuse within isolate
- `listAccounts()` now supports pagination with `page` and `perPage` parameters
- `handleMCPRequest()` refactored to return `MCPResult` with optional rate limit info

### Fixed
- Removed unused imports (`McpError`, `ValidationError`) from index.ts
- Replaced non-null assertions (`accountId!`) with proper truthiness checks in rotate_token
- KV namespace ID in wrangler.toml updated from placeholder to real ID `71f9c75df98742e38a9124ac6fb672be`

---

## [1.1.0] - 2026-01-31

### Added

#### Structured Error Handling (`lib/errors.ts`)
- Added `McpError` base class with error categorization, correlation ID support, and retryability flags
- Added specialized error types: `NetworkError`, `TimeoutError`, `ValidationError`, `RateLimitError`, `CloudflareApiError`
- Added `categorizeError()` helper to automatically classify unknown errors
- Added `createErrorResponse()` for consistent error response formatting

#### Request Tracing (`lib/tracing.ts`)
- Added correlation ID generation with `ctm-{timestamp}-{random}` format
- Added `TracingLogger` class with structured JSON logging including duration tracking
- Added `createRequestContext()` to extract request metadata for tracing
- Added `addCorrelationHeader()` to include X-Correlation-ID in responses
- All requests now include correlation IDs for debugging and log correlation

#### KV-Backed Rate Limiting (`lib/rate-limit.ts`)
- Replaced in-memory rate limiter with KV-backed sliding window implementation
- Rate limit state now persists across worker restarts and instances
- Added automatic fallback to in-memory when KV not configured
- Added `getClientId()` helper supporting X-Client-ID header and CF-Connecting-IP
- Added `rateLimitHeaders()` for standard rate limit response headers

#### Input Validation (`lib/validation.ts`)
- Added `jsonSchemaToZod()` to convert tool JSON schemas to Zod validators
- Added `validateArgs()` to validate tool arguments before execution
- Added common schemas: `tokenType`, `cfId`, `expiresIn`, `ipCidr`, `tokenName`, `templateId`
- Added helper functions: `validateTokenType()`, `validateCfId()`, `validateOptionalCfId()`
- All tool inputs are now validated against their declared schemas

#### Shared Expiration Parsing (`lib/expiration.ts`)
- Extracted `parseExpiresIn()` function (was duplicated in tools.ts and cloudflare-client.ts)
- Added validation for reasonable limits (max 1 year for hours/days, 10 years max)
- Added `isValidExpirationFormat()` for format validation without parsing
- Added `formatExpiration()` for human-readable expiration display
- Invalid expiration formats now throw `ValidationError` instead of being silently ignored

#### Test Suite
- Added vitest with @cloudflare/vitest-pool-workers for Workers-compatible testing
- Added 116 unit tests across 6 test files:
  - `errors.test.ts` - 23 tests for error types and categorization
  - `expiration.test.ts` - 17 tests for expiration parsing
  - `rate-limit.test.ts` - 12 tests for rate limiting behavior
  - `tools.test.ts` - 12 tests for tool definitions and schemas
  - `tracing.test.ts` - 18 tests for correlation IDs and logging
  - `validation.test.ts` - 34 tests for schema conversion and validation

### Changed

#### API Response Improvements
- Removed emoji from token creation warning message
  - Before: `⚠️ Save this secret now - it will not be shown again!`
  - After: `IMPORTANT: Save this secret now - it will not be shown again!`
- All error responses now include `correlationId` in the `data` field
- Rate limit errors now include `retryAfter` seconds in response

#### HTTP Status Codes
- Changed "Bootstrap token not configured" from 500 to 503 (Service Unavailable)
- Health check now returns 503 with `status: "degraded"` when bootstrap token fails verification

#### Cloudflare Client (`cloudflare-client.ts`)
- Added 30-second request timeout using AbortController
- Permission groups cache now expires after 5 minutes (was infinite)
- Missing permissions during template resolution now throw errors (was console.warn)
- Uses shared `parseExpiresIn()` instead of inline parsing

#### Health Check Endpoint
- Now verifies bootstrap token works by calling `listAccounts()`
- Returns `{ status: "ok" }` on success
- Returns `{ status: "degraded", error: "..." }` with 503 on failure

### Fixed

- Rate limiting now works correctly across multiple worker instances
- Invalid tool arguments are now rejected with clear validation errors
- Invalid expiration formats now fail fast with descriptive errors
- Permission cache no longer grows unbounded in long-running workers
- Requests no longer hang indefinitely on slow Cloudflare API responses

### Dependencies

#### Added
- `zod@^3.22.0` - Runtime type validation
- `vitest@~2.0.0` - Test framework (devDependency)
- `@cloudflare/vitest-pool-workers@^0.5.0` - Workers test pool (devDependency)

### Configuration

#### wrangler.toml
- Added `nodejs_compat` compatibility flag (required for vitest)
- Added `RATE_LIMIT_KV` KV namespace binding for rate limiting

#### package.json
- Added `test` script: `vitest run`
- Added `test:watch` script: `vitest`

### Migration Notes

1. **Create KV Namespace**: Run `wrangler kv:namespace create RATE_LIMIT_KV` and update the ID in wrangler.toml
2. **Rate Limiting**: Existing in-memory rate limits will reset; KV-backed limits start fresh
3. **Error Handling**: Clients should handle new error response format with `correlationId`
4. **Emoji Removal**: Update any client-side parsing that relied on the emoji character
