import { z, ZodType, ZodError } from 'zod';
import { ValidationError } from './errors';

/**
 * Convert JSON Schema to Zod schema
 * Supports: string, number, boolean, array, object, enum
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): ZodType {
  const type = schema.type as string;

  switch (type) {
    case 'string': {
      let s = z.string();
      if (schema.enum) {
        return z.enum(schema.enum as [string, ...string[]]);
      }
      if (schema.minLength) s = s.min(schema.minLength as number);
      if (schema.maxLength) s = s.max(schema.maxLength as number);
      if (schema.pattern) s = s.regex(new RegExp(schema.pattern as string));
      return s;
    }

    case 'number':
    case 'integer': {
      let n = z.number();
      if (type === 'integer') n = n.int();
      if (schema.minimum !== undefined) n = n.min(schema.minimum as number);
      if (schema.maximum !== undefined) n = n.max(schema.maximum as number);
      return n;
    }

    case 'boolean':
      return z.boolean();

    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined;
      const itemSchema = items ? jsonSchemaToZod(items) : z.unknown();
      let arr = z.array(itemSchema);
      if (schema.minItems) arr = arr.min(schema.minItems as number);
      if (schema.maxItems) arr = arr.max(schema.maxItems as number);
      return arr;
    }

    case 'object': {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[]) || [];

      if (!properties) {
        return z.record(z.unknown());
      }

      const shape: Record<string, ZodType> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let propZod = jsonSchemaToZod(propSchema);
        if (!required.includes(key)) {
          propZod = propZod.optional();
        }
        shape[key] = propZod;
      }

      return z.object(shape).passthrough(); // Allow extra properties
    }

    default:
      return z.unknown();
  }
}

/**
 * Build Zod schema from tool's inputSchema
 */
export function buildToolValidator(inputSchema: {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}): ZodType<Record<string, unknown>> {
  return jsonSchemaToZod({
    type: 'object',
    properties: inputSchema.properties,
    required: inputSchema.required || [],
  }) as ZodType<Record<string, unknown>>;
}

/**
 * Validate arguments against tool schema
 * Returns validated args or throws ValidationError
 */
export function validateArgs(
  toolName: string,
  args: Record<string, unknown>,
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  }
): Record<string, unknown> {
  const validator = buildToolValidator(inputSchema);

  try {
    return validator.parse(args) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(i => {
        const path = i.path.join('.');
        return path ? `${path}: ${i.message}` : i.message;
      });
      throw new ValidationError(`Invalid arguments for ${toolName}: ${issues.join(', ')}`);
    }
    throw error;
  }
}

/**
 * Common Zod schemas for reuse
 */
export const schemas = {
  // Token type
  tokenType: z.enum(['user', 'account']),

  // Cloudflare IDs are 32-char hex strings
  cfId: z.string().length(32).regex(/^[a-f0-9]+$/i, 'Must be a 32-character hex string'),

  // Optional Cloudflare ID
  optionalCfId: z.string().length(32).regex(/^[a-f0-9]+$/i).optional(),

  // Expiration periods
  expiresIn: z.union([
    z.enum(['1h', '1d', '7d', '30d', '90d', '1y', 'never']),
    z.string().regex(/^\d+[dhmy]$/, 'Must be a duration like "30d", "1y", or "never"'),
  ]).optional(),

  // IP CIDR ranges
  ipCidr: z.string().regex(
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-fA-F:]+)(\/\d{1,3})?$/,
    'Must be a valid IP address or CIDR range'
  ),

  // Token name
  tokenName: z.string().min(1).max(255),

  // Template ID
  templateId: z.string().min(1).max(64),

  // Pagination
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(100).optional(),

  // Resource scope
  resourceScope: z.enum(['all_accounts', 'specific_account', 'all_zones']).optional(),
};

/**
 * Validate token type argument
 */
export function validateTokenType(type: unknown): 'user' | 'account' {
  const result = schemas.tokenType.safeParse(type);
  if (!result.success) {
    throw new ValidationError('Invalid token type: must be "user" or "account"');
  }
  return result.data;
}

/**
 * Validate Cloudflare ID
 */
export function validateCfId(id: unknown, fieldName = 'ID'): string {
  const result = schemas.cfId.safeParse(id);
  if (!result.success) {
    throw new ValidationError(`Invalid ${fieldName}: must be a 32-character hex string`);
  }
  return result.data;
}

/**
 * Validate optional Cloudflare ID
 */
export function validateOptionalCfId(id: unknown, fieldName = 'ID'): string | undefined {
  if (id === undefined || id === null || id === '') {
    return undefined;
  }
  return validateCfId(id, fieldName);
}

/**
 * Validate an array of IP CIDR ranges
 */
export function validateIpCidrArray(
  ips: unknown,
  fieldName = 'IP addresses'
): string[] | undefined {
  if (ips === undefined || ips === null) {
    return undefined;
  }

  if (!Array.isArray(ips)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  if (ips.length === 0) {
    return undefined;
  }

  const validated: string[] = [];
  for (let i = 0; i < ips.length; i++) {
    const ip = ips[i];
    const result = schemas.ipCidr.safeParse(ip);
    if (!result.success) {
      throw new ValidationError(
        `Invalid ${fieldName}[${i}]: "${ip}" is not a valid IP address or CIDR range`
      );
    }
    validated.push(result.data);
  }

  return validated;
}
