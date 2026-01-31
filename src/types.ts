// Environment bindings
export interface Env {
  CLOUDFLARE_BOOTSTRAP_TOKEN: string;
  MCP_API_KEY: string;
  ALLOWED_ACCOUNT_IDS?: string; // Comma-separated list
  RATE_LIMIT_PER_MINUTE?: string; // Max token operations per minute (default: 10)
  ENABLE_AUDIT_LOG?: string; // "true" to enable audit logging
  RATE_LIMIT_KV?: KVNamespace; // KV namespace for rate limiting
}

// Audit log entry
export interface AuditLogEntry {
  timestamp: string;
  operation: string;
  tokenType?: 'user' | 'account';
  accountId?: string;
  tokenId?: string;
  tokenName?: string;
  success: boolean;
  error?: string;
  clientIp?: string;
}

// Account info
export interface Account {
  id: string;
  name: string;
  type: string;
  settings?: {
    enforce_twofactor?: boolean;
    access_approval_expiry?: string;
  };
}

// Cloudflare API Types
export interface PermissionGroup {
  id: string;
  name: string;
  description?: string;
  scopes: string[];
}

export interface Policy {
  id?: string;
  effect: 'allow' | 'deny';
  permission_groups: Array<{
    id: string;
    name?: string;
    meta?: Record<string, unknown>;
  }>;
  resources: Record<string, string>;
}

export interface TokenCondition {
  request_ip?: {
    in?: string[];
    not_in?: string[];
  };
}

export interface Token {
  id: string;
  name: string;
  status: 'active' | 'disabled' | 'expired';
  issued_on: string;
  modified_on: string;
  expires_on?: string;
  not_before?: string;
  policies: Policy[];
  condition?: TokenCondition;
  value?: string; // Only on create
}

export interface CloudflareResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
  };
}

// MCP Types
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Token Creation Types
export interface CreateTokenParams {
  type: 'user' | 'account';
  accountId?: string;
  name: string;
  template?: string;
  policies?: Array<{
    effect: 'allow' | 'deny';
    permissionGroups: string[];
    resources: Record<string, string>;
  }>;
  expiresIn?: string; // "30d", "90d", "1y", "never"
  notBefore?: string; // ISO 8601
  ipFilter?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface ListTokensParams {
  type: 'user' | 'account';
  accountId?: string;
  page?: number;
  perPage?: number;
}

export interface RevokeTokenParams {
  type: 'user' | 'account';
  accountId?: string;
  tokenId: string;
}

export interface VerifyTokenParams {
  token: string;
}

export interface RotateTokenParams {
  type: 'user' | 'account';
  accountId?: string;
  tokenId: string;
  revokeOld?: boolean;
}
