import { ValidationError } from './errors';

/**
 * Valid expiration period shortcuts
 */
export const VALID_EXPIRATION_SHORTCUTS = ['1h', '1d', '7d', '30d', '90d', '1y', 'never'] as const;
export type ExpirationShortcut = (typeof VALID_EXPIRATION_SHORTCUTS)[number];

/**
 * Parse an expiration string into an ISO 8601 date string
 *
 * Supported formats:
 * - "never" -> undefined (no expiration)
 * - "1h", "2h", etc. -> hours from now
 * - "1d", "7d", "30d", etc. -> days from now
 * - "1m", "3m", etc. -> months from now
 * - "1y", "2y", etc. -> years from now
 *
 * @param expiresIn - The expiration period string
 * @returns ISO 8601 date string or undefined for "never"
 * @throws ValidationError if format is invalid
 */
export function parseExpiresIn(expiresIn: string | undefined): string | undefined {
  if (!expiresIn || expiresIn === 'never') {
    return undefined;
  }

  const match = expiresIn.match(/^(\d+)([dhmy])$/);
  if (!match) {
    throw new ValidationError(
      `Invalid expiration format: "${expiresIn}". ` +
      'Use formats like "1h", "7d", "30d", "3m", "1y", or "never".'
    );
  }

  const [, amountStr, unit] = match;
  const amount = parseInt(amountStr, 10);

  if (amount <= 0) {
    throw new ValidationError('Expiration amount must be greater than 0');
  }

  // Validate reasonable limits
  const limits: Record<string, number> = {
    h: 8760, // 1 year in hours
    d: 365,  // 1 year in days
    m: 12,   // 1 year in months
    y: 10,   // 10 years max
  };

  if (amount > limits[unit]) {
    throw new ValidationError(
      `Expiration too far in the future. Maximum: ${limits[unit]}${unit}`
    );
  }

  const now = new Date();

  switch (unit) {
    case 'h':
      now.setHours(now.getHours() + amount);
      break;
    case 'd':
      now.setDate(now.getDate() + amount);
      break;
    case 'm':
      now.setMonth(now.getMonth() + amount);
      break;
    case 'y':
      now.setFullYear(now.getFullYear() + amount);
      break;
  }

  return now.toISOString();
}

/**
 * Validate expiration format without parsing
 */
export function isValidExpirationFormat(expiresIn: string): boolean {
  if (expiresIn === 'never') {
    return true;
  }
  return /^\d+[dhmy]$/.test(expiresIn);
}

/**
 * Format a date to human-readable expiration string
 */
export function formatExpiration(expiresOn: string | undefined): string {
  if (!expiresOn) {
    return 'Never';
  }

  const expires = new Date(expiresOn);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();

  if (diffMs < 0) {
    return 'Expired';
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;
  }

  if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'}`;
  }

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'}`;
}
