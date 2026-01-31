import { describe, it, expect } from 'vitest';
import {
  parseExpiresIn,
  isValidExpirationFormat,
  formatExpiration,
} from '../lib/expiration';
import { ValidationError } from '../lib/errors';

describe('parseExpiresIn', () => {
  it('returns undefined for "never"', () => {
    expect(parseExpiresIn('never')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseExpiresIn(undefined)).toBeUndefined();
  });

  it('parses hours correctly', () => {
    const result = parseExpiresIn('1h');
    expect(result).toBeDefined();
    const date = new Date(result!);
    const now = new Date();
    const diffHours = (date.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(1, 0);
  });

  it('parses days correctly', () => {
    const result = parseExpiresIn('30d');
    expect(result).toBeDefined();
    const date = new Date(result!);
    const now = new Date();
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });

  it('parses months correctly', () => {
    const result = parseExpiresIn('3m');
    expect(result).toBeDefined();
    const date = new Date(result!);
    const now = new Date();
    // Approximately 3 months
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(80);
    expect(diffDays).toBeLessThan(100);
  });

  it('parses years correctly', () => {
    const result = parseExpiresIn('1y');
    expect(result).toBeDefined();
    const date = new Date(result!);
    const now = new Date();
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(365, 1);
  });

  it('throws ValidationError for invalid format', () => {
    expect(() => parseExpiresIn('invalid')).toThrow(ValidationError);
    expect(() => parseExpiresIn('abc')).toThrow(ValidationError);
    expect(() => parseExpiresIn('30')).toThrow(ValidationError);
    expect(() => parseExpiresIn('d30')).toThrow(ValidationError);
  });

  it('throws ValidationError for zero or negative values', () => {
    expect(() => parseExpiresIn('0d')).toThrow(ValidationError);
  });

  it('throws ValidationError for excessive values', () => {
    expect(() => parseExpiresIn('9999d')).toThrow(ValidationError);
    expect(() => parseExpiresIn('100y')).toThrow(ValidationError);
  });
});

describe('isValidExpirationFormat', () => {
  it('returns true for valid formats', () => {
    expect(isValidExpirationFormat('1h')).toBe(true);
    expect(isValidExpirationFormat('7d')).toBe(true);
    expect(isValidExpirationFormat('30d')).toBe(true);
    expect(isValidExpirationFormat('3m')).toBe(true);
    expect(isValidExpirationFormat('1y')).toBe(true);
    expect(isValidExpirationFormat('never')).toBe(true);
  });

  it('returns false for invalid formats', () => {
    expect(isValidExpirationFormat('invalid')).toBe(false);
    expect(isValidExpirationFormat('30')).toBe(false);
    expect(isValidExpirationFormat('d30')).toBe(false);
    expect(isValidExpirationFormat('')).toBe(false);
  });
});

describe('formatExpiration', () => {
  it('returns "Never" for undefined', () => {
    expect(formatExpiration(undefined)).toBe('Never');
  });

  it('returns "Expired" for past dates', () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    expect(formatExpiration(pastDate)).toBe('Expired');
  });

  it('formats hours correctly', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString();
    expect(formatExpiration(futureDate)).toBe('2 hours');
  });

  it('formats days correctly', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    expect(formatExpiration(futureDate)).toBe('7 days');
  });

  it('formats months correctly', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString();
    expect(formatExpiration(futureDate)).toBe('2 months');
  });

  it('formats years correctly', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 400).toISOString();
    expect(formatExpiration(futureDate)).toBe('1 year');
  });
});
