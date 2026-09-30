/**
 * IndexedDB storage verification.
 *
 * The polyfill must be installed *before* `dexieDb` is evaluated, because that
 * module opens the database at module scope. Top-level `await import()` makes
 * that ordering explicit and immune to bundler chunk hoisting — a static
 * `import 'fake-indexeddb/auto'` gets reordered once Rollup shares `dexieDb`
 * between the two verification entries.
 *
 * These assertions cover what no type checker can — that the declared schema
 * string is valid, that the transactional seed writes and clears cleanly, and
 * that the soft-delete index behaves as designed.
 *
 * Run with `pnpm run verify:domain`.
 */
export {};

await import('fake-indexeddb/auto');

const { db, clearAllTables, databaseReady, getTableCounts } = await import('../src/shared/db/dexieDb');
const { isDatabaseSeeded, resetAndSeedDatabase, seedDatabase, seedDatabaseIfEmpty } =
  await import('../src/shared/db/seedData');
const { activeVariants } = await import('../src/shared/utils/stockStatus');

const failures: string[] = [];
let assertions = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const ANCHOR = new Date('2026-07-15T12:00:00Z');

const run = async (): Promise<void> => {
  await databaseReady;
  check('database opens', db.isOpen());

  await clearAllTables();
  check('store starts empty', (await getTableCounts()).products === 0);
  check('isDatabaseSeeded false when empty', (await isDatabaseSeeded()) === false);

  const summary = await seedDatabase(ANCHOR);
  check('seed wrote 30 products', summary.products === 30, `${summary.products}`);
  check('seed wrote 100 orders', summary.orders === 100, `${summary.orders}`);
  check('seed wrote logs', summary.inventoryLogs > 0, `${summary.inventoryLogs}`);

  const counts = await getTableCounts();
  check('counts.products', counts.products === 30, `${counts.products}`);
  check('counts.orders', counts.orders === 100, `${counts.orders}`);
  check('counts.inventoryLogs', counts.inventoryLogs === summary.inventoryLogs);

  check('isDatabaseSeeded true after seed', (await isDatabaseSeeded()) === true);
  check('seedDatabaseIfEmpty is a no-op', (await seedDatabaseIfEmpty(ANCHOR)) === null);

  /* Declared indexes must be queryable. */
  const delivered = await db.orders.where('status').equals('delivered').count();
  check('orders.status index', delivered > 0 && delivered < 100, `${delivered}`);

  const audioProducts = await db.products.where('category').equals('Audio').count();
  check('products.category index', audioProducts === 5, `${audioProducts}`);

  const variantLogs = await db.inventoryLogs.where('scope').equals('variant').count();
  const productLogs = await db.inventoryLogs.where('scope').equals('product').count();
  check('inventoryLogs.scope index', variantLogs > 0 && productLogs > 0, `${variantLogs}/${productLogs}`);
  check(
    'every log is addressable by scope',
    variantLogs + productLogs === counts.inventoryLogs,
    `${variantLogs + productLogs} vs ${counts.inventoryLogs}`,
  );
  check(
    'each product has an opening balance log',
    productLogs >= 30,
    `${productLogs}`,
  );

  const byChangeType = await db.inventoryLogs.where('changeType').equals('restock').count();
  check('inventoryLogs.changeType index', byChangeType > 0, `${byChangeType}`);

  const recentOrders = await db.orders
    .where('createdAt')
    .aboveOrEqual('2026-06-15T00:00:00.000Z')
    .count();
  check('orders.createdAt index', recentOrders > 0, `${recentOrders}`);

  const orderedByAmount = await db.orders.orderBy('totalAmount').first();
  check(
    'orders.totalAmount ordering',
    orderedByAmount !== undefined && orderedByAmount.totalAmount > 0,
  );

  const skuLookup = await db.products.where('sku').equals('AUR-AU-0001').first();
  check('products.sku index', skuLookup !== undefined && skuLookup.name === 'Aurora Wireless Headphones');

  /* Soft delete: `isArchived` is a boolean and therefore cannot be indexed. */
  const archivedProducts = await db.products.filter((p) => p.isArchived).toArray();
  check('two soft-deleted products', archivedProducts.length === 2, `${archivedProducts.length}`);
  check(
    'archived products carry deletedAt',
    archivedProducts.every((p) => typeof p.deletedAt === 'string'),
  );
  check(
    'active products omit deletedAt',
    (await db.products.filter((p) => p.deletedAt === undefined).count()) === 28,
  );

  // Proves the boolean was deliberately left out of the index: only rows with a
  // real string key can ever appear, so the index is an exact "archived" set.
  const deletedAtIndexHits = await db.products.where('deletedAt').below('9999-12-31T23:59:59.999Z').count();
  check('deletedAt index holds only archived rows', deletedAtIndexHits === 2, `${deletedAtIndexHits}`);

  /* Round-trip fidelity. */
  const [firstProduct] = await db.products.toCollection().sortBy('sku');
  const stored = firstProduct ? await db.products.get(firstProduct.id) : undefined;
  check(
    'product round-trip preserves variants',
    stored !== undefined && stored.variants.length >= 2 && Array.isArray(stored.tags),
  );
  check(
    'variant stocks survive the write',
    stored !== undefined &&
      stored.totalStock === activeVariants(stored).reduce((sum, v) => sum + v.stockQuantity, 0),
  );

  const sampleOrder = await db.orders.orderBy('createdAt').last();
  check(
    'order round-trip preserves line items',
    sampleOrder !== undefined && sampleOrder.items.length > 0 && sampleOrder.customer.email.includes('@'),
  );
  const allOrders = await db.orders.toArray();
  check(
    'order numbers are unique in storage',
    allOrders.length === new Set(allOrders.map((o) => o.orderNumber)).size,
  );

  /* Reset path used by the "restore demo data" action. */
  const reseeded = await resetAndSeedDatabase(ANCHOR);
  check('resetAndSeedDatabase rewrites', reseeded.products === 30 && reseeded.orders === 100);
  check('reset leaves no duplicates', (await getTableCounts()).products === 30);

  await clearAllTables();
  const finalCounts = await getTableCounts();
  check(
    'clearAllTables empties every table',
    finalCounts.products === 0 && finalCounts.orders === 0 && finalCounts.inventoryLogs === 0,
  );

  /* Errors must surface as rejected promises, not silent no-ops. */
  await seedDatabase(ANCHOR);
  let duplicateRejected = false;
  try {
    await seedDatabase(ANCHOR);
  } catch {
    duplicateRejected = true;
  }
  check('duplicate primary keys are rejected', duplicateRejected);

  console.log(`\n[storage] ${assertions - failures.length}/${assertions} assertions passed`);
  if (failures.length > 0) {
    console.error(`\n[storage] ${failures.length} FAILURES:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
};

void run().catch((error: unknown) => {
  console.error('[storage] harness crashed:', error);
  process.exitCode = 1;
});
