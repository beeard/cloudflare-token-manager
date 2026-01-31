/**
 * Token Templates
 *
 * Permission group IDs are fetched dynamically via the API.
 * These templates use human-readable keys that get resolved to IDs.
 */

export interface TokenTemplate {
  id: string;
  name: string;
  description: string;
  permissions: TemplatePermission[];
  resourceScope: 'all_accounts' | 'specific_account' | 'all_zones' | 'specific_zone';
}

export interface TemplatePermission {
  // Human-readable name to match against permission groups
  name: string;
  // Fallback patterns if exact match not found
  patterns?: string[];
}

export const TEMPLATES: TokenTemplate[] = [
  {
    id: 'full_access',
    name: 'Full Access',
    description: 'Complete read/write access to all account and zone resources',
    resourceScope: 'all_accounts',
    permissions: [
      // Account-level
      { name: 'Account Settings Write', patterns: ['Account Settings:Edit'] },
      { name: 'Workers Scripts Write', patterns: ['Workers Scripts:Edit', 'Worker Scripts:Edit'] },
      { name: 'Workers KV Storage Write', patterns: ['Workers KV Storage:Edit'] },
      { name: 'Workers R2 Storage Write', patterns: ['Workers R2 Storage:Edit', 'R2:Edit'] },
      { name: 'D1 Write', patterns: ['D1:Edit'] },
      { name: 'Durable Objects Write', patterns: ['Durable Objects:Edit'] },
      { name: 'Queues Write', patterns: ['Queues:Edit'] },
      { name: 'Pages Write', patterns: ['Cloudflare Pages:Edit'] },
      { name: 'Images Write', patterns: ['Cloudflare Images:Edit'] },
      { name: 'Stream Write', patterns: ['Cloudflare Stream:Edit'] },
      // Zone-level
      { name: 'Zone Settings Write', patterns: ['Zone Settings:Edit'] },
      { name: 'DNS Write', patterns: ['DNS:Edit'] },
      { name: 'SSL and Certificates Write', patterns: ['SSL and Certificates:Edit'] },
      { name: 'Firewall Services Write', patterns: ['Firewall Services:Edit'] },
      { name: 'Cache Purge', patterns: ['Cache Purge:Purge'] },
      { name: 'Zone Write', patterns: ['Zone:Edit'] },
    ],
  },
  {
    id: 'workers_deploy',
    name: 'Workers Deploy',
    description: 'Deploy Workers, KV, R2, D1, Queues, Durable Objects',
    resourceScope: 'all_accounts',
    permissions: [
      { name: 'Workers Scripts Write', patterns: ['Workers Scripts:Edit'] },
      { name: 'Workers Routes Write', patterns: ['Workers Routes:Edit'] },
      { name: 'Workers KV Storage Write', patterns: ['Workers KV Storage:Edit'] },
      { name: 'Workers R2 Storage Write', patterns: ['Workers R2 Storage:Edit', 'R2:Edit'] },
      { name: 'D1 Write', patterns: ['D1:Edit'] },
      { name: 'Durable Objects Write', patterns: ['Durable Objects:Edit'] },
      { name: 'Queues Write', patterns: ['Queues:Edit'] },
      { name: 'Vectorize Write', patterns: ['Vectorize:Edit'] },
      { name: 'Workers AI Write', patterns: ['Workers AI:Edit', 'AI:Edit'] },
    ],
  },
  {
    id: 'pages_deploy',
    name: 'Pages Deploy',
    description: 'Deploy Cloudflare Pages projects',
    resourceScope: 'all_accounts',
    permissions: [
      { name: 'Cloudflare Pages Write', patterns: ['Cloudflare Pages:Edit', 'Pages:Edit'] },
    ],
  },
  {
    id: 'dns_only',
    name: 'DNS Only',
    description: 'DNS record management only',
    resourceScope: 'all_zones',
    permissions: [
      { name: 'DNS Write', patterns: ['DNS:Edit'] },
    ],
  },
  {
    id: 'dns_read',
    name: 'DNS Read',
    description: 'DNS record read-only access',
    resourceScope: 'all_zones',
    permissions: [
      { name: 'DNS Read', patterns: ['DNS:Read'] },
    ],
  },
  {
    id: 'cache_purge',
    name: 'Cache Purge',
    description: 'Cache purge only (for CDN invalidation)',
    resourceScope: 'all_zones',
    permissions: [
      { name: 'Cache Purge', patterns: ['Cache Purge:Purge'] },
    ],
  },
  {
    id: 'analytics_read',
    name: 'Analytics Read',
    description: 'Read-only analytics access',
    resourceScope: 'all_accounts',
    permissions: [
      { name: 'Analytics Read', patterns: ['Analytics:Read', 'Account Analytics:Read'] },
      { name: 'Zone Analytics Read', patterns: ['Zone Analytics:Read'] },
    ],
  },
  {
    id: 'api_tokens_manage',
    name: 'API Tokens Manage',
    description: 'Create and manage API tokens (bootstrap token)',
    resourceScope: 'all_accounts',
    permissions: [
      { name: 'API Tokens Write', patterns: ['API Tokens:Edit'] },
    ],
  },
  {
    id: 'zero_trust_admin',
    name: 'Zero Trust Admin',
    description: 'Full access to Zero Trust / Access settings',
    resourceScope: 'all_accounts',
    permissions: [
      { name: 'Access: Organizations, Identity Providers, and Groups Write', patterns: ['Access:Edit'] },
      { name: 'Access: Apps and Policies Write', patterns: ['Access: Apps and Policies:Edit'] },
      { name: 'Zero Trust Write', patterns: ['Zero Trust:Edit'] },
    ],
  },
  {
    id: 'waf_admin',
    name: 'WAF Admin',
    description: 'Manage WAF rules and security settings',
    resourceScope: 'all_zones',
    permissions: [
      { name: 'Firewall Services Write', patterns: ['Firewall Services:Edit'] },
      { name: 'WAF Write', patterns: ['WAF:Edit'] },
      { name: 'Zone WAF Write', patterns: ['Zone WAF:Edit'] },
    ],
  },
];

export function getTemplate(id: string): TokenTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function listTemplates(): TokenTemplate[] {
  return TEMPLATES;
}
