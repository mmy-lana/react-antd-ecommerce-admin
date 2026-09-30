/**
 * Offline-first persistence for the commerce admin console.
 *
 * Storage rules enforced here:
 *  - every table is keyed by a UUID string, declared through `EntityTable<T, 'id'>`
 *    so inserts are type-checked against the domain schema;
 *  - every `createdAt` / `updatedAt` / `timestamp` is an ISO 8601 **UTC** string,
 *    which keeps IndexedDB key ordering identical to chronological ordering;
 *  - products are soft-deleted (`isArchived` + `deletedAt`), never hard-deleted.
 */

import Dexie, { type EntityTable } from 'dexie';

import type { InventoryLog, Order, Product } from '../types';

export const DATABASE_NAME = 'CommerceAdminDB';

/** Typed handle passed to every hook and transaction in the application. */
export type CommerceDatabase = Dexie & {
  products: EntityTable<Product, 'id'>;
  orders: EntityTable<Order, 'id'>;
  inventoryLogs: EntityTable<InventoryLog, 'id'>;
};

/** Table names, kept in one place so bulk operations cannot drift. */
export const COMMERCE_TABLES = ['products', 'orders', 'inventoryLogs'] as const;

export type CommerceTableName = (typeof COMMERCE_TABLES)[number];

export const db = new Dexie(DATABASE_NAME) as CommerceDatabase;

/**
 * Schema v1.
 *
 * `isArchived` is deliberately **not** indexed: IndexedDB rejects booleans as
 * keys, so every record would silently vanish from that index. Soft-delete
 * queries run against the `deletedAt` ISO key instead (absent ⇒ still active)
 * or filter the boolean in the query layer.
 */
db.version(1).stores({
  products: 'id, sku, category, brand, status, totalStock, deletedAt, updatedAt',
  orders: 'id, orderNumber, status, createdAt, totalAmount',
  inventoryLogs: 'id, productId, variantId, scope, changeType, timestamp',
});

/**
 * Resolves once the database is open and upgraded. Await this before the first
 * query so callers never observe a transient `DatabaseClosedError` during boot.
 */
export const databaseReady: Promise<void> = db.open().then(() => undefined);

/** Empties every table inside a single read-write transaction. */
export const clearAllTables = async (): Promise<void> => {
  await db.transaction('rw', db.products, db.orders, db.inventoryLogs, async () => {
    await Promise.all([
      db.products.clear(),
      db.orders.clear(),
      db.inventoryLogs.clear(),
    ]);
  });
};

export interface TableCounts {
  products: number;
  orders: number;
  inventoryLogs: number;
}

export const getTableCounts = async (): Promise<TableCounts> => {
  const [products, orders, inventoryLogs] = await Promise.all([
    db.products.count(),
    db.orders.count(),
    db.inventoryLogs.count(),
  ]);
  return { products, orders, inventoryLogs };
};
