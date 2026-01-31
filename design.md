# Cloudflare Token Manager

MCP server for programmatic Cloudflare API token management.

## Use Cases

1. **CI/CD Provisioning** - Create scoped tokens for deployment pipelines
2. **Developer Onboarding** - Generate tokens with preset permission templates
3. **Token Rotation** - Automated token refresh before expiration
4. **Audit** - List and revoke tokens programmatically

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              cloudflare-token-manager (Worker)              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  MCP Protocol Handler (JSON-RPC 2.0)                │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ Token Tools  │ │ Permission   │ │ Template Tools   │    │
│  │              │ │ Tools        │ │                  │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare API                           │
│  /user/tokens    /accounts/{id}/tokens    /permission_groups│
└─────────────────────────────────────────────────────────────┘
```

## MCP Tools

### Token Management

| Tool | Description |
|------|-------------|
| `list_tokens` | List all tokens (user or account) |
| `get_token` | Get token details by ID |
| `create_token` | Create token with custom policies |
| `create_token_from_template` | Create token from preset template |
| `rotate_token` | Create new token, return both values, optionally revoke old |
| `revoke_token` | Delete/revoke a token |
| `verify_token` | Check if token is valid and get its permissions |

### Permission Discovery

| Tool | Description |
|------|-------------|
| `list_permission_groups` | List all available permission groups |
| `search_permissions` | Search permissions by name/description |
| `get_permission_details` | Get full details of a permission group |

### Templates

| Tool | Description |
|------|-------------|
| `list_templates` | List available token templates |
| `get_template` | Get template details with permissions |

## Preset Templates

### `full_access`
All account and zone permissions with edit access.

```json
{
  "name": "Full Access",
  "policies": [
    {
      "effect": "allow",
      "permission_groups": [
        { "id": "ACCOUNT_SETTINGS_WRITE" },
        { "id": "WORKERS_WRITE" },
        { "id": "R2_WRITE" },
        { "id": "D1_WRITE" },
        { "id": "KV_WRITE" },
        { "id": "ZONE_SETTINGS_WRITE" },
        { "id": "DNS_WRITE" },
        { "id": "SSL_WRITE" },
        { "id": "FIREWALL_WRITE" },
        { "id": "CACHE_PURGE" }
      ],
      "resources": {
        "com.cloudflare.api.account.*": "*",
        "com.cloudflare.api.account.zone.*": "*"
      }
    }
  ]
}
```

### `workers_deploy`
Deploy Workers, KV, R2, D1, Queues.

```json
{
  "name": "Workers Deploy",
  "policies": [
    {
      "effect": "allow",
      "permission_groups": [
        { "id": "WORKERS_SCRIPTS_WRITE" },
        { "id": "WORKERS_ROUTES_WRITE" },
        { "id": "WORKERS_KV_WRITE" },
        { "id": "WORKERS_R2_WRITE" },
        { "id": "WORKERS_D1_WRITE" },
        { "id": "WORKERS_QUEUES_WRITE" },
        { "id": "WORKERS_DURABLE_OBJECTS_WRITE" }
      ],
      "resources": {
        "com.cloudflare.api.account.*": "*"
      }
    }
  ]
}
```

### `dns_only`
DNS record management only.

### `cache_purge`
Cache purge only (for CDN invalidation).

### `analytics_read`
Read-only analytics access.

## API Design

### Create Token

```typescript
interface CreateTokenRequest {
  // Token type
  type: 'user' | 'account';
  accountId?: string; // Required for account tokens

  // Token identity
  name: string;

  // Permissions (one of these)
  template?: string; // Use preset template
  policies?: Policy[]; // Custom policies

  // Restrictions
  expiresIn?: string; // "30d", "1y", "never"
  notBefore?: string; // ISO 8601
  ipFilter?: {
    allow?: string[]; // CIDR ranges
    deny?: string[];
  };
}

interface Policy {
  effect: 'allow' | 'deny';
  permissionGroups: string[]; // Permission group IDs
  resources: Record<string, string>;
}

interface CreateTokenResponse {
  id: string;
  name: string;
  value: string; // The secret - only returned once!
  status: 'active' | 'disabled' | 'expired';
  issuedOn: string;
  expiresOn?: string;
  policies: ResolvedPolicy[];
}
```

### Rotate Token

```typescript
interface RotateTokenRequest {
  tokenId: string;
  revokeOld?: boolean; // Default: false (grace period)
  gracePeriodHours?: number; // Keep old token valid for X hours
}

interface RotateTokenResponse {
  oldToken: { id: string; status: string };
  newToken: CreateTokenResponse;
}
```

## Security Considerations

### Bootstrap Token
The MCP server needs a "Token Creator" token with `User > API Tokens > Edit` permission. This bootstrap token should be:
- Stored as a Worker secret
- IP-restricted to the Worker's egress IPs (if possible)
- Short TTL with automated rotation

### Audit Logging
All token operations should be logged:
- Token created (who, what permissions, expiry)
- Token revoked (who, reason)
- Token used (via Cloudflare's audit logs)

### Permission Escalation Prevention
The server cannot create tokens with more permissions than the bootstrap token has. Cloudflare enforces this at the API level.

## Implementation Plan

### Phase 1: Core Token Operations
1. `list_tokens`
2. `create_token` with custom policies
3. `revoke_token`
4. `verify_token`

### Phase 2: Templates
1. Define permission group ID mappings
2. Implement preset templates
3. `create_token_from_template`

### Phase 3: Advanced
1. Token rotation
2. Expiration monitoring
3. Batch operations

## Environment Variables

```toml
[vars]
# No sensitive vars here

[secrets]
# Bootstrap token with API Tokens Edit permission
CLOUDFLARE_BOOTSTRAP_TOKEN = "..."

# Optional: restrict to specific accounts
ALLOWED_ACCOUNT_IDS = "account1,account2"
```

## Endpoints

```
POST /mcp                    # MCP JSON-RPC handler
GET  /health                 # Health check
GET  /templates              # List available templates (public)
```

## Usage Example

### Create Full Access Token via MCP

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_token_from_template",
    "arguments": {
      "type": "account",
      "accountId": "abc123",
      "name": "CI/CD Deploy Token",
      "template": "full_access",
      "expiresIn": "90d",
      "ipFilter": {
        "allow": ["192.0.2.0/24"]
      }
    }
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "Token created successfully.\n\nID: tok_abc123\nName: CI/CD Deploy Token\nExpires: 2026-05-01T00:00:00Z\n\n⚠️ SECRET (save now, shown only once):\nxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\nPermissions:\n- Workers Scripts (Edit)\n- Workers KV (Edit)\n- R2 (Edit)\n- D1 (Edit)\n..."
    }]
  }
}
```
