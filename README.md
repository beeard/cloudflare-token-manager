# Cloudflare Token Manager

MCP server for programmatic Cloudflare API token management.

## Setup

### 1. Install Dependencies

```bash
cd workers/cloudflare-token-manager
pnpm install
```

### 2. Create Bootstrap Token

You need a "bootstrap" token with permission to create other tokens:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Create Token → **Create Custom Token**
3. Name: `Token Manager Bootstrap`
4. Permissions: **User** → **API Tokens** → **Edit**
5. (Recommended) Add IP restrictions and expiration
6. Create Token and copy the value

### 3. Configure Secrets

```bash
# Bootstrap token for creating other tokens
pnpm exec wrangler secret put CLOUDFLARE_BOOTSTRAP_TOKEN

# API key for MCP authentication
openssl rand -base64 32  # Generate a key
pnpm exec wrangler secret put MCP_API_KEY
```

### 4. Deploy

```bash
export CLOUDFLARE_API_TOKEN=$(grep CLOUDFLARE_API_TOKEN ../../.env.local | cut -d'=' -f2)
pnpm exec wrangler deploy
```

## Usage

### Claude Code CLI

Add the MCP server using the CLI:

```bash
# Add remote MCP server with authentication header
claude mcp add cloudflare-tokens \
  --transport http \
  --url "https://cloudflare-token-manager.<subdomain>.workers.dev/mcp" \
  --header "X-API-Key: your-mcp-api-key"

or 

claude mcp add cloudflare-tokens \
  --transport http \
  --url "https://cloudflare-token-manager.<subdomain>.workers.dev/mcp" \
  --header "X-API-Key: $MCP_API_KEY"

# Verify it was added
claude mcp list

# Remove if needed
claude mcp remove cloudflare-tokens
```

For local development:

```bash
claude mcp add cloudflare-tokens-dev \
  --transport http \
  --url "http://localhost:8787/mcp" \
  --header "X-API-Key: test-key"
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "cloudflare-tokens": {
      "url": "https://cloudflare-token-manager.<subdomain>.workers.dev/mcp",
      "headers": {
        "X-API-Key": "your-mcp-api-key"
      }
    }
  }
}
```

### Using mcp-remote (for clients without native HTTP support)

```json
{
  "mcpServers": {
    "cloudflare-tokens": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://cloudflare-token-manager.<subdomain>.workers.dev/mcp",
        "--header",
        "X-API-Key: your-mcp-api-key"
      ]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_permission_groups` | List all available permission groups |
| `list_templates` | List preset token templates |
| `get_template` | Get template details with resolved permissions |
| `list_tokens` | List user or account tokens |
| `get_token` | Get token details |
| `create_token` | Create token from template or custom permissions |
| `revoke_token` | Delete/revoke a token |
| `verify_token` | Check if a token is valid |
| `rotate_token` | Create new token with same permissions |
| `list_accounts` | List accessible Cloudflare accounts |
| `get_account` | Get account details |

### Token Templates

| Template | Description |
|----------|-------------|
| `full_access` | All account and zone permissions |
| `workers_deploy` | Workers, KV, R2, D1, Queues, Vectorize |
| `pages_deploy` | Cloudflare Pages only |
| `dns_only` | DNS record management |
| `dns_read` | DNS read-only |
| `cache_purge` | Cache purge only |
| `analytics_read` | Analytics read-only |
| `api_tokens_manage` | Create/manage API tokens |
| `zero_trust_admin` | Zero Trust settings |
| `waf_admin` | WAF rules |

### Example: Create Full Access Token

```bash
curl -X POST https://cloudflare-token-manager.<account>.workers.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_token",
      "arguments": {
        "type": "user",
        "name": "CI/CD Full Access",
        "template": "full_access",
        "expiresIn": "90d"
      }
    }
  }'
```

### Example: Create Workers-Only Token

```bash
curl -X POST https://cloudflare-token-manager.<account>.workers.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_token",
      "arguments": {
        "type": "account",
        "accountId": "your-account-id",
        "name": "Workers Deploy",
        "template": "workers_deploy",
        "expiresIn": "30d",
        "ipAllow": ["192.0.2.0/24"]
      }
    }
  }'
```

### Example: List Permission Groups

```bash
curl -X POST https://cloudflare-token-manager.<account>.workers.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_permission_groups",
      "arguments": {
        "filter": "workers"
      }
    }
  }'
```

### Example: Rotate Token

```bash
curl -X POST https://cloudflare-token-manager.<account>.workers.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "rotate_token",
      "arguments": {
        "type": "user",
        "tokenId": "abc123...",
        "revokeOld": true,
        "newName": "CI/CD Token v2"
      }
    }
  }'
```

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/health` | GET | Health check (verifies bootstrap token) |
| `/templates` | GET | List available token templates (public) |

### Response Headers

All responses include:
- `X-Correlation-ID` - Request tracking ID for debugging

Rate-limited responses (HTTP 429) include:
- `X-RateLimit-Remaining` - Requests remaining in window
- `X-RateLimit-Reset` - Unix timestamp when window resets

## Security Notes

1. **Bootstrap Token Security**: The bootstrap token can create tokens with any permissions. Protect it carefully:
   - Use IP restrictions
   - Set short TTL
   - Monitor usage via Cloudflare audit logs

2. **Permission Escalation**: Cloudflare prevents creating tokens with more permissions than the bootstrap token has.

3. **Account Restrictions**: Set `ALLOWED_ACCOUNT_IDS` environment variable to restrict which accounts can be managed.

4. **Token Secrets**: Token secrets are only shown once on creation. The MCP response includes a warning about this.

5. **Rate Limiting**: Token creation/revocation/rotation is rate-limited per client IP (default: 10/minute). Returns HTTP 429 when exceeded.

6. **Audit Logging**: Enable structured audit logs for compliance.

7. **Input Validation**: All tool arguments are validated against JSON schemas using Zod. IP CIDR ranges are validated before being sent to Cloudflare.

8. **Timing-Safe Auth**: API key comparison uses constant-time comparison to prevent timing attacks.

## Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_ACCOUNT_IDS` | Comma-separated account IDs to restrict access | (none - all allowed) |
| `RATE_LIMIT_PER_MINUTE` | Max token operations per IP per minute | `10` |
| `ENABLE_AUDIT_LOG` | Set to `"true"` to enable structured audit logging | `false` |

### Audit Log Format

When `ENABLE_AUDIT_LOG=true`, operations are logged as structured JSON:

```json
{
  "level": "info",
  "type": "audit",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "operation": "create_token",
  "tokenType": "user",
  "tokenName": "CI/CD Token",
  "success": true,
  "clientIp": "192.0.2.1"
}
```

View logs in Cloudflare Dashboard → Workers → Logs, or use `wrangler tail`.

## Development

```bash
pnpm dev  # Start local server on port 8787
```

Test locally:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "X-API-Key: test-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Testing

```bash
pnpm test        # Run all tests
pnpm test:watch  # Run tests in watch mode
```

Test suite includes 124 tests covering:
- Error categorization and handling
- Expiration parsing and validation
- Rate limiting (KV and in-memory fallback)
- Tool schema definitions
- Request tracing and correlation IDs
- Input validation and schema conversion
