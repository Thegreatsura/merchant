import { describe, it, expect } from 'vitest';

// Import the discount calculation logic
// Note: validateDiscount requires DB access, so we test calculateDiscount which is pure
import { calculateDiscount, type Discount } from '../src/routes/discounts';

describe('calculateDiscount', () => {
  const baseDiscount: Discount = {
    id: 'test-id',
    store_id: 'store-id',
    code: 'TEST10',
    type: 'percentage',
    value: 10,
    status: 'active',
    min_purchase_cents: 0,
    max_discount_cents: null,
    starts_at: null,
    expires_at: null,
    usage_limit: null,
    usage_limit_per_customer: null,
    usage_count: 0,
    stripe_coupon_id: null,
    stripe_promotion_code_id: null,
  };

  describe('percentage discounts', () => {
    it('calculates 10% off correctly', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 10 };
      expect(calculateDiscount(discount, 10000)).toBe(1000); // $100 -> $10 off
    });

    it('calculates 25% off correctly', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 25 };
      expect(calculateDiscount(discount, 4000)).toBe(1000); // $40 -> $10 off
    });

    it('calculates 100% off correctly', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 100 };
      expect(calculateDiscount(discount, 5000)).toBe(5000); // $50 -> $50 off
    });

    it('floors fractional cents', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 15 };
      // 15% of 999 = 149.85, should floor to 149
      expect(calculateDiscount(discount, 999)).toBe(149);
    });

    it('respects max_discount_cents cap', () => {
      const discount: Discount = {
        ...baseDiscount,
        type: 'percentage',
        value: 50,
        max_discount_cents: 1000, // $10 max
      };
      // 50% of $100 = $50, but capped at $10
      expect(calculateDiscount(discount, 10000)).toBe(1000);
    });

    it('does not apply cap when discount is under limit', () => {
      const discount: Discount = {
        ...baseDiscount,
        type: 'percentage',
        value: 10,
        max_discount_cents: 5000, // $50 max
      };
      // 10% of $100 = $10, under the $50 cap
      expect(calculateDiscount(discount, 10000)).toBe(1000);
    });
  });

  describe('fixed amount discounts', () => {
    it('applies fixed discount correctly', () => {
      const discount: Discount = { ...baseDiscount, type: 'fixed_amount', value: 500 };
      expect(calculateDiscount(discount, 2000)).toBe(500); // $5 off $20
    });

    it('caps at subtotal to prevent negative totals', () => {
      const discount: Discount = { ...baseDiscount, type: 'fixed_amount', value: 5000 };
      // $50 discount on $20 order should cap at $20
      expect(calculateDiscount(discount, 2000)).toBe(2000);
    });

    it('handles exact match', () => {
      const discount: Discount = { ...baseDiscount, type: 'fixed_amount', value: 1000 };
      expect(calculateDiscount(discount, 1000)).toBe(1000); // $10 off $10
    });
  });

  describe('edge cases', () => {
    it('handles zero subtotal', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 10 };
      expect(calculateDiscount(discount, 0)).toBe(0);
    });

    it('handles zero value discount', () => {
      const discount: Discount = { ...baseDiscount, type: 'percentage', value: 0 };
      expect(calculateDiscount(discount, 10000)).toBe(0);
    });
  });
});
