/**
 * Client-side CSV generation, RFC 4180 compliant.
 *
 * RFC 4180 rules enforced here:
 *  - fields containing `"`, `,`, CR or LF are wrapped in double quotes;
 *  - an embedded `"` is escaped by doubling it;
 *  - records are terminated with CRLF (`\r\n`), including the final record;
 *  - the header record names every column in order.
 *
 * One extra hardening step beyond the spec: Excel and Sheets treat a leading
 * `=`, `+`, `-` or `@` in a *text* field as a formula. Those values are
 * prefixed with an apostrophe so an exported product name can never execute.
 * Numeric cells are exempt — a negative amount must stay negative — and the
 * exemption is decided by {@link needsFormulaGuard} rather than by the field's
 * JS type, because formatted money is a string that must still be treated as a
 * number.
 */

import type { InventoryLog, Order, Product } from '../types';
import {
  INVENTORY_CHANGE_TYPE_LABEL,
  INVENTORY_SCOPE_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  STOCK_STATUS_LABEL,
} from '../types';
import { formatCurrency, roundToCents } from './currency';
import { utcDayKey } from './dateMath';

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  /** Column title written into the header record. */
  header: string;
  getValue: (row: T) => CsvCell;
}

export interface CsvDocument<T> {
  /** Written without extension; `.csv` and a UTC day stamp are appended. */
  filename: string;
  columns: readonly CsvColumn<T>[];
  rows: readonly T[];
  /** Prepends a UTF-8 BOM so Excel detects the encoding. Defaults to `true`. */
  includeBom?: boolean;
}

const CRLF = '\r\n';
const UTF8_BOM = '\uFEFF';
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const ILLEGAL_FILENAME_CHARS = /[^a-zA-Z0-9._-]+/g;

/**
 * A field the spreadsheet would read as a number on its own.
 *
 * Covers an optional sign, an optional accounting/currency bracket, a currency
 * symbol, digit groups with separators, an optional decimal tail and a trailing
 * percent. This is what separates "a negative amount that must stay negative"
 * from "a text field that happens to start with a dash".
 */
const NUMERIC_CELL = /^[+-]?\(?\s*(?:[$£€¥₹]\s?)?\d[\d,]*(?:\.\d+)?\s*\)?%?$/;

/**
 * Whether a field needs the apostrophe guard.
 *
 * A leading `=`, `+`, `-`, `@`, tab or carriage return only triggers a formula
 * in a *text* cell. Applying the guard to anything numeric was the original
 * defect: `formatCurrency(-10)` yields the string `-$10.00`, which was being
 * written as `'-$10.00`. That both corrupts the figure and forces the column to
 * text in Excel, so a negative discount or a stock movement reversed the wrong
 * way exported as a string that no longer sums.
 */
export const needsFormulaGuard = (value: string): boolean => {
  if (!FORMULA_TRIGGER.test(value)) return false;
  return !NUMERIC_CELL.test(value.trim());
};

/* -------------------------------------------------------------------------- */
/* Field + record serialization                                               */
/* -------------------------------------------------------------------------- */

export const escapeCsvField = (value: CsvCell): string => {
  if (value === null || value === undefined) return '';

  const raw =
    typeof value === 'string'
      ? needsFormulaGuard(value)
        ? `'${value}`
        : value
      : String(value);

  const needsQuoting =
    raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r');

  return needsQuoting ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const serializeCsvRow = (cells: readonly CsvCell[]): string =>
  cells.map(escapeCsvField).join(',');

/** Full document text including the header record and the trailing CRLF. */
export const buildCsvText = <T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string => {
  const header = serializeCsvRow(columns.map((column) => column.header));
  const body = rows.map((row) => serializeCsvRow(columns.map((column) => column.getValue(row))));
  return `${[header, ...body].join(CRLF)}${CRLF}`;
};

export const createCsvBlob = <T>(document: CsvDocument<T>): Blob => {
  const prefix = document.includeBom === false ? '' : UTF8_BOM;
  // `text/csv;charset=utf-8` is required for the BOM to be interpreted correctly.
  return new Blob([prefix, buildCsvText(document.columns, document.rows)], {
    type: 'text/csv;charset=utf-8',
  });
};

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

export const sanitizeCsvFilename = (filename: string): string => {
  const withExtension = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  const cleaned = withExtension.replace(ILLEGAL_FILENAME_CHARS, '-').replace(/-+/g, '-');
  const normalized = cleaned.replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'export.csv';
};

/** `orders-export-2026-07-14.csv` — UTC stamped so downloads sort predictably. */
export const buildTimestampedFilename = (baseName: string, now?: Date): string =>
  sanitizeCsvFilename(`${baseName}-${utcDayKey(now ?? new Date())}`);

/**
 * Triggers a browser download for the supplied document. The object URL is
 * revoked on the next macrotask, after the download has been handed to the UA.
 */
export const downloadCsvDocument = <T>(document: CsvDocument<T>): void => {
  const blob = createCsvBlob(document);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = buildTimestampedFilename(document.filename);
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

/** Convenience wrapper used by the toolbar export buttons. */
export const exportRowsToCsv = <T>(document: CsvDocument<T>): void => {
  downloadCsvDocument(document);
};

/* -------------------------------------------------------------------------- */
/* Domain column sets                                                          */
/* -------------------------------------------------------------------------- */

export const salesOrderCsvColumns: readonly CsvColumn<Order>[] = [
  { header: 'Order Number', getValue: (order) => order.orderNumber },
  { header: 'Status', getValue: (order) => ORDER_STATUS_LABEL[order.status] },
  { header: 'Payment Method', getValue: (order) => PAYMENT_METHOD_LABEL[order.paymentMethod] },
  { header: 'Customer', getValue: (order) => order.customer.name },
  { header: 'Customer Email', getValue: (order) => order.customer.email },
  { header: 'Country', getValue: (order) => order.customer.country },
  { header: 'Item Lines', getValue: (order) => order.items.length },
  { header: 'Units', getValue: (order) => order.items.reduce((total, item) => total + item.quantity, 0) },
  { header: 'Subtotal', getValue: (order) => roundToCents(order.subtotal) },
  { header: 'Tax', getValue: (order) => roundToCents(order.taxAmount) },
  { header: 'Shipping', getValue: (order) => roundToCents(order.shippingFee) },
  { header: 'Discount', getValue: (order) => roundToCents(order.discountAmount) },
  { header: 'Total', getValue: (order) => roundToCents(order.totalAmount) },
  { header: 'Net Profit', getValue: (order) => roundToCents(order.netProfit) },
  { header: 'Created At (UTC)', getValue: (order) => order.createdAt },
  { header: 'Updated At (UTC)', getValue: (order) => order.updatedAt },
];

export const stockRecordCsvColumns: readonly CsvColumn<Product>[] = [
  { header: 'SKU', getValue: (product) => product.sku },
  { header: 'Product', getValue: (product) => product.name },
  { header: 'Brand', getValue: (product) => product.brand },
  { header: 'Category', getValue: (product) => product.category },
  { header: 'Status', getValue: (product) => STOCK_STATUS_LABEL[product.status] },
  { header: 'Variant Count', getValue: (product) => product.variants.filter((v) => !v.isArchived).length },
  { header: 'Total Stock', getValue: (product) => product.totalStock },
  { header: 'Safety Threshold', getValue: (product) => product.safetyStockThreshold },
  {
    header: 'Archived Variants',
    getValue: (product) =>
      product.variants
        .filter((variant) => variant.isArchived)
        .map((variant) => variant.sku)
        .join(' '),
  },
  { header: 'Base Price', getValue: (product) => roundToCents(product.basePrice) },
  { header: 'Base Cost', getValue: (product) => roundToCents(product.baseCost) },
  { header: 'Stock Value', getValue: (product) => roundToCents(product.totalStock * product.basePrice) },
  { header: 'Archived', getValue: (product) => (product.isArchived ? 'Yes' : 'No') },
  { header: 'Tags', getValue: (product) => product.tags.join(' ') },
  { header: 'Updated At (UTC)', getValue: (product) => product.updatedAt },
];

export const inventoryLogCsvColumns: readonly CsvColumn<InventoryLog>[] = [
  { header: 'Logged At (UTC)', getValue: (log) => log.timestamp },
  { header: 'Scope', getValue: (log) => INVENTORY_SCOPE_LABEL[log.scope] },
  { header: 'Change Type', getValue: (log) => INVENTORY_CHANGE_TYPE_LABEL[log.changeType] },
  { header: 'Product ID', getValue: (log) => log.productId },
  { header: 'Variant ID', getValue: (log) => log.variantId ?? '' },
  { header: 'Delta', getValue: (log) => log.quantityDelta },
  { header: 'Previous Quantity', getValue: (log) => log.previousQuantity },
  { header: 'New Quantity', getValue: (log) => log.newQuantity },
  { header: 'Reason', getValue: (log) => log.reason },
  { header: 'Performed By', getValue: (log) => log.performedBy },
];

export const stockMovementCsvColumns: readonly CsvColumn<InventoryLog>[] = [
  { header: 'Reference', getValue: (log) => `${log.productId.slice(0, 8)}/${(log.variantId ?? 'product').slice(0, 8)}` },
  { header: 'Net Movement', getValue: (log) => log.quantityDelta },
  { header: 'Balance After', getValue: (log) => log.newQuantity },
  {
    header: 'Direction',
    getValue: (log) => (log.quantityDelta > 0 ? 'Increase' : log.quantityDelta < 0 ? 'Decrease' : 'No change'),
  },
  { header: 'Type', getValue: (log) => INVENTORY_CHANGE_TYPE_LABEL[log.changeType] },
  { header: 'Value Impact', getValue: (log) => formatCurrency(log.quantityDelta) },
];
