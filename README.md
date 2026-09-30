# E-Commerce Admin Inventory & Sales Dashboard

A high-fidelity, offline-first e-commerce analytics suite and inventory management system built with React, Ant Design, TypeScript, and Dexie.js (IndexedDB).

- Live Demo: [https://react-antd-ecommerce-admin.vercel.app](https://react-antd-ecommerce-admin.vercel.app)
- Repository: [https://github.com/mmy-lana/react-antd-ecommerce-admin](https://github.com/mmy-lana/react-antd-ecommerce-admin)

---

## Key Features

- **Offline-First Storage Engine**: Powered by IndexedDB via Dexie.js with persistent versioned schemas, atomic transactions, and reactive table queries via `dexie-react-hooks`.
- **Comprehensive Financial Intelligence**: Real-time GMV, Net Profit, Profit Margin, and Average Order Value (AOV) calculated using signed magnitude-relative epsilon rounding.
- **Inventory Management**:
  - Multi-variant SKU tracking with safety stock thresholds.
  - Dynamic status resolution (`in_stock`, `low_stock`, `out_of_stock`, `discontinued`).
  - Transaction-safe inventory adjustments with audit logs preventing negative stock.
  - Atomic batch restock and soft-delete operations.
- **Order Lifecycle & Compensating Transactions**:
  - Directed state machine enforcing strict lifecycle transitions (`pending` -> `processing` -> `shipped` -> `delivered`).
  - Automatic compensating inventory restock logs when transitioning to `cancelled` or `refunded`.
- **Advanced Data Visualizations**:
  - Interactive revenue and net profit time-series area charts built with `@ant-design/plots`.
  - Category sales breakdown donut charts with full legend attribute visibility.
  - Multi-condition filtering across date ranges (UTC day boundaries), categories, and order statuses.
- **Responsive & Accessible Design**:
  - Mobile-first layouts validated across viewports: 360px, 390px, 430px, 768px, and 1440px.
  - Minimum 44x44px touch targets on interactive elements (WCAG 2.1 AA).
  - Semantic ARIA roles on virtualized tables and screen-reader announcements on non-recognized revenue.
- **Export Capabilities**: RFC 4180-compliant client-side CSV exports hardened against formula injection.

---

## Tech Stack

- **Framework**: React (latest)
- **UI Library**: Ant Design (`antd`, `@ant-design/icons`)
- **Data Visualization**: `@ant-design/plots`
- **Persistence**: Dexie.js (`dexie`, `dexie-react-hooks`)
- **Date Utilities**: `dayjs` (UTC, ISO week, and relative time plugins)
- **Tooling**: Vite, TypeScript
- **Testing**: Playwright (isolated headless browser verification), custom SSR domain test harness

---

## Project Structure

```
src/
├── app/
│   ├── App.tsx                      # Root composition and error boundary wrappers
│   ├── Router.tsx                   # Hash-based routing and deep-link query parser
│   └── theme/                       # Ant Design design tokens and theme overrides
├── features/
│   ├── dashboard/                   # KPI grid, time-series charts, category donuts
│   ├── inventory/                   # Product tables, adjustment modals, form drawers
│   └── sales/                       # Orders table, date range pickers, detail drawers
└── shared/
    ├── components/
    │   ├── feedback/                # Empty states, error boundaries, skeleton loaders
    │   ├── layout/                  # Desktop sidebar, mobile nav drawer, header bar
    │   ├── primitives/              # Metric cards, status badges, responsive containers
    │   └── table/                   # Virtual table ARIA semantics
    ├── db/                          # Dexie database configuration and deterministic seeder
    ├── hooks/                       # Responsive navigation and viewport hooks
    ├── types/                       # Pure TypeScript domain models and state machines
    └── utils/                       # Financial math, UTC date helpers, CSV generator
```

---

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- `pnpm` (strictly required)

### Installation

```bash
pnpm install
```

### Development Server

Start the local Vite development server:

```bash
pnpm run dev
```

The application will be available at `http://localhost:3000`.

### Production Build

Compile TypeScript and build the static assets:

```bash
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

---

## Verification & Testing

The repository contains an automated multi-tier verification harness covering domain logic, storage integrity, layout metrics, and browser rendering.

### Domain Invariants & SSR Component Suite

Runs typechecking, storage migrations, arithmetic rounding validations, and component markup tests:

```bash
pnpm run verify:domain
```

### Headless Browser End-to-End Suite

Executes automated Playwright tests in headless Chromium to assert layout integrity, zero console errors, zero Ant Design deprecation warnings, responsive drawer behaviors, and element bounding boxes across mobile and desktop viewports:

```bash
pnpm run verify:e2e
```

### Full Verification Pipeline

Execute all test suites sequentially:

```bash
pnpm run verify
```

---

## Business Logic & State Rules

1. **Revenue Recognition**:
   - Only orders with status `pending`, `processing`, `shipped`, or `delivered` contribute to GMV and Net Profit.
   - Orders marked `cancelled` or `refunded` are excluded from revenue and visually struck through.
2. **Atomic Stock Updates**:
   - All manual stock modifications, batch actions, and order cancellations execute inside an isolated `db.transaction('rw', db.products, db.inventoryLogs, ...)` block.
   - Total product stock is dynamically recomputed from active (non-archived) variants and validated against negative thresholds prior to committing.
3. **UTC Normalization**:
   - All dates are serialized as ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
   - Time-series buckets snap to UTC boundaries, eliminating local timezone drift.

---

## License

MIT
