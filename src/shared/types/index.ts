/**
 * Canonical domain schema for the commerce admin console.
 *
 * Everything persisted to IndexedDB (via Dexie) is normalised to UTC and stored
 * as ISO 8601 strings. Never persist a `Date` instance: the string form is the
 * storage contract, it sorts lexicographically, and it survives JSON round-trips
 * through CSV exports without drifting into the host timezone.
 */

export type UUID = string;
export type ISODateString = string;

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const ORDER_STATUSES = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = [
  'credit_card',
  'bank_transfer',
  'digital_wallet',
  'cash_on_delivery',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVENTORY_SCOPES = ['product', 'variant'] as const;
export type InventoryScope = (typeof INVENTORY_SCOPES)[number];

export const INVENTORY_CHANGE_TYPES = [
  'restock',
  'sale',
  'adjustment',
  'return',
  'damage',
] as const;
export type InventoryChangeType = (typeof INVENTORY_CHANGE_TYPES)[number];

export const AGGREGATION_INTERVALS = ['day', 'week', 'month'] as const;
export type AggregationInterval = (typeof AGGREGATION_INTERVALS)[number];

/** Discriminators accepted by filter state; `'all'` disables that facet. */
export type StockStatusFilter = StockStatus | 'all';
export type OrderStatusFilter = OrderStatus | 'all';
export type CategoryFilter = string | 'all';

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

export interface ProductVariant {
  id: UUID;
  sku: string;
  name: string;
  price: number;
  costPrice: number;
  stockQuantity: number;
  safetyStockThreshold: number;
  attributes: Record<string, string>;
  isArchived: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Product {
  id: UUID;
  sku: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  basePrice: number;
  baseCost: number;
  /** Denormalised sum of every non-archived variant's `stockQuantity`. */
  totalStock: number;
  safetyStockThreshold: number;
  status: StockStatus;
  variants: ProductVariant[];
  tags: string[];
  /** Soft delete: archived products stay in the table but leave default queries. */
  isArchived: boolean;
  deletedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface InventoryLog {
  id: UUID;
  productId: UUID;
  variantId?: UUID;
  /** Marks whether the log entry targets the variant row or the product row. */
  scope: InventoryScope;
  changeType: InventoryChangeType;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  performedBy: string;
  timestamp: ISODateString;
}

export interface OrderItem {
  id: UUID;
  productId: UUID;
  variantId?: UUID;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  subtotal: number;
}

export interface CustomerSummary {
  id: UUID;
  name: string;
  email: string;
  country: string;
  totalOrdersCount: number;
}

export interface Order {
  id: UUID;
  orderNumber: string;
  customer: CustomerSummary;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  netProfit: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* Filter + projection shapes                                                  */
/* -------------------------------------------------------------------------- */

export interface DateRangeFilter {
  startDate: ISODateString;
  endDate: ISODateString;
}

export interface DashboardFilterState {
  dateRange: DateRangeFilter;
  category: CategoryFilter;
  stockStatus: StockStatusFilter;
  orderStatus: OrderStatusFilter;
  searchQuery: string;
}

export interface SalesTimeSeriesPoint {
  /** `YYYY-MM-DD` for the day interval, `YYYY-MM` for the month interval (UTC). */
  date: string;
  revenue: number;
  ordersCount: number;
  profit: number;
}

export interface CategorySalesPoint {
  category: string;
  revenue: number;
  unitsSold: number;
  percentage: number;
}

export interface KPIStats {
  totalRevenue: number;
  revenueGrowthPct: number;
  grossProfit: number;
  profitMarginPct: number;
  totalOrders: number;
  ordersGrowthPct: number;
  averageOrderValue: number;
  lowStockItemsCount: number;
  outOfStockItemsCount: number;
}

/* -------------------------------------------------------------------------- */
/* Order status state machine                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Directed adjacency list for the order lifecycle. Terminal states map to an
 * empty tuple so no further mutation is structurally possible.
 */
export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
} as const;

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded'];

/**
 * Order statuses excluded from revenue, profit and sales-volume aggregates.
 * Cancelled orders never settled; refunded orders settled and were returned.
 */
export const NON_REVENUE_ORDER_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded'];

export const allowedOrderTransitions = (from: OrderStatus): readonly OrderStatus[] =>
  ALLOWED_ORDER_TRANSITIONS[from];

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED_ORDER_TRANSITIONS[from].includes(to);

export const isTerminalOrderStatus = (status: OrderStatus): boolean =>
  TERMINAL_ORDER_STATUSES.includes(status);

export const isRevenueRecognizedOrder = (status: OrderStatus): boolean =>
  !NON_REVENUE_ORDER_STATUSES.includes(status);

/* -------------------------------------------------------------------------- */
/* Presentation metadata (single source of truth for labels + badge semantics)  */
/* -------------------------------------------------------------------------- */

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  discontinued: 'Discontinued',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  digital_wallet: 'Digital Wallet',
  cash_on_delivery: 'Cash on Delivery',
};

export const INVENTORY_CHANGE_TYPE_LABEL: Record<InventoryChangeType, string> = {
  restock: 'Restock',
  sale: 'Sale',
  adjustment: 'Adjustment',
  return: 'Return',
  damage: 'Damage',
};

export const INVENTORY_SCOPE_LABEL: Record<InventoryScope, string> = {
  product: 'Product',
  variant: 'Variant',
};

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const STOCK_STATUS_TONE: Record<StockStatus, BadgeTone> = {
  in_stock: 'success',
  low_stock: 'warning',
  out_of_stock: 'danger',
  discontinued: 'neutral',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'info',
  processing: 'warning',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'neutral',
  refunded: 'danger',
};

/* -------------------------------------------------------------------------- */
/* Reference catalogs (drive seed data and filter option lists)                */
/* -------------------------------------------------------------------------- */

export const PRODUCT_CATEGORIES = [
  'Audio',
  'Computing',
  'Mobile Accessories',
  'Home & Kitchen',
  'Outdoor',
  'Wearables',
] as const;

export const PRODUCT_BRANDS = [
  'Auralis',
  'Northwind',
  'Kestrel',
  'Lumen',
  'Vertex',
  'Sable',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductBrand = (typeof PRODUCT_BRANDS)[number];

export const SHIPPING_COUNTRIES = [
  'United States',
  'Canada',
  'United Kingdom',
  'Germany',
  'France',
  'Australia',
  'Japan',
  'Singapore',
] as const;

export type ShippingCountry = (typeof SHIPPING_COUNTRIES)[number];

/** Operator identity written onto every inventory mutation performed by this app. */
export const SYSTEM_OPERATOR_NAME = 'admin.operator';
