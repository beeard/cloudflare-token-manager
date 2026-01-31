import type { MCPTool, Env, AuditLogEntry } from './types';
import { CloudflareClient } from './cloudflare-client';
import { listTemplates, getTemplate } from './templates';
import { checkRateLimit, getClientId } from './lib/rate-limit';
import { validateArgs, validateIpCidrArray } from './lib/validation';
import { RateLimitError, ValidationError } from './lib/errors';
import { parseExpiresIn } from './lib/expiration';

// Audit logger
function auditLog(env: Env, entry: AuditLogEntry): void {
  if (env.ENABLE_AUDIT_LOG !== 'true') return;

  // Structured log for Cloudflare Workers logs
  console.log(
    JSON.stringify({
      level: entry.success ? 'info' : 'error',
      type: 'audit',
      ...entry,
    })
  );
}

// Rate-limited operations (mutating)
const RATE_LIMITED_TOOLS = new Set([
  'create_token',
  'revoke_token',
  'rotate_token',
]);

// Tool definitions
export const TOOLS: MCPTool[] = [
  {
    name: 'list_permission_groups',
    description: 'List all available Cloudflare API permission groups with their IDs and scopes',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional filter string to search permission names/descriptions',
        },
      },
    },
  },
  {
    name: 'list_templates',
    description: 'List available token templates (full_access, workers_deploy, dns_only, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_template',
    description: 'Get details of a specific token template',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'Template ID (e.g., "full_access", "workers_deploy")',
        },
      },
      required: ['templateId'],
    },
  },
  {
    name: 'list_tokens',
    description: 'List all API tokens (user or account)',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'account'],
          description: 'Token type',
        },
        accountId: {
          type: 'string',
          description: 'Account ID (required for account tokens)',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        perPage: {
          type: 'number',
          description: 'Results per page (default: 50)',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_token',
    description: 'Get details of a specific token',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'account'],
          description: 'Token type',
        },
        accountId: {
          type: 'string',
          description: 'Account ID (required for account tokens)',
        },
        tokenId: {
          type: 'string',
          description: 'Token ID to retrieve',
        },
      },
      required: ['type', 'tokenId'],
    },
  },
  {
    name: 'create_token',
    description:
      'Create a new API token with custom policies or from a template. Returns the token secret (shown only once!).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'account'],
          description: 'Token type',
        },
        accountId: {
          type: 'string',
          description: 'Account ID (required for account tokens)',
        },
        name: {
          type: 'string',
          description: 'Token name/identifier',
        },
        template: {
          type: 'string',
          description:
            'Template ID (e.g., "full_access", "workers_deploy"). Use list_templates to see options.',
        },
        permissionGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Custom permission group IDs (alternative to template). Use list_permission_groups to find IDs.',
        },
        resourceScope: {
          type: 'string',
          enum: ['all_accounts', 'specific_account', 'all_zones'],
          description: 'Resource scope (default: all_accounts)',
        },
        expiresIn: {
          type: 'string',
          description: 'Expiration period: "30d", "90d", "1y", "never" (default: never)',
        },
        ipAllow: {
          type: 'array',
          items: { type: 'string' },
          description: 'IP CIDR ranges to allow',
        },
        ipDeny: {
          type: 'array',
          items: { type: 'string' },
          description: 'IP CIDR ranges to deny',
        },
      },
      required: ['type', 'name'],
    },
  },
  {
    name: 'revoke_token',
    description: 'Revoke/delete an API token',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'account'],
          description: 'Token type',
        },
        accountId: {
          type: 'string',
          description: 'Account ID (required for account tokens)',
        },
        tokenId: {
          type: 'string',
          description: 'Token ID to revoke',
        },
      },
      required: ['type', 'tokenId'],
    },
  },
  {
    name: 'verify_token',
    description: 'Verify if a token is valid and check its status',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'The token value to verify',
        },
      },
      required: ['token'],
    },
  },
  {
    name: 'rotate_token',
    description:
      'Create a new token with the same permissions as an existing token, optionally revoking the old one',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['user', 'account'],
          description: 'Token type',
        },
        accountId: {
          type: 'string',
          description: 'Account ID (required for account tokens)',
        },
        tokenId: {
          type: 'string',
          description: 'Token ID to rotate',
        },
        revokeOld: {
          type: 'boolean',
          description: 'Whether to revoke the old token (default: false)',
        },
        newName: {
          type: 'string',
          description: 'Name for the new token (default: adds " (rotated)" suffix)',
        },
      },
      required: ['type', 'tokenId'],
    },
  },
  {
    name: 'list_accounts',
    description: 'List all Cloudflare accounts accessible with the current token',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_account',
    description: 'Get details of a specific Cloudflare account',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Account ID to retrieve',
        },
      },
      required: ['accountId'],
    },
  },
];

// Tool execution
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  clientIp?: string
): Promise<unknown> {
  // Find the tool definition
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) {
    throw new ValidationError(`Unknown tool: ${toolName}`);
  }

  // Validate arguments against the tool's schema
  const validatedArgs = validateArgs(toolName, args, tool.inputSchema);

  const client = new CloudflareClient(env.CLOUDFLARE_BOOTSTRAP_TOKEN);

  // Rate limit mutating operations using KV-backed limiter
  if (RATE_LIMITED_TOOLS.has(toolName) && clientIp) {
    const rateLimit = await checkRateLimit(env, 'token-ops', clientIp);
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      throw new RateLimitError(
        `Rate limit exceeded. Try again in ${retryAfter}s`,
        { retryAfter }
      );
    }
  }

  // Use validated args from here on
  args = validatedArgs;

  // Validate account access if restricted
  if (env.ALLOWED_ACCOUNT_IDS && args.accountId) {
    const allowed = env.ALLOWED_ACCOUNT_IDS.split(',').map(s => s.trim());
    if (!allowed.includes(args.accountId as string)) {
      auditLog(env, {
        timestamp: new Date().toISOString(),
        operation: toolName,
        accountId: args.accountId as string,
        success: false,
        error: 'Access denied: account not in allowed list',
        clientIp,
      });
      throw new Error('Access denied: account not in allowed list');
    }
  }

  // Helper to log and return
  const withAudit = async <T>(
    operation: string,
    fn: () => Promise<T>,
    meta?: Partial<AuditLogEntry>
  ): Promise<T> => {
    try {
      const result = await fn();
      auditLog(env, {
        timestamp: new Date().toISOString(),
        operation,
        success: true,
        clientIp,
        ...meta,
      });
      return result;
    } catch (error) {
      auditLog(env, {
        timestamp: new Date().toISOString(),
        operation,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        clientIp,
        ...meta,
      });
      throw error;
    }
  };

  switch (toolName) {
    case 'list_permission_groups': {
      const groups = await client.listPermissionGroups();
      const filter = args.filter as string | undefined;

      let filtered = groups;
      if (filter) {
        const lowerFilter = filter.toLowerCase();
        filtered = groups.filter(
          g =>
            g.name.toLowerCase().includes(lowerFilter) ||
            g.description?.toLowerCase().includes(lowerFilter)
        );
      }

      return {
        count: filtered.length,
        groups: filtered.map(g => ({
          id: g.id,
          name: g.name,
          description: g.description,
          scopes: g.scopes,
        })),
      };
    }

    case 'list_templates': {
      const templates = listTemplates();
      return {
        count: templates.length,
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          resourceScope: t.resourceScope,
          permissionCount: t.permissions.length,
        })),
      };
    }

    case 'get_template': {
      const template = getTemplate(args.templateId as string);
      if (!template) {
        throw new Error(`Template not found: ${args.templateId}`);
      }

      // Resolve permission IDs for display
      const resolvedGroups = await client.resolvePermissionGroups(template.permissions);

      return {
        ...template,
        resolvedPermissions: resolvedGroups,
      };
    }

    case 'list_tokens': {
      const type = args.type as 'user' | 'account';
      const page = (args.page as number) || 1;
      const perPage = (args.perPage as number) || 50;

      if (type === 'account') {
        if (!args.accountId) {
          throw new Error('accountId is required for account tokens');
        }
        return client.listAccountTokens(args.accountId as string, page, perPage);
      } else {
        return client.listUserTokens(page, perPage);
      }
    }

    case 'get_token': {
      const type = args.type as 'user' | 'account';
      const tokenId = args.tokenId as string;

      if (type === 'account') {
        if (!args.accountId) {
          throw new Error('accountId is required for account tokens');
        }
        return client.getAccountToken(args.accountId as string, tokenId);
      } else {
        return client.getUserToken(tokenId);
      }
    }

    case 'create_token': {
      const type = args.type as 'user' | 'account';
      const name = args.name as string;
      const template = args.template as string | undefined;
      const accountId = args.accountId as string | undefined;

      // Validate IP CIDR arrays before using them
      const ipAllow = validateIpCidrArray(args.ipAllow, 'ipAllow');
      const ipDeny = validateIpCidrArray(args.ipDeny, 'ipDeny');

      return withAudit(
        'create_token',
        async () => {
          if (template) {
            // Template-based creation
            const token = await client.createTokenFromTemplate({
              type,
              accountId,
              name,
              templateId: template,
              expiresIn: args.expiresIn as string | undefined,
              ipFilter: {
                allow: ipAllow,
                deny: ipDeny,
              },
            });
            return formatTokenResponse(token);
          }

          // Custom policy creation
          const permissionGroupIds = args.permissionGroupIds as string[] | undefined;
          if (!permissionGroupIds || permissionGroupIds.length === 0) {
            throw new Error('Either template or permissionGroupIds is required');
          }

          const resourceScope = (args.resourceScope as string) || 'all_accounts';
          const resources: Record<string, string> = {};

          if (resourceScope === 'all_accounts') {
            resources['com.cloudflare.api.account.*'] = '*';
          } else if (resourceScope === 'specific_account' && accountId) {
            resources[`com.cloudflare.api.account.${accountId}`] = '*';
          }
          if (resourceScope === 'all_zones') {
            resources['com.cloudflare.api.account.zone.*'] = '*';
          }

          const policy = {
            effect: 'allow' as const,
            permission_groups: permissionGroupIds.map(id => ({ id })),
            resources,
          };

          // Parse expiration using shared utility
          const expiresIn = args.expiresIn as string | undefined;
          const expiresOn = parseExpiresIn(expiresIn);

          // IP conditions
          let condition = undefined;
          if (ipAllow || ipDeny) {
            condition = {
              request_ip: {
                in: ipAllow,
                not_in: ipDeny,
              },
            };
          }

          let token;
          if (type === 'account') {
            if (!accountId) {
              throw new Error('accountId is required for account tokens');
            }
            token = await client.createAccountToken(accountId, {
              name,
              policies: [policy],
              expiresOn,
              condition,
            });
          } else {
            token = await client.createUserToken({
              name,
              policies: [policy],
              expiresOn,
              condition,
            });
          }

          return formatTokenResponse(token);
        },
        { tokenType: type, accountId, tokenName: name }
      );
    }

    case 'revoke_token': {
      const type = args.type as 'user' | 'account';
      const tokenId = args.tokenId as string;
      const accountId = args.accountId as string | undefined;

      return withAudit(
        'revoke_token',
        async () => {
          if (type === 'account') {
            if (!accountId) {
              throw new Error('accountId is required for account tokens');
            }
            await client.revokeAccountToken(accountId, tokenId);
          } else {
            await client.revokeUserToken(tokenId);
          }
          return { success: true, message: `Token ${tokenId} revoked` };
        },
        { tokenType: type, accountId, tokenId }
      );
    }

    case 'verify_token': {
      const token = args.token as string;
      return client.verifyToken(token);
    }

    case 'rotate_token': {
      const type = args.type as 'user' | 'account';
      const tokenId = args.tokenId as string;
      const revokeOld = args.revokeOld as boolean | undefined;
      const newName = args.newName as string | undefined;
      const accountId = args.accountId as string | undefined;

      return withAudit(
        'rotate_token',
        async () => {
          // Get existing token
          let existingToken;
          if (type === 'account') {
            if (!accountId) {
              throw new Error('accountId is required for account tokens');
            }
            existingToken = await client.getAccountToken(accountId, tokenId);
          } else {
            existingToken = await client.getUserToken(tokenId);
          }

          // Create new token with same policies
          const name = newName || `${existingToken.name} (rotated)`;
          let newToken;

          if (type === 'account' && accountId) {
            newToken = await client.createAccountToken(accountId, {
              name,
              policies: existingToken.policies,
              expiresOn: existingToken.expires_on,
              condition: existingToken.condition,
            });
          } else {
            newToken = await client.createUserToken({
              name,
              policies: existingToken.policies,
              expiresOn: existingToken.expires_on,
              condition: existingToken.condition,
            });
          }

          // Optionally revoke old token
          if (revokeOld) {
            if (type === 'account' && accountId) {
              await client.revokeAccountToken(accountId, tokenId);
            } else {
              await client.revokeUserToken(tokenId);
            }
          }

          return {
            oldToken: {
              id: existingToken.id,
              name: existingToken.name,
              revoked: revokeOld || false,
            },
            newToken: formatTokenResponse(newToken),
          };
        },
        { tokenType: type, accountId, tokenId }
      );
    }

    case 'list_accounts': {
      const result = await client.listAccounts();

      // Filter by allowed accounts if configured
      let accounts = result.accounts;
      if (env.ALLOWED_ACCOUNT_IDS) {
        const allowed = env.ALLOWED_ACCOUNT_IDS.split(',').map(s => s.trim());
        accounts = accounts.filter(a => allowed.includes(a.id));
      }

      return {
        count: accounts.length,
        accounts: accounts.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
        })),
      };
    }

    case 'get_account': {
      const accountId = args.accountId as string;

      // Check allowed accounts
      if (env.ALLOWED_ACCOUNT_IDS) {
        const allowed = env.ALLOWED_ACCOUNT_IDS.split(',').map(s => s.trim());
        if (!allowed.includes(accountId)) {
          throw new Error('Access denied: account not in allowed list');
        }
      }

      const account = await client.getAccount(accountId);
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        settings: account.settings,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function formatTokenResponse(token: import('./types').Token) {
  return {
    id: token.id,
    name: token.name,
    status: token.status,
    issuedOn: token.issued_on,
    expiresOn: token.expires_on,
    secret: token.value,
    warning: 'IMPORTANT: Save this secret now - it will not be shown again!',
    policies: token.policies.map(p => ({
      effect: p.effect,
      permissions: p.permission_groups.map(g => g.name || g.id),
      resources: Object.keys(p.resources),
    })),
  };
}
