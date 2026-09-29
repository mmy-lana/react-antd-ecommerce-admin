# Technical Blueprint: E-Commerce Admin Inventory & Sales Dashboard (`react-antd-ecommerce-admin`)

---

## 1. Data Schema & Pure TypeScript Interfaces

```typescript
export type UUID = string;
export type ISODateString = string;

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'discontinued';
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type PaymentMethod = 'credit_card' | 'bank_transfer' | 'digital_wallet' | 'cash_on_delivery';

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
  totalStock: number;
  safetyStockThreshold: number;
  status: StockStatus;
  variants: ProductVariant[];
  tags: string[];
  isArchived: boolean;
  deletedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface InventoryLog {
  id: UUID;
  productId: UUID;
  variantId?: UUID;
  scope: 'product' | 'variant';
  changeType: 'restock' | 'sale' | 'adjustment' | 'return' | 'damage';
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  performedBy: string;
  timestamp: ISODateString;
}

export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
} as const;

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

export interface DateRangeFilter {
  startDate: ISODateString;
  endDate: ISODateString;
}

export interface DashboardFilterState {
  dateRange: DateRangeFilter;
  category: string | 'all';
  stockStatus: StockStatus | 'all';
  orderStatus: OrderStatus | 'all';
  searchQuery: string;
}

export interface SalesTimeSeriesPoint {
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
```

---

## 2. Component Architecture

```
src/
├── app/
│   ├── App.tsx
│   ├── Router.tsx
│   └── theme/
│       ├── tokens.ts
│       └── themeConfig.ts
├── shared/
│   ├── components/
│   │   ├── primitives/
│   │   │   ├── MetricCard.tsx
│   │   │   ├── TrendIndicator.tsx
│   │   │   ├── ResponsiveContainer.tsx
│   │   │   └── StatusBadge.tsx
│   │   ├── feedback/
│   │   │   ├── EmptyStateView.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── SkeletonBoard.tsx
│   │   └── layout/
│   │       ├── DashboardLayout.tsx
│   │       ├── HeaderBar.tsx
│   │       ├── SidebarNav.tsx
│   │       └── MobileNavDrawer.tsx
│   ├── db/
│   │   ├── dexieDb.ts
│   │   └── seedData.ts
│   └── utils/
│       ├── currency.ts
│       ├── dateMath.ts
│       └── exportCsv.ts
└── features/
    ├── dashboard/
    │   ├── components/
    │   │   ├── KPIOverviewGrid.tsx
    │   │   ├── RevenueTimeSeriesChart.tsx
    │   │   ├── CategoryBreakdownChart.tsx
    │   │   └── RecentOrdersSnapshot.tsx
    │   ├── hooks/
    │   │   └── useDashboardMetrics.ts
    │   └── views/
    │       └── DashboardView.tsx
    ├── inventory/
    │   ├── components/
    │   │   ├── InventoryTable.tsx
    │   │   ├── StockAdjustmentModal.tsx
    │   │   ├── ProductFormDrawer.tsx
    │   │   └── StockFilterToolbar.tsx
    │   ├── hooks/
    │   │   ├── useInventory.ts
    │   │   └── useProductMutations.ts
    │   └── views/
    │       └── InventoryView.tsx
    └── sales/
        ├── components/
        │   ├── OrdersTable.tsx
        │   ├── OrderDetailDrawer.tsx
        │   └── SalesDateRangePicker.tsx
        ├── hooks/
        │   └── useOrders.ts
        └── views/
            └── SalesView.tsx
```

---

## 3. Core Feature Logic & Business Rules

### 3.1 Financial & Inventory Calculation Formulas

1. **Gross Merchandise Value (GMV) / Total Revenue**:
   $$\text{GMV} = \sum (\text{Order.totalAmount}) \quad \forall \, \text{orders where status} \notin \{\text{'cancelled'}, \text{'refunded'}\}$$

2. **Gross Margin & Net Profit**:
   $$\text{Order Cost} = \sum (\text{OrderItem.quantity} \times \text{OrderItem.unitCost})$$
   $$\text{Order Net Profit} = \text{Order.totalAmount} - \text{Order Cost} - \text{Order.shippingFee} - \text{Order.taxAmount}$$
   $$\text{Profit Margin} = \left(\frac{\text{Total Net Profit}}{\text{Total Revenue}}\right) \times 100$$

3. **Average Order Value (AOV)**:
   $$\text{AOV} = \frac{\text{Total Revenue}}{\text{Total Valid Orders Count}}$$

4. **Dynamic Stock Status Resolution & Persistence**:
   - `out_of_stock`: $\text{stockQuantity} = 0$
   - `low_stock`: $0 < \text{stockQuantity} \le \text{safetyStockThreshold}$
   - `in_stock`: $\text{stockQuantity} > \text{safetyStockThreshold}$
   Status resolution must be recomputed and written to `Product.status` atomically within the mutation transaction.

5. **Atomic Stock Mutation & Reconcile Transaction Contract**:
```typescript
export async function mutateProductStock(
  productId: string,
  variantId: string | undefined,
  delta: number,
  changeType: InventoryLog['changeType'],
  reason: string,
  performedBy: string
): Promise<void> {
  await db.transaction('rw', db.products, db.inventoryLogs, async () => {
    const product = await db.products.get(productId);
    if (!product || product.isArchived) {
      throw new Error(`Product ${productId} not found or archived`);
    }

    let previousQty = 0;
    let newQty = 0;

    if (variantId) {
      const variantIdx = product.variants.findIndex(v => v.id === variantId);
      if (variantIdx === -1) throw new Error(`Variant ${variantId} not found`);
      
      previousQty = product.variants[variantIdx].stockQuantity;
      newQty = previousQty + delta;
      if (newQty < 0) {
        throw new Error(`Insufficient stock. Current: ${previousQty}, requested delta: ${delta}`);
      }
      
      product.variants[variantIdx].stockQuantity = newQty;
      product.variants[variantIdx].updatedAt = new Date().toISOString();
      product.totalStock = product.variants.reduce((sum, v) => sum + v.stockQuantity, 0);
    } else {
      previousQty = product.totalStock;
      newQty = previousQty + delta;
      if (newQty < 0) {
        throw new Error(`Insufficient stock. Current: ${previousQty}, requested delta: ${delta}`);
      }
      product.totalStock = newQty;
    }

    // Synchronize parent status (preserve manual discontinued status)
    if (product.status !== 'discontinued') {
      if (product.totalStock === 0) {
        product.status = 'out_of_stock';
      } else if (
        product.variants.length > 0
          ? product.variants.some(v => v.stockQuantity <= v.safetyStockThreshold)
          : product.totalStock <= product.safetyStockThreshold
      ) {
        product.status = 'low_stock';
      } else {
        product.status = 'in_stock';
      }
    }

    product.updatedAt = new Date().toISOString();

    await db.products.put(product);
    await db.inventoryLogs.add({
      id: crypto.randomUUID(),
      productId,
      variantId,
      scope: variantId ? 'variant' : 'product',
      changeType,
      quantityDelta: delta,
      previousQuantity: previousQty,
      newQuantity: newQty,
      reason,
      performedBy,
      timestamp: new Date().toISOString(),
    });
  });
}

### 3.2 Time Series Bucketing Algorithm

```typescript
export function aggregateSalesByInterval(
  orders: Order[],
  startDate: Date,
  endDate: Date,
  interval: 'day' | 'month'
): SalesTimeSeriesPoint[] {
  const pointsMap = new Map<string, { revenue: number; ordersCount: number; profit: number }>();
  
  const current = new Date(startDate);
  while (current <= endDate) {
    const key = interval === 'day' 
      ? current.toISOString().slice(0, 10) 
      : current.toISOString().slice(0, 7);
    if (!pointsMap.has(key)) {
      pointsMap.set(key, { revenue: 0, ordersCount: 0, profit: 0 });
    }
    if (interval === 'day') {
      current.setDate(current.getDate() + 1);
    } else {
      current.setMonth(current.getMonth() + 1);
    }
  }

  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'refunded') continue;
    const orderKey = interval === 'day' 
      ? order.createdAt.slice(0, 10) 
      : order.createdAt.slice(0, 7);
      
    const bucket = pointsMap.get(orderKey);
    if (bucket) {
      bucket.revenue += order.totalAmount;
      bucket.profit += order.netProfit;
      bucket.ordersCount += 1;
    }
  }

  return Array.from(pointsMap.entries()).map(([date, data]) => ({
    date,
    revenue: Number(data.revenue.toFixed(2)),
    ordersCount: data.ordersCount,
    profit: Number(data.profit.toFixed(2)),
  }));
}
```

### 3.3 Offline-First Storage Layer with Dexie.js

```typescript
import Dexie, { type EntityTable } from 'dexie';
import { Product, Order, InventoryLog } from './types';

export type CommerceDatabase = Dexie & {
  products: EntityTable<Product, 'id'>;
  orders: EntityTable<Order, 'id'>;
  inventoryLogs: EntityTable<InventoryLog, 'id'>;
};

export const db = new Dexie('CommerceAdminDB') as CommerceDatabase;

db.version(1).stores({
  products: 'id, sku, category, status, totalStock, isArchived, updatedAt',
  orders: 'id, orderNumber, status, createdAt, totalAmount',
  inventoryLogs: 'id, productId, variantId, scope, changeType, timestamp'
});
```

---

## 4. Five-Phase Sequential Execution Queue

### Phase 1: Types, Storage/API Client Config, and Base Utilities
- Task 1.1: Configure root TypeScript definitions (`src/shared/types/index.ts`) matching data schemas for Products, Variants, Inventory Logs, and Orders with soft-delete flags, transition graphs, and scoped log markers.
- Task 1.2: Declare and configure dependencies: `antd@latest`, `@ant-design/icons@latest`, `@ant-design/plots@latest`, `dexie@latest`, `dexie-react-hooks@latest`, and `dayjs@latest`. Enforce zero v5 deprecated patterns; configure the Ant Design `<App>` context provider wrapping the application root so all dialogs and notifications use context-based APIs (`App.useApp()`).
- Task 1.3: Initialize Dexie using `EntityTable<T, 'id'>` interface syntax (`src/shared/db/dexieDb.ts`) with ISO 8601 storage standards. Implement `seedData.ts` populating 100 historical orders and 30 multi-variant products.
- Task 1.4: Implement `dayjs` date math utilities (`src/shared/utils/dateMath.ts`) enforcing UTC boundary normalization at the query layer to eliminate timezone offset anomalies.
- Task 1.5: Implement client-side CSV export generator supporting RFC 4180 compliance for sales and stock records.

### Phase 2: Design Foundation & Atomic UI Primitives
- Task 2.1: Implement Ant Design dynamic theme tokens in `themeConfig.ts` with custom palettes for analytics metrics (slate dark sidebar, slate-50 canvas, semantic badges).
- Task 2.2: Build `MetricCard.tsx` displaying numeric values, trend micro-indicators, and secondary comparison labels.
- Task 2.3: Build `StatusBadge.tsx` resolving inventory and order states with touch-accessible elements and explicit aria roles.
- Task 2.4: Implement `ResponsiveContainer.tsx` with defined layout boundaries: `< 768px` switches navigation to `MobileNavDrawer`, and `>= 768px` locks to desktop collapsible sidebar. All overlays and drawers (`ProductFormDrawer`, `OrderDetailDrawer`) must compute width dynamically: `width={viewportWidth < 480 ? '100%' : 460}`.
- Task 2.5: Build `EmptyStateView.tsx` and custom skeleton fallbacks for analytic widgets.

### Phase 3: Compound Molecules & Feature Components
- Task 3.1: Build `InventoryTable.tsx` leveraging Ant Design `Table` with `scroll={{ x: 'max-content' }}`. Define responsive column configurations: on mobile (< 480px), collapse down to SKU, Product Name, Total Stock, and Actions; nest variants, price, and threshold into expandable row panels. Style all action buttons with a minimum 44x44px touch target hitbox.
- Task 3.2: Build `StockAdjustmentModal.tsx` utilizing `App.useApp()` modal context, bound to transactional validation guards.
- Task 3.3: Build `RevenueTimeSeriesChart.tsx` using `@ant-design/plots` Area/Line charts, reading token palette colors and re-rendering via `ResizeObserver`.
- Task 3.4: Build `CategoryBreakdownChart.tsx` using `@ant-design/plots` Pie/Donut with responsive legend wrapping.
- Task 3.5: Build `OrdersTable.tsx` featuring status filters, transitions restricted to `ALLOWED_ORDER_TRANSITIONS`, customer profile references, and 44x44px touch action triggers.
- Task 3.6: Build `OrderDetailDrawer.tsx` detailing line items, SKU codes, fulfillment cost profiles, and status mutation triggers with mobile-adaptive width.

### Phase 4: Domain Logic, Reactive State, and Specialized APIs
- Task 4.1: Implement `useInventory.ts` hook utilizing `useLiveQuery` from `dexie-react-hooks` filtering out archived records by default.
- Task 4.2: Implement `useProductMutations.ts` executing the atomic `mutateProductStock` contract: simultaneous variant adjustment, parent `totalStock` recalculation, negative-stock check rejection with rollback, `Product.status` recalculation, and `InventoryLog` insertion inside a single `db.transaction('rw', ...)`.
- Task 4.3: Implement `useOrders.ts` enforcing the status state machine. If an order transitions to `'cancelled'` or `'refunded'`, invoke `mutateProductStock(...)` with `changeType: 'return'` for each line item rather than modifying `db.products` directly, maintaining uniform logging and status reconciliation.
- Task 4.4: Implement `useDashboardMetrics.ts` computing KPI aggregates (GMV, AOV, Gross Margin, Low-Stock items) derived from active date boundaries parsed through `dayjs`.
- Task 4.5: Implement responsive drawer navigation state to toggle cleanly between mobile slide-over drawers and desktop fixed sidebars at the 768px breakpoint.

### Phase 5: Complete Page/Screen Assembly & Responsive Shell
- Task 5.1: Construct `DashboardLayout.tsx` unifying `SidebarNav.tsx`, `HeaderBar.tsx`, and responsive drawer navigation.
- Task 5.2: Assemble `DashboardView.tsx` binding KPI metrics, time-series visualizations, category donuts, and quick-restock watchlists.
- Task 5.3: Assemble `InventoryView.tsx` incorporating inventory analytics cards, search bars, batch operations, and modification drawers.
- Task 5.4: Assemble `SalesView.tsx` pairing aggregate sales volume trackers with searchable orders datatables and drawer modals.
- Task 5.5: Validate all touch targets (minimum 44x44px), zero horizontal overflow, and layout integrity across screen widths: 360px, 390px, 430px, 768px, and 1440px.