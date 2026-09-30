/**
 * Reactive order reads and the order status state machine (plan Task 4.3).
 *
 * Two rules are load-bearing here:
 *
 *  - **Transitions are validated against `ALLOWED_ORDER_TRANSITIONS`.** A write
 *    the machine does not permit is rejected before it reaches IndexedDB, so a
 *    stale view can never resurrect a cancelled order.
 *  - **Stock is never touched directly.** When an order becomes `cancelled` or
 *    `refunded` its lines return to stock, and that goes through
 *    `mutateProductStock` with `changeType: 'return'` so the product row, its
 *    variants, its status and its audit log stay consistent — exactly the same
 *    path a manual restock takes.
 *
 * The transition table, the filtering and the revenue-recognition rules are
 * exported as pure functions so they can be asserted without a database.
 */

import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../../../shared/db/dexieDb';
import { nowIsoUtc } from '../../../shared/utils/dateMath';
import {
  applyStockChange,
  type StockChangeResult,
} from '../../inventory/hooks/useProductMutations';
import {
  ALLOWED_ORDER_TRANSITIONS,
  isRevenueRecognizedOrder,
  NON_REVENUE_ORDER_STATUSES,
  type DateRangeFilter,
  type Order,
  type OrderStatus,
  type OrderStatusFilter,
  type UUID,
} from '../../../shared/types';

export const ALL_STATUS_FILTER_VALUE = 'all' as const;

export type OrderStatusFilterValue = OrderStatusFilter;

export interface OrderFilters {
  status: OrderStatusFilter;
  searchQuery: string;
  dateRange: DateRangeFilter | null;
}

export const DEFAULT_ORDER_FILTERS: OrderFilters = {
  status: ALL_STATUS_FILTER_VALUE,
  searchQuery: '',
  dateRange: null,
};

export type OrderSortKey = 'createdAt' | 'orderNumber' | 'totalAmount' | 'status';

export interface OrderSort {
  key: OrderSortKey;
  direction: 'asc' | 'desc';
}

export const DEFAULT_ORDER_SORT: OrderSort = { key: 'createdAt', direction: 'desc' };

/* -------------------------------------------------------------------------- */
/* Pure query helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Searchable text for an order: number, customer identity and every line SKU. */
export const matchesOrderSearch = (order: Order, rawQuery: string): boolean => {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return true;

  const haystack = [
    order.orderNumber,
    order.customer.name,
    order.customer.email,
    order.status,
    ...order.items.flatMap((item) => [item.sku, item.productName]),
  ]
    .join(' ')
    .toLowerCase();

  return query.split(/\s+/).every((term) => haystack.includes(term));
};

export const isWithinDateRange = (order: Order, range: DateRangeFilter | null): boolean => {
  if (range === null) return true;
  // ISO 8601 UTC strings compare correctly with `localeCompare` alone, so no
  // `Date` parsing (and no timezone drift) is needed.
  return order.createdAt >= range.startDate && order.createdAt <= range.endDate;
};

export const filterOrders = (orders: readonly Order[], filters: OrderFilters): Order[] =>
  orders.filter((order) => {
    if (filters.status !== ALL_STATUS_FILTER_VALUE && order.status !== filters.status) return false;
    if (!isWithinDateRange(order, filters.dateRange)) return false;
    return matchesOrderSearch(order, filters.searchQuery);
  });

const compareOrders = (left: Order, right: Order, key: OrderSortKey): number => {
  switch (key) {
    case 'createdAt':
      return left.createdAt.localeCompare(right.createdAt);
    case 'orderNumber':
      return left.orderNumber.localeCompare(right.orderNumber);
    case 'status':
      return left.status.localeCompare(right.status);
    case 'totalAmount':
      return left.totalAmount - right.totalAmount;
  }
};

export const sortOrders = (orders: readonly Order[], sort: OrderSort): Order[] => {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...orders].sort((left, right) => compareOrders(left, right, sort.key) * factor);
};

/* -------------------------------------------------------------------------- */
/* Transition machine                                                          */
/* -------------------------------------------------------------------------- */

export class OrderTransitionError extends Error {
  readonly code: 'not_found' | 'illegal_transition' | 'stock_shortage';

  constructor(code: OrderTransitionError['code'], message: string) {
    super(message);
    this.name = 'OrderTransitionError';
    this.code = code;
  }
}

/** Statuses the machine permits from `from`, in the order the UI should offer. */
export const resolveNextStatuses = (from: OrderStatus): OrderStatus[] => [...ALLOWED_ORDER_TRANSITIONS[from]];

/**
 * Whether a write is permitted.
 *
 * A status that is already terminal accepts nothing, and every other status
 * accepts only the edges declared in the table.
 */
export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED_ORDER_TRANSITIONS[from].includes(to);

/** A human-readable reason when a transition is refused; `null` when it is fine. */
export const describeTransitionRefusal = (from: OrderStatus, to: OrderStatus): string | null => {
  if (canTransitionOrder(from, to)) return null;
  if (ALLOWED_ORDER_TRANSITIONS[from].length === 0) {
    return `An order that is ${from} is final and cannot change status.`;
  }
  return `An order cannot move from ${from} to ${to}.`;
};

/** Statuses a transition would move through revenue recognition. */
export const reversesRevenue = (from: OrderStatus, to: OrderStatus): boolean =>
  isRevenueRecognizedOrder(from) && NON_REVENUE_ORDER_STATUSES.includes(to);

/* -------------------------------------------------------------------------- */
/* Stock return                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The line items that must go back to stock when an order is cancelled or
 * refunded, keyed by variant so repeated SKUs collapse into one change.
 */
export interface StockReturnLine {
  productId: UUID;
  variantId?: UUID;
  sku: string;
  productName: string;
  quantity: number;
}

export const buildStockReturnLines = (order: Order): StockReturnLine[] => {
  const totals = new Map<string, StockReturnLine>();

  for (const item of order.items) {
    if (item.quantity <= 0) continue;
    const key = `${item.productId}::${item.variantId ?? ''}`;
    const existing = totals.get(key);
    if (existing === undefined) {
      totals.set(key, {
        productId: item.productId,
        ...(item.variantId === undefined ? {} : { variantId: item.variantId }),
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
      });
    } else {
      existing.quantity += item.quantity;
    }
  }

  return [...totals.values()];
};

export const STOCK_RETURN_REASON = 'Order cancelled or refunded — stock returned';

/* -------------------------------------------------------------------------- */
/* Transactional writes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Moves an order to `to`, returning its stock when the new status stops
 * recognising revenue.
 *
 * The order write and every resulting stock change run inside one transaction,
 * so a failure while returning a line leaves the order in its previous status
 * rather than stranding stock that will never be credited.
 */
export const applyOrderTransition = async (
  orderId: UUID,
  to: OrderStatus,
  options: { reason?: string; performedBy?: string } = {},
): Promise<{ order: Order; stockChanges: StockChangeResult[] }> => {
  return db.transaction('rw', db.orders, db.products, db.inventoryLogs, async () => {
    const order = await db.orders.get(orderId);
    if (order === undefined) {
      throw new OrderTransitionError('not_found', 'That order no longer exists.');
    }

    const refusal = describeTransitionRefusal(order.status, to);
    if (refusal !== null) {
      throw new OrderTransitionError('illegal_transition', refusal);
    }

    const at = nowIsoUtc();
    const next: Order = { ...order, status: to, updatedAt: at };
    const stockChanges: StockChangeResult[] = [];

    if (NON_REVENUE_ORDER_STATUSES.includes(to)) {
      for (const line of buildStockReturnLines(order)) {
        // A line whose product has since been deleted cannot be credited; that
        // is recorded, not fatal, because the order transition still stands.
        const product = await db.products.get(line.productId);
        if (product === undefined) continue;
        if (line.variantId !== undefined && !product.variants.some((variant) => variant.id === line.variantId)) {
          continue;
        }
        // Not wrapped in its own try/catch on purpose: a real failure here must
        // abort the outer transaction and roll the order transition back, rather
        // than leaving an order cancelled whose stock was never credited.
        stockChanges.push(
          await applyStockChange({
            productId: line.productId,
            ...(line.variantId === undefined ? {} : { variantId: line.variantId }),
            changeType: 'return',
            quantity: line.quantity,
            reason: options.reason ?? STOCK_RETURN_REASON,
            ...(options.performedBy === undefined ? {} : { performedBy: options.performedBy }),
            at,
          }),
        );
      }
    }

    await db.orders.put(next);
    return { order: next, stockChanges };
  });
};

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export interface SalesAggregates {
  orderCount: number;
  /** GMV: only orders whose status still recognises revenue contribute. */
  revenue: number;
  unitsSold: number;
  averageOrderValue: number;
  grossProfit: number;
  grossMarginPct: number;
  cancelledCount: number;
  refundedCount: number;
  pendingCount: number;
  processingCount: number;
  shippedCount: number;
  deliveredCount: number;
}

export const buildSalesAggregates = (orders: readonly Order[]): SalesAggregates => {
  let revenue = 0;
  let grossProfit = 0;
  let unitsSold = 0;
  let orderCount = 0;
  const byStatus: Record<OrderStatus, number> = {
    pending: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
    refunded: 0,
  };

  for (const order of orders) {
    byStatus[order.status] += 1;
    if (!isRevenueRecognizedOrder(order.status)) continue;
    orderCount += 1;
    revenue += order.totalAmount;
    grossProfit += order.netProfit;
    unitsSold += order.items.reduce((total, item) => total + Math.max(0, item.quantity), 0);
  }

  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

  return {
    orderCount,
    revenue: round2(revenue),
    unitsSold,
    averageOrderValue: orderCount === 0 ? 0 : round2(revenue / orderCount),
    grossProfit: round2(grossProfit),
    grossMarginPct: revenue === 0 ? 0 : round2((grossProfit / revenue) * 100),
    cancelledCount: byStatus.cancelled,
    refundedCount: byStatus.refunded,
    pendingCount: byStatus.pending,
    processingCount: byStatus.processing,
    shippedCount: byStatus.shipped,
    deliveredCount: byStatus.delivered,
  };
};

export const selectRecentOrders = (orders: readonly Order[], limit: number): Order[] =>
  [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseOrdersOptions {
  filters?: Partial<OrderFilters>;
  sort?: OrderSort;
}

export interface OrdersQueryResult {
  orders: Order[];
  filteredOrders: Order[];
  totalCount: number;
  aggregates: SalesAggregates;
  recentOrders: Order[];
  loading: boolean;
  error: string | null;
}

export const useOrders = (options: UseOrdersOptions = {}): OrdersQueryResult => {
  const { filters, sort } = options;

  const resolvedFilters = useMemo<OrderFilters>(
    () => ({ ...DEFAULT_ORDER_FILTERS, ...filters }),
    [filters?.status, filters?.searchQuery, filters?.dateRange],
  );

  const liveOrders = useLiveQuery<Order[]>(() => db.orders.orderBy('createdAt').reverse().toArray(), []);
  const loadError = useLiveQuery<string | null>(
    async () => {
      try {
        await db.orders.count();
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : 'The local database could not be read.';
      }
    },
    [],
  );

  const loading = liveOrders === undefined;
  const orders = useMemo(() => liveOrders ?? [], [liveOrders]);

  const filteredOrders = useMemo(
    () => sortOrders(filterOrders(orders, resolvedFilters), sort ?? DEFAULT_ORDER_SORT),
    [orders, resolvedFilters, sort],
  );

  const aggregates = useMemo(() => buildSalesAggregates(filteredOrders), [filteredOrders]);
  const recentOrders = useMemo(() => selectRecentOrders(filteredOrders, 6), [filteredOrders]);

  return {
    orders,
    filteredOrders,
    totalCount: orders.length,
    aggregates,
    recentOrders,
    loading,
    error: loadError ?? null,
  };
};

export interface OrderMutations {
  transitionOrder: (orderId: UUID, to: OrderStatus, reason?: string) => Promise<Order>;
  pending: boolean;
  error: string | null;
  clearError: () => void;
}

export const useOrderMutations = (): OrderMutations => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transitionOrder = useCallback(async (orderId: UUID, to: OrderStatus, reason?: string) => {
    setPending(true);
    setError(null);
    try {
      const { order } = await applyOrderTransition(
        orderId,
        to,
        reason === undefined ? {} : { reason },
      );
      return order;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be updated.');
      throw cause;
    } finally {
      setPending(false);
    }
  }, []);

  return useMemo<OrderMutations>(
    () => ({ transitionOrder, pending, error, clearError: () => setError(null) }),
    [transitionOrder, pending, error],
  );
};
