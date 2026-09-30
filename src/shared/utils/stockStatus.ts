/**
 * Pure stock-status rules (plan §3.1.4).
 *
 * The resolution is shared by the seeder and by every transactional mutation so
 * the two can never disagree about what `in_stock` means. A product carrying the
 * manual `discontinued` flag keeps it: discontinuation is a merchandising
 * decision and must survive an unrelated restock.
 */

import type { Product, ProductVariant, StockStatus } from '../types';

/** The minimum shape the resolver needs; a full `Product` satisfies it. */
export interface StockStatusSubject {
  totalStock: number;
  safetyStockThreshold: number;
  variants: readonly Pick<ProductVariant, 'stockQuantity' | 'safetyStockThreshold' | 'isArchived'>[];
  /** The currently persisted status, consulted only to preserve `discontinued`. */
  status: StockStatus;
}

/** Variants that still participate in stock accounting. */
export const activeVariants = (
  product: Pick<Product, 'variants'>,
): ProductVariant[] => product.variants.filter((variant) => !variant.isArchived);

export const resolveStockStatus = (subject: StockStatusSubject): StockStatus => {
  if (subject.status === 'discontinued') return 'discontinued';

  const totalStock = Math.max(0, Math.trunc(subject.totalStock));
  if (totalStock === 0) return 'out_of_stock';

  const liveVariants = subject.variants.filter((variant) => !variant.isArchived);

  if (liveVariants.length > 0) {
    const anyVariantAtOrBelowThreshold = liveVariants.some(
      (variant) => variant.stockQuantity <= variant.safetyStockThreshold,
    );
    return anyVariantAtOrBelowThreshold ? 'low_stock' : 'in_stock';
  }

  return totalStock <= subject.safetyStockThreshold ? 'low_stock' : 'in_stock';
};

/** Convenience predicate for the restock watchlist. */
export const needsRestock = (product: Pick<Product, 'status'>): boolean =>
  product.status === 'low_stock' || product.status === 'out_of_stock';

export const isSellable = (product: Pick<Product, 'status'>): boolean =>
  product.status === 'in_stock' || product.status === 'low_stock';

/** Margin on a single unit, rounded to 2 decimals. */
export const unitMargin = (price: number, cost: number): number =>
  Math.round((Math.max(0, price) - Math.max(0, cost) + Number.EPSILON) * 100) / 100;
