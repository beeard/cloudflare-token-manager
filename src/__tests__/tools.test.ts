import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOLS } from '../tools';

// Mock the CloudflareClient
vi.mock('../cloudflare-client', () => ({
  CloudflareClient: vi.fn().mockImplementation(() => ({
    listPermissionGroups: vi.fn().mockResolvedValue([
      { id: 'perm-1', name: 'DNS Write', scopes: ['zone'] },
      { id: 'perm-2', name: 'Workers Scripts Write', scopes: ['account'] },
    ]),
    listAccounts: vi.fn().mockResolvedValue({
      accounts: [
        { id: 'acc-1', name: 'Test Account', type: 'standard' },
      ],
      total: 1,
    }),
    listUserTokens: vi.fn().mockResolvedValue({
      tokens: [
        {
          id: 'token-1',
          name: 'Test Token',
          status: 'active',
          issued_on: '2024-01-01T00:00:00Z',
          policies: [],
        },
      ],
      total: 1,
    }),
  })),
}));

describe('TOOLS', () => {
  it('exports an array of tools', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it('each tool has required properties', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('includes expected tools', () => {
    const toolNames = TOOLS.map(t => t.name);
    expect(toolNames).toContain('list_permission_groups');
    expect(toolNames).toContain('list_templates');
    expect(toolNames).toContain('list_tokens');
    expect(toolNames).toContain('create_token');
    expect(toolNames).toContain('revoke_token');
    expect(toolNames).toContain('rotate_token');
    expect(toolNames).toContain('verify_token');
    expect(toolNames).toContain('list_accounts');
  });

  describe('tool schemas', () => {
    it('list_tokens requires type', () => {
      const tool = TOOLS.find(t => t.name === 'list_tokens');
      expect(tool?.inputSchema.required).toContain('type');
    });

    it('create_token requires type and name', () => {
      const tool = TOOLS.find(t => t.name === 'create_token');
      expect(tool?.inputSchema.required).toContain('type');
      expect(tool?.inputSchema.required).toContain('name');
    });

    it('revoke_token requires type and tokenId', () => {
      const tool = TOOLS.find(t => t.name === 'revoke_token');
      expect(tool?.inputSchema.required).toContain('type');
      expect(tool?.inputSchema.required).toContain('tokenId');
    });

    it('verify_token requires token', () => {
      const tool = TOOLS.find(t => t.name === 'verify_token');
      expect(tool?.inputSchema.required).toContain('token');
    });

    it('get_template requires templateId', () => {
      const tool = TOOLS.find(t => t.name === 'get_template');
      expect(tool?.inputSchema.required).toContain('templateId');
    });
  });
});

describe('tool input schemas', () => {
  it('create_token has expiresIn property', () => {
    const tool = TOOLS.find(t => t.name === 'create_token');
    expect(tool?.inputSchema.properties.expiresIn).toBeDefined();
  });

  it('create_token has ipAllow and ipDeny properties', () => {
    const tool = TOOLS.find(t => t.name === 'create_token');
    expect(tool?.inputSchema.properties.ipAllow).toBeDefined();
    expect(tool?.inputSchema.properties.ipDeny).toBeDefined();
  });

  it('list_tokens has pagination properties', () => {
    const tool = TOOLS.find(t => t.name === 'list_tokens');
    expect(tool?.inputSchema.properties.page).toBeDefined();
    expect(tool?.inputSchema.properties.perPage).toBeDefined();
  });

  it('type property uses enum for token type', () => {
    const tool = TOOLS.find(t => t.name === 'list_tokens');
    const typeProperty = tool?.inputSchema.properties.type as Record<string, unknown>;
    expect(typeProperty?.enum).toEqual(['user', 'account']);
  });
});
