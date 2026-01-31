import type {
  CloudflareResponse,
  PermissionGroup,
  Token,
  Policy,
  TokenCondition,
  Account,
} from './types';
import { getTemplate, type TokenTemplate, type TemplatePermission } from './templates';
import { CloudflareApiError, TimeoutError } from './lib/errors';
import { parseExpiresIn } from './lib/expiration';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level cache shared across all CloudflareClient instances within a worker isolate
let permissionGroupsCache: { data: PermissionGroup[]; expiresAt: number } | null = null;

export class CloudflareClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<CloudflareResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${CF_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = (await response.json()) as CloudflareResponse<T>;

      if (!data.success) {
        throw new CloudflareApiError(
          `Cloudflare API error: ${data.errors.map(e => e.message).join(', ')}`,
          {
            statusCode: response.status,
            cfErrors: data.errors,
          }
        );
      }

      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TimeoutError(`Cloudflare API request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Permission Groups

  async listPermissionGroups(): Promise<PermissionGroup[]> {
    const now = Date.now();

    // Check module-level cache with TTL (shared across instances within isolate)
    if (permissionGroupsCache && now < permissionGroupsCache.expiresAt) {
      return permissionGroupsCache.data;
    }

    const response = await this.request<PermissionGroup[]>(
      'GET',
      '/user/tokens/permission_groups'
    );

    // Update module-level cache
    permissionGroupsCache = {
      data: response.result,
      expiresAt: now + PERMISSION_CACHE_TTL_MS,
    };

    return response.result;
  }

  async findPermissionGroup(nameOrPattern: string): Promise<PermissionGroup | undefined> {
    const groups = await this.listPermissionGroups();
    const lowerName = nameOrPattern.toLowerCase();

    // Exact match first
    let match = groups.find(g => g.name.toLowerCase() === lowerName);
    if (match) return match;

    // Partial match
    match = groups.find(g => g.name.toLowerCase().includes(lowerName));
    if (match) return match;

    // Description match
    match = groups.find(g => g.description?.toLowerCase().includes(lowerName));
    return match;
  }

  async resolvePermissionGroups(
    permissions: TemplatePermission[]
  ): Promise<Array<{ id: string; name: string }>> {
    const groups = await this.listPermissionGroups();
    const resolved: Array<{ id: string; name: string }> = [];

    for (const perm of permissions) {
      const lowerName = perm.name.toLowerCase();
      let match = groups.find(g => g.name.toLowerCase() === lowerName);

      if (!match && perm.patterns) {
        for (const pattern of perm.patterns) {
          const lowerPattern = pattern.toLowerCase();
          match = groups.find(g => g.name.toLowerCase().includes(lowerPattern));
          if (match) break;
        }
      }

      if (!match) {
        // Try fuzzy match on words
        const words = lowerName.split(/\s+/);
        match = groups.find(g => {
          const gLower = g.name.toLowerCase();
          return words.every(w => gLower.includes(w));
        });
      }

      if (match) {
        resolved.push({ id: match.id, name: match.name });
      } else {
        throw new Error(`Required permission not found: ${perm.name}`);
      }
    }

    return resolved;
  }

  // User Tokens

  async listUserTokens(page = 1, perPage = 50): Promise<{ tokens: Token[]; total: number }> {
    const response = await this.request<Token[]>(
      'GET',
      `/user/tokens?page=${page}&per_page=${perPage}`
    );

    return {
      tokens: response.result,
      total: response.result_info?.total_count ?? response.result.length,
    };
  }

  async getUserToken(tokenId: string): Promise<Token> {
    const response = await this.request<Token>('GET', `/user/tokens/${tokenId}`);
    return response.result;
  }

  async createUserToken(params: {
    name: string;
    policies: Policy[];
    expiresOn?: string;
    notBefore?: string;
    condition?: TokenCondition;
  }): Promise<Token> {
    const body: Record<string, unknown> = {
      name: params.name,
      policies: params.policies,
    };

    if (params.expiresOn) body.expires_on = params.expiresOn;
    if (params.notBefore) body.not_before = params.notBefore;
    if (params.condition) body.condition = params.condition;

    const response = await this.request<Token>('POST', '/user/tokens', body);
    return response.result;
  }

  async revokeUserToken(tokenId: string): Promise<void> {
    await this.request('DELETE', `/user/tokens/${tokenId}`);
  }

  // Account Tokens

  async listAccountTokens(
    accountId: string,
    page = 1,
    perPage = 50
  ): Promise<{ tokens: Token[]; total: number }> {
    const response = await this.request<Token[]>(
      'GET',
      `/accounts/${accountId}/tokens?page=${page}&per_page=${perPage}`
    );

    return {
      tokens: response.result,
      total: response.result_info?.total_count ?? response.result.length,
    };
  }

  async getAccountToken(accountId: string, tokenId: string): Promise<Token> {
    const response = await this.request<Token>(
      'GET',
      `/accounts/${accountId}/tokens/${tokenId}`
    );
    return response.result;
  }

  async createAccountToken(
    accountId: string,
    params: {
      name: string;
      policies: Policy[];
      expiresOn?: string;
      notBefore?: string;
      condition?: TokenCondition;
    }
  ): Promise<Token> {
    const body: Record<string, unknown> = {
      name: params.name,
      policies: params.policies,
    };

    if (params.expiresOn) body.expires_on = params.expiresOn;
    if (params.notBefore) body.not_before = params.notBefore;
    if (params.condition) body.condition = params.condition;

    const response = await this.request<Token>(
      'POST',
      `/accounts/${accountId}/tokens`,
      body
    );
    return response.result;
  }

  async revokeAccountToken(accountId: string, tokenId: string): Promise<void> {
    await this.request('DELETE', `/accounts/${accountId}/tokens/${tokenId}`);
  }

  // Token Verification

  async verifyToken(token: string): Promise<{
    valid: boolean;
    status?: string;
    expiresOn?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json()) as CloudflareResponse<{
        id: string;
        status: string;
        expires_on?: string;
      }>;

      if (data.success) {
        return {
          valid: true,
          status: data.result.status,
          expiresOn: data.result.expires_on,
        };
      }

      const errorMsg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
      console.warn('Token verification failed', { error: errorMsg, status: response.status });
      return { valid: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Token verification error', { error: errorMsg });
      return { valid: false, error: errorMsg };
    }
  }

  // Template-based Creation

  async createTokenFromTemplate(params: {
    type: 'user' | 'account';
    accountId?: string;
    name: string;
    templateId: string;
    expiresIn?: string;
    notBefore?: string;
    ipFilter?: { allow?: string[]; deny?: string[] };
  }): Promise<Token> {
    const template = getTemplate(params.templateId);
    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    // Resolve permission group IDs
    const resolvedGroups = await this.resolvePermissionGroups(template.permissions);
    if (resolvedGroups.length === 0) {
      throw new Error('No permission groups could be resolved from template');
    }

    // Build resources based on scope
    const resources: Record<string, string> = {};
    if (template.resourceScope === 'all_accounts' || template.resourceScope === 'specific_account') {
      if (params.type === 'account' && params.accountId) {
        resources[`com.cloudflare.api.account.${params.accountId}`] = '*';
      } else {
        resources['com.cloudflare.api.account.*'] = '*';
      }
    }
    if (template.resourceScope === 'all_zones' || template.resourceScope === 'specific_account') {
      resources['com.cloudflare.api.account.zone.*'] = '*';
    }

    // Build policy
    const policy: Policy = {
      effect: 'allow',
      permission_groups: resolvedGroups.map(g => ({ id: g.id })),
      resources,
    };

    // Parse expiration using shared utility
    const expiresOn = parseExpiresIn(params.expiresIn);

    // Build condition for IP filtering
    let condition: TokenCondition | undefined;
    if (params.ipFilter?.allow || params.ipFilter?.deny) {
      condition = {
        request_ip: {
          in: params.ipFilter.allow,
          not_in: params.ipFilter.deny,
        },
      };
    }

    // Create token
    if (params.type === 'account' && params.accountId) {
      return this.createAccountToken(params.accountId, {
        name: params.name,
        policies: [policy],
        expiresOn,
        notBefore: params.notBefore,
        condition,
      });
    } else {
      return this.createUserToken({
        name: params.name,
        policies: [policy],
        expiresOn,
        notBefore: params.notBefore,
        condition,
      });
    }
  }

  // Account Listing

  async listAccounts(page = 1, perPage = 50): Promise<{ accounts: Account[]; total: number }> {
    const response = await this.request<Account[]>(
      'GET',
      `/accounts?page=${page}&per_page=${perPage}`
    );
    return {
      accounts: response.result,
      total: response.result_info?.total_count ?? response.result.length,
    };
  }

  async getAccount(accountId: string): Promise<Account> {
    const response = await this.request<Account>('GET', `/accounts/${accountId}`);
    return response.result;
  }
}
