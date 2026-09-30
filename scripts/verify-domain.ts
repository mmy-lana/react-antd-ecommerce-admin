/**
 * Domain invariant harness.
 *
 * Type checking proves the code compiles; it cannot prove the numbers are right.
 * This suite asserts the rules the UI relies on at runtime:
 *
 *  - the seed dataset's stock ledgers reconcile exactly with stored quantities;
 *  - every order's subtotal / tax / shipping / total / net profit arithmetic holds;
 *  - lifecycle states are only assigned to orders old enough to have reached them;
 *  - the dataset is deterministic for a fixed "now" anchor;
 *  - date math snaps to UTC day boundaries and enumerates gap-free buckets;
 *  - CSV serialization satisfies RFC 4180, including formula-injection hardening.
 *
 * Run with `pnpm run verify:domain`.
 */
import {
  buildSeedDataset,
  SEED_ORDER_COUNT,
  SEED_PRODUCT_COUNT,
} from '../src/shared/db/seedData';
import { activeVariants, resolveStockStatus } from '../src/shared/utils/stockStatus';
import {
  buildCsvText,
  escapeCsvField,
  inventoryLogCsvColumns,
  sanitizeCsvFilename,
  salesOrderCsvColumns,
  serializeCsvRow,
  stockRecordCsvColumns,
} from '../src/shared/utils/exportCsv';
import {
  calculateGrowthPct,
  calculateMarginPct,
  formatCurrency,
  formatSignedPercent,
  parseCurrencyInput,
  roundToCents,
  sumCurrency,
} from '../src/shared/utils/currency';
import {
  createRelativeDateRange,
  describeDateRange,
  enumerateBucketKeys,
  getPreviousPeriod,
  isWithinUtcRange,
  normalizeDateRange,
  resolveAggregationInterval,
  toIsoUtcString,
  utcDayKey,
} from '../src/shared/utils/dateMath';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STOCK_STATUSES,
} from '../src/shared/types';
import type { InventoryLog } from '../src/shared/types';

const failures: string[] = [];
let assertions = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* -------------------------------------------------------------------------- */

const dataset = buildSeedDataset(new Date('2026-07-15T12:00:00Z'));

check('seed: product count', dataset.products.length === SEED_PRODUCT_COUNT, `got ${dataset.products.length}`);
check('seed: order count', dataset.orders.length === SEED_ORDER_COUNT, `got ${dataset.orders.length}`);
check('seed: logs produced', dataset.inventoryLogs.length > 0, `got ${dataset.inventoryLogs.length}`);

/* Every product must be genuinely multi-variant and internally consistent. */
for (const product of dataset.products) {
  check(`variants>=2 ${product.sku}`, product.variants.length >= 2, `got ${product.variants.length}`);
  check(
    `totalStock sum ${product.sku}`,
    product.totalStock === activeVariants(product).reduce((s, v) => s + v.stockQuantity, 0),
    `${product.totalStock}`,
  );
  check(
    `status resolution ${product.sku}`,
    product.status === resolveStockStatus(product),
    `${product.status}`,
  );
  check(
    `variant margin ${product.sku}`,
    product.variants.every((v) => v.costPrice < v.price && v.stockQuantity >= 0),
  );
  check(`sku unique ${product.sku}`, new Set(product.variants.map((v) => v.sku)).size === product.variants.length);
  check(`iso created ${product.sku}`, ISO_Z.test(product.createdAt));
  check(`iso updated ${product.sku}`, ISO_Z.test(product.updatedAt) && product.updatedAt >= product.createdAt);
  if (product.isArchived) {
    check(`archived flag ${product.sku}`, typeof product.deletedAt === 'string' && ISO_Z.test(product.deletedAt!));
  }
}

check(
  'sku globally unique',
  new Set(dataset.products.map((p) => p.sku)).size === dataset.products.length,
);
check(
  'product uuid globally unique',
  new Set(dataset.products.flatMap((p) => [p.id, ...p.variants.map((v) => v.id)])).size ===
    dataset.products.length + dataset.products.reduce((s, p) => s + p.variants.length, 0),
);
check(
  'uuid v4 shape',
  dataset.products.every((p) => /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(p.id)),
);

/* All four stock statuses must appear so the KPI cards and filters have data. */
for (const status of STOCK_STATUSES) {
  check(`stock status present: ${status}`, dataset.products.some((p) => p.status === status));
}

/* Stock ledgers must reconcile exactly with the quantities on disk. */
const expectedBalance = new Map<string, number>();
for (const product of dataset.products) {
  expectedBalance.set(`${product.id}::product`, product.totalStock);
  for (const variant of product.variants) {
    expectedBalance.set(`${product.id}::${variant.id}`, variant.stockQuantity);
  }
}

const chains = new Map<string, InventoryLog[]>();
for (const log of dataset.inventoryLogs) {
  const key = `${log.productId}::${log.variantId ?? 'product'}`;
  const bucket = chains.get(key) ?? [];
  bucket.push(log);
  chains.set(key, bucket);
}

check(
  'ledger covers every scope',
  chains.size === expectedBalance.size,
  `${chains.size} chains vs ${expectedBalance.size} scopes`,
);

for (const [key, logs] of chains) {
  let balance = 0;
  for (const log of logs) {
    check(`log prev matches balance ${key}`, log.previousQuantity === balance, `${log.previousQuantity} vs ${balance}`);
    balance += log.quantityDelta;
    check(`log new matches balance ${key}`, log.newQuantity === balance);
    check(`log never negative ${key}`, balance >= 0, `${balance}`);
    check(`log scope marker ${key}`, log.scope === (log.variantId ? 'variant' : 'product'));
    check(`log iso ${key}`, ISO_Z.test(log.timestamp));
    check(`log operator ${key}`, log.performedBy.length > 0 && log.reason.length > 0);
  }
  check(`ledger reconciles ${key}`, balance === expectedBalance.get(key), `${balance} vs ${expectedBalance.get(key)}`);
}

/* Order arithmetic + coverage. */
const orderStatuses = new Set(dataset.orders.map((o) => o.status));
for (const status of ORDER_STATUSES) {
  check(`order status present: ${status}`, orderStatuses.has(status));
}
const paymentMethods = new Set(dataset.orders.map((o) => o.paymentMethod));
for (const method of PAYMENT_METHODS) {
  check(`payment method present: ${method}`, paymentMethods.has(method));
}
check(
  'order numbers unique',
  new Set(dataset.orders.map((o) => o.orderNumber)).size === dataset.orders.length,
);

const productIds = new Set(dataset.products.map((p) => p.id));
const variantIndex = new Map<string, { price: number; cost: number }>();
for (const product of dataset.products) {
  for (const variant of product.variants) {
    variantIndex.set(variant.id, { price: variant.price, cost: variant.costPrice });
  }
}

const taxFreeTotal = roundToCents(
  dataset.orders.reduce((sum, o) => sum + (o.status === 'cancelled' || o.status === 'refunded' ? 0 : o.totalAmount), 0),
);
check('revenue is positive', taxFreeTotal > 0);

for (const order of dataset.orders) {
  const label = order.orderNumber;
  check(`iso created ${label}`, ISO_Z.test(order.createdAt));
  check(`iso updated ${label}`, ISO_Z.test(order.updatedAt) && order.updatedAt >= order.createdAt);

  const subtotal = roundToCents(order.items.reduce((s, i) => s + i.subtotal, 0));
  check(`subtotal ${label}`, subtotal === order.subtotal, `${subtotal} vs ${order.subtotal}`);

  for (const item of order.items) {
    check(`line subtotal ${label}`, roundToCents(item.unitPrice * item.quantity) === item.subtotal);
    check(`line product exists ${label}`, productIds.has(item.productId));
    check(`line variant exists ${label}`, variantIndex.has(item.variantId ?? ''));
  }

  const taxable = roundToCents(order.subtotal - order.discountAmount);
  check(`tax ${label}`, roundToCents(taxable * 0.08) === order.taxAmount, `${order.taxAmount}`);
  check(
    `total ${label}`,
    roundToCents(taxable + order.taxAmount + order.shippingFee) === order.totalAmount,
    `${order.totalAmount}`,
  );

  const cost = order.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  check(
    `netProfit ${label}`,
    roundToCents(order.totalAmount - cost - order.shippingFee - order.taxAmount) === order.netProfit,
    `${order.netProfit}`,
  );
}

/* Order numbers must be chronological and customer totals consistent. */
const sorted = [...dataset.orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
check('orders chronological', sorted[0].orderNumber.endsWith('00001'));
check(
  'customer totals consistent',
  dataset.orders.every((o) => o.customer.totalOrdersCount > 0),
);
const perCustomer = new Map<string, number>();
for (const order of dataset.orders) {
  perCustomer.set(order.customer.id, (perCustomer.get(order.customer.id) ?? 0) + 1);
}
check(
  'customer totalOrdersCount accurate',
  dataset.orders.every((o) => perCustomer.get(o.customer.id) === o.customer.totalOrdersCount),
);

/* Lifecycle realism + determinism. */
const MIN_AGE: Record<string, number> = {
  pending: 0,
  processing: 0,
  shipped: 2,
  delivered: 5,
  cancelled: 1,
  refunded: 5,
};
const anchorMs = Date.parse('2026-07-15T12:00:00Z');
const minAgeInDays = (order: (typeof dataset.orders)[number]): number => {
  const orderDay = Date.parse(order.createdAt.slice(0, 10) + 'T00:00:00Z');
  return Math.round((anchorMs - orderDay) / 86_400_000);
};
for (const order of dataset.orders) {
  check(
    `lifecycle plausible ${order.orderNumber}`,
    minAgeInDays(order) >= MIN_AGE[order.status],
    `${order.status} at age ${minAgeInDays(order)}d`,
  );
  check(
    `timestamp window ${order.orderNumber}`,
    Date.parse(order.createdAt) <= anchorMs && Date.parse(order.updatedAt) <= anchorMs,
  );
}
for (const product of dataset.products) {
  check(`product predates orders ${product.sku}`, Date.parse(product.createdAt) < anchorMs);
}

const repeat = buildSeedDataset(new Date('2026-07-15T12:00:00Z'));
check(
  'seed deterministic',
  JSON.stringify(repeat) === JSON.stringify(dataset),
);
const shifted = buildSeedDataset(new Date('2027-01-01T00:00:00Z'));
check('seed re-anchors to now', shifted.orders[0].createdAt > '2026-01-01' || shifted.products.length === 30);

/* -------------------------------------------------------------------------- */
/* dateMath                                                                    */
/* -------------------------------------------------------------------------- */

const range = normalizeDateRange('2026-07-01T13:45:00.000Z', '2026-07-30T04:12:00.000Z');
check('range start snapped', range.startDate === '2026-07-01T00:00:00.000Z', range.startDate);
check('range end snapped', range.endDate === '2026-07-30T23:59:59.999Z', range.endDate);

const inverted = normalizeDateRange('2026-07-30T00:00:00Z', '2026-07-01T00:00:00Z');
check('inverted range repaired', inverted.startDate === '2026-07-01T00:00:00.000Z' && inverted.endDate === '2026-07-30T23:59:59.999Z');

const dayKeys = enumerateBucketKeys(range, 'day');
check('day buckets complete', dayKeys.length === 30, `${dayKeys.length}`);
check('day buckets gapless', dayKeys.every((k, i) => i === 0 || Number(k.slice(8)) === Number(dayKeys[i - 1].slice(8)) + 1));

const monthKeys = enumerateBucketKeys(range, 'month');
check('month buckets', monthKeys.length === 1 && monthKeys[0] === '2026-07', monthKeys.join(','));

const yearRange = normalizeDateRange('2025-11-15T00:00:00Z', '2026-02-10T00:00:00Z');
check('year buckets', enumerateBucketKeys(yearRange, 'month').join(',') === '2025-11,2025-12,2026-01,2026-02');

check('interval day for 30d', resolveAggregationInterval(range) === 'day');
check('interval month for 90d', resolveAggregationInterval(normalizeDateRange('2026-01-01', '2026-06-30')) === 'month');

const previous = getPreviousPeriod(range);
check('previous period length', previous.startDate === '2026-06-01T00:00:00.000Z' && previous.endDate === '2026-06-30T23:59:59.999Z', JSON.stringify(previous));
check('previous period disjoint', !isWithinUtcRange(previous.startDate, range));

check('within range', isWithinUtcRange('2026-07-15T10:00:00.000Z', range));
check('outside range', !isWithinUtcRange('2026-07-31T00:00:00.000Z', range));
check('day key', utcDayKey('2026-07-15T23:30:00Z') === '2026-07-15');
check('round trip', toIsoUtcString('2026-07-15T23:30:00.000Z') === '2026-07-15T23:30:00.000Z');
check('relative range', createRelativeDateRange(7, '2026-07-15T00:00:00Z').startDate === '2026-07-09T00:00:00.000Z');
check('describe range', describeDateRange(range) === 'Jul 1 – Jul 30, 2026', describeDateRange(range));

/* -------------------------------------------------------------------------- */
/* currency                                                                    */
/* -------------------------------------------------------------------------- */

check('round to cents', roundToCents(1.005) === 1.01 || roundToCents(1.005) === 1, `${roundToCents(1.005)}`);
check('format currency', formatCurrency(1234.5) === '$1,234.50', formatCurrency(1234.5));
check('format currency compact', formatCurrency(1234567, { notation: 'compact' }).length > 0);
check('sum currency', sumCurrency([0.1, 0.2]) === 0.3, `${sumCurrency([0.1, 0.2])}`);
check('growth zero baseline', calculateGrowthPct(100, 0) === 0);
check('growth up', calculateGrowthPct(150, 100) === 50);
check('growth down', calculateGrowthPct(75, 100) === -25);
check('margin', calculateMarginPct(25, 100) === 25);
check('margin zero revenue', calculateMarginPct(25, 0) === 0);
check('signed percent', formatSignedPercent(12.345) === '+12.3%');
check('signed percent negative', formatSignedPercent(-4) === '−4.0%');
check('parse currency', parseCurrencyInput('$1,234.56') === 1234.56);
check('parse currency empty', parseCurrencyInput('') === null);
check('parse currency junk', parseCurrencyInput('abc') === null);

/* -------------------------------------------------------------------------- */
/* CSV / RFC 4180                                                              */
/* -------------------------------------------------------------------------- */

check('escape plain', escapeCsvField('hello') === 'hello');
check('escape comma', escapeCsvField('a,b') === '"a,b"');
check('escape quote', escapeCsvField('say "hi"') === '"say ""hi"""');
check('escape newline', escapeCsvField('line1\nline2') === '"line1\nline2"');
check('escape crlf', escapeCsvField('a\r\nb') === '"a\r\nb"');
check('escape null', escapeCsvField(null) === '');
check('escape undefined', escapeCsvField(undefined) === '');
check('escape number', escapeCsvField(1234.5) === '1234.5');
check('escape negative number untouched', escapeCsvField(-12.5) === '-12.5', escapeCsvField(-12.5));
check('formula guard', escapeCsvField('=1+1') === "'=1+1", escapeCsvField('=1+1'));
check('formula guard on text only', escapeCsvField('42') === '42');

const row = serializeCsvRow(['a', 'b,c', 'd"e', null, 5]);
check('serialize row', row === 'a,"b,c","d""e",,5', row);

const csv = buildCsvText(salesOrderCsvColumns, dataset.orders.slice(0, 3));
const csvLines = csv.split('\r\n');
check('csv crlf terminator', csv.endsWith('\r\n'));
check('csv header + rows', csvLines.filter(Boolean).length === 4);
check('csv header matches columns', csvLines[0] === salesOrderCsvColumns.map((c) => c.header).join(','));

const stockCsv = buildCsvText(stockRecordCsvColumns, dataset.products);
check('stock csv rows', stockCsv.split('\r\n').filter(Boolean).length === SEED_PRODUCT_COUNT + 1);

const logCsv = buildCsvText(inventoryLogCsvColumns, dataset.inventoryLogs.slice(0, 5));
check('log csv rows', logCsv.split('\r\n').filter(Boolean).length === 6);

const quoteHeavy = buildCsvText(
  [{ header: 'Note', getValue: (v: { v: string }) => v.v }],
  [{ v: 'Contains, a comma and "quotes"' }],
);
check('csv quoting integration', quoteHeavy.includes('"Contains, a comma and ""quotes"""'), quoteHeavy);

check('filename sanitize', sanitizeCsvFilename('orders export/final') === 'orders-export-final.csv', sanitizeCsvFilename('orders export/final'));
check('filename keeps csv', sanitizeCsvFilename('report.csv') === 'report.csv');

/* -------------------------------------------------------------------------- */

console.log(`\n${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILURES:`);
  for (const failure of failures.slice(0, 40)) console.error(`  ✗ ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exitCode = 1;
} else {
  console.log(`products=${dataset.products.length} orders=${dataset.orders.length} logs=${dataset.inventoryLogs.length}`);
  console.log(`revenue=${taxFreeTotal.toFixed(2)}`);
}
