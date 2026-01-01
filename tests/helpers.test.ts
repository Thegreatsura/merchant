import { describe, it, expect } from 'vitest';
import { uuid, generateOrderNumber, isValidEmail } from '../src/types';

describe('uuid', () => {
  it('generates valid UUID format', () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });
});

describe('generateOrderNumber', () => {
  it('generates order number in correct format', () => {
    const orderNumber = generateOrderNumber();
    // Format: ORD-YYMMDD-XXXX
    expect(orderNumber).toMatch(/^ORD-\d{6}-[A-Z0-9]{4}$/);
  });

  it('uses current date', () => {
    const orderNumber = generateOrderNumber();
    const today = new Date();
    const expectedDatePart = today.toISOString().slice(2, 10).replace(/-/g, '');
    expect(orderNumber).toContain(expectedDatePart);
  });

  it('generates unique order numbers', () => {
    const numbers = new Set(Array.from({ length: 50 }, () => generateOrderNumber()));
    expect(numbers.size).toBe(50);
  });
});

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.org')).toBe(true);
    expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('no@tld')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });
});
