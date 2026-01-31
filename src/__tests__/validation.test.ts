import { describe, it, expect } from 'vitest';
import {
  jsonSchemaToZod,
  validateArgs,
  schemas,
  validateTokenType,
  validateCfId,
  validateOptionalCfId,
  validateIpCidrArray,
} from '../lib/validation';
import { ValidationError } from '../lib/errors';

describe('jsonSchemaToZod', () => {
  it('converts string schema', () => {
    const schema = jsonSchemaToZod({ type: 'string' });
    expect(schema.parse('hello')).toBe('hello');
    expect(() => schema.parse(123)).toThrow();
  });

  it('converts string with minLength/maxLength', () => {
    const schema = jsonSchemaToZod({
      type: 'string',
      minLength: 2,
      maxLength: 5,
    });
    expect(schema.parse('abc')).toBe('abc');
    expect(() => schema.parse('a')).toThrow();
    expect(() => schema.parse('abcdef')).toThrow();
  });

  it('converts string with pattern', () => {
    const schema = jsonSchemaToZod({
      type: 'string',
      pattern: '^[a-z]+$',
    });
    expect(schema.parse('abc')).toBe('abc');
    expect(() => schema.parse('ABC')).toThrow();
  });

  it('converts enum schema', () => {
    const schema = jsonSchemaToZod({
      type: 'string',
      enum: ['user', 'account'],
    });
    expect(schema.parse('user')).toBe('user');
    expect(() => schema.parse('invalid')).toThrow();
  });

  it('converts number schema', () => {
    const schema = jsonSchemaToZod({ type: 'number' });
    expect(schema.parse(42)).toBe(42);
    expect(schema.parse(3.14)).toBe(3.14);
    expect(() => schema.parse('42')).toThrow();
  });

  it('converts integer schema', () => {
    const schema = jsonSchemaToZod({ type: 'integer' });
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse(3.14)).toThrow();
  });

  it('converts number with min/max', () => {
    const schema = jsonSchemaToZod({
      type: 'number',
      minimum: 0,
      maximum: 100,
    });
    expect(schema.parse(50)).toBe(50);
    expect(() => schema.parse(-1)).toThrow();
    expect(() => schema.parse(101)).toThrow();
  });

  it('converts boolean schema', () => {
    const schema = jsonSchemaToZod({ type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
    expect(() => schema.parse('true')).toThrow();
  });

  it('converts array schema', () => {
    const schema = jsonSchemaToZod({
      type: 'array',
      items: { type: 'string' },
    });
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => schema.parse([1, 2])).toThrow();
  });

  it('converts array with minItems/maxItems', () => {
    const schema = jsonSchemaToZod({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    });
    expect(schema.parse(['a'])).toEqual(['a']);
    expect(() => schema.parse([])).toThrow();
    expect(() => schema.parse(['a', 'b', 'c', 'd'])).toThrow();
  });

  it('converts object schema with required properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });
    expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' });
    expect(schema.parse({ name: 'test', age: 25 })).toEqual({ name: 'test', age: 25 });
    expect(() => schema.parse({ age: 25 })).toThrow();
  });

  it('allows extra properties with passthrough', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    });
    expect(schema.parse({ name: 'test', extra: 'value' })).toEqual({
      name: 'test',
      extra: 'value',
    });
  });
});

describe('validateArgs', () => {
  const testSchema = {
    type: 'object' as const,
    properties: {
      type: { type: 'string', enum: ['user', 'account'] },
      name: { type: 'string' },
      count: { type: 'number' },
    },
    required: ['type', 'name'],
  };

  it('validates valid arguments', () => {
    const result = validateArgs('test_tool', { type: 'user', name: 'test' }, testSchema);
    expect(result).toEqual({ type: 'user', name: 'test' });
  });

  it('includes optional properties when provided', () => {
    const result = validateArgs('test_tool', { type: 'user', name: 'test', count: 5 }, testSchema);
    expect(result).toEqual({ type: 'user', name: 'test', count: 5 });
  });

  it('throws ValidationError for missing required properties', () => {
    expect(() => validateArgs('test_tool', { type: 'user' }, testSchema)).toThrow(ValidationError);
  });

  it('throws ValidationError for invalid enum value', () => {
    expect(() =>
      validateArgs('test_tool', { type: 'invalid', name: 'test' }, testSchema)
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for wrong type', () => {
    expect(() =>
      validateArgs('test_tool', { type: 'user', name: 123 }, testSchema)
    ).toThrow(ValidationError);
  });

  it('includes tool name in error message', () => {
    try {
      validateArgs('test_tool', { type: 'user' }, testSchema);
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('test_tool');
    }
  });
});

describe('schemas', () => {
  describe('tokenType', () => {
    it('accepts valid token types', () => {
      expect(schemas.tokenType.parse('user')).toBe('user');
      expect(schemas.tokenType.parse('account')).toBe('account');
    });

    it('rejects invalid token types', () => {
      expect(() => schemas.tokenType.parse('invalid')).toThrow();
    });
  });

  describe('cfId', () => {
    it('accepts valid 32-char hex strings', () => {
      const validId = 'a'.repeat(32);
      expect(schemas.cfId.parse(validId)).toBe(validId);
    });

    it('rejects invalid IDs', () => {
      expect(() => schemas.cfId.parse('short')).toThrow();
      expect(() => schemas.cfId.parse('g'.repeat(32))).toThrow(); // non-hex
      expect(() => schemas.cfId.parse('a'.repeat(33))).toThrow(); // too long
    });
  });

  describe('expiresIn', () => {
    it('accepts valid expiration formats', () => {
      expect(schemas.expiresIn.parse('1h')).toBe('1h');
      expect(schemas.expiresIn.parse('30d')).toBe('30d');
      expect(schemas.expiresIn.parse('1y')).toBe('1y');
      expect(schemas.expiresIn.parse('never')).toBe('never');
    });

    it('accepts custom duration formats', () => {
      expect(schemas.expiresIn.parse('45d')).toBe('45d');
      expect(schemas.expiresIn.parse('2y')).toBe('2y');
    });

    it('rejects invalid formats', () => {
      expect(() => schemas.expiresIn.parse('invalid')).toThrow();
    });
  });

  describe('ipCidr', () => {
    it('accepts valid IPv4 addresses', () => {
      expect(schemas.ipCidr.parse('192.168.1.1')).toBe('192.168.1.1');
      expect(schemas.ipCidr.parse('192.168.1.0/24')).toBe('192.168.1.0/24');
    });

    it('rejects invalid IP addresses', () => {
      expect(() => schemas.ipCidr.parse('invalid')).toThrow();
    });
  });
});

describe('validateTokenType', () => {
  it('returns valid token types', () => {
    expect(validateTokenType('user')).toBe('user');
    expect(validateTokenType('account')).toBe('account');
  });

  it('throws ValidationError for invalid types', () => {
    expect(() => validateTokenType('invalid')).toThrow(ValidationError);
    expect(() => validateTokenType(123)).toThrow(ValidationError);
  });
});

describe('validateCfId', () => {
  it('returns valid Cloudflare IDs', () => {
    const validId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    expect(validateCfId(validId)).toBe(validId);
  });

  it('throws ValidationError for invalid IDs', () => {
    expect(() => validateCfId('short')).toThrow(ValidationError);
    expect(() => validateCfId(123)).toThrow(ValidationError);
  });

  it('includes field name in error', () => {
    try {
      validateCfId('short', 'Account ID');
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('Account ID');
    }
  });
});

describe('validateOptionalCfId', () => {
  it('returns undefined for empty values', () => {
    expect(validateOptionalCfId(undefined)).toBeUndefined();
    expect(validateOptionalCfId(null)).toBeUndefined();
    expect(validateOptionalCfId('')).toBeUndefined();
  });

  it('validates non-empty values', () => {
    const validId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    expect(validateOptionalCfId(validId)).toBe(validId);
    expect(() => validateOptionalCfId('short')).toThrow(ValidationError);
  });
});

describe('validateIpCidrArray', () => {
  it('returns undefined for null/undefined', () => {
    expect(validateIpCidrArray(undefined)).toBeUndefined();
    expect(validateIpCidrArray(null)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(validateIpCidrArray([])).toBeUndefined();
  });

  it('validates valid IPv4 addresses', () => {
    const ips = ['192.168.1.1', '10.0.0.0/8', '172.16.0.0/12'];
    expect(validateIpCidrArray(ips)).toEqual(ips);
  });

  it('validates valid IPv6 addresses', () => {
    const ips = ['::1', '2001:db8::/32'];
    expect(validateIpCidrArray(ips)).toEqual(ips);
  });

  it('throws ValidationError for non-array input', () => {
    expect(() => validateIpCidrArray('192.168.1.1')).toThrow(ValidationError);
    expect(() => validateIpCidrArray(123)).toThrow(ValidationError);
  });

  it('throws ValidationError for invalid IP in array', () => {
    expect(() => validateIpCidrArray(['192.168.1.1', 'invalid'])).toThrow(ValidationError);
  });

  it('includes index in error message for invalid IP', () => {
    try {
      validateIpCidrArray(['192.168.1.1', 'bad-ip', '10.0.0.1']);
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('[1]');
      expect((error as Error).message).toContain('bad-ip');
    }
  });

  it('includes custom field name in error message', () => {
    try {
      validateIpCidrArray(['invalid'], 'allowedIPs');
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('allowedIPs');
    }
  });
});
