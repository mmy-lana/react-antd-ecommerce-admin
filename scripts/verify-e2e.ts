/**
 * Headless browser verification (plan Task 5.5).
 *
 * The Node suites render components through `renderToStaticMarkup`, which cannot
 * observe the things that actually break a browser session: an IndexedDB schema
 * that rejects its first query, a portal that never mounts, a layout that
 * overflows horizontally. This suite drives the real production bundle in
 * Chromium and fails on any console error, page exception, or Ant Design
 * deprecation warning.
 *
 * It exits non-zero on the first failing assertion class so CI reports the
 * cause rather than a wall of noise.
 */

import { preview, type PreviewServer } from 'vite';
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

let assertions = 0;
const failures: string[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const deprecationWarnings: string[] = [];

const check = (label: string, passed: boolean, detail?: string): void => {
  assertions += 1;
  if (!passed) {
    failures.push(detail === undefined ? label : `${label} — ${detail}`);
    console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};

const section = (title: string): void => {
  console.log(`\n${title}`);
};

/** Ant Design routes deprecations through `console.error` with this shape. */
const DEPRECATION_MARKERS = [
  /\[antd: Drawer\].*'width' is deprecated/i,
  /\[antd: [^\]]+\].*deprecated/i,
];

const observeConsole = (message: ConsoleMessage): void => {
  if (message.type() !== 'error' && message.type() !== 'warning') return;

  const text = message.text();

  // React logs a recoverable error boundary catch as console.error. The suite
  // asserts the fallback never renders, so these must not appear at all.
  for (const marker of DEPRECATION_MARKERS) {
    if (marker.test(text)) deprecationWarnings.push(text);
  }

  if (/SchemaError|KeyPath .* is not indexed/i.test(text)) {
    consoleErrors.push(text);
    return;
  }

  if (message.type() === 'error') consoleErrors.push(text);
};

const observePageError = (error: Error): void => {
  // The stack matters: a bare "cannot read properties of undefined" in a
  // bundled production build is otherwise unactionable.
  const frame = (error.stack ?? '').split('\n').find((line) => line.includes('/assets/') || line.includes('webpack'));
  pageErrors.push(`${error.name}: ${error.message}${frame === undefined ? '' : ` @ ${frame.trim()}`}`);
};

const attach = (page: Page): void => {
  page.on('console', observeConsole);
  page.on('pageerror', observePageError);
};

/** Waits for the boot spinner to clear and a routed view to take over. */
const waitForApp = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Opening the local workspace'),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForSelector('#main-content', { timeout: 30_000 });
};

const goto = async (page: Page, baseUrl: string, route: string): Promise<void> => {
  await page.goto(`${baseUrl}/#/${route}`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
};

const VIEWPORTS = [
  { width: 360, height: 780, band: 'compact' },
  { width: 390, height: 844, band: 'compact' },
  { width: 430, height: 932, band: 'compact' },
  { width: 768, height: 1024, band: 'tablet' },
  { width: 1440, height: 900, band: 'desktop' },
] as const;

/* -------------------------------------------------------------------------- */
/* Checks                                                                      */
/* -------------------------------------------------------------------------- */

/** Nothing may spill sideways at any width — the plan's 5.5 requirement. */
const assertNoHorizontalOverflow = async (page: Page, width: number): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(
    `no horizontal overflow at ${width}px`,
    overflow <= 1,
    `document scrolls ${overflow}px sideways`,
  );
};

/**
 * The responsive shell switches chrome on a `resize` listener, so the DOM
 * catches up a frame or two after the viewport is resized. Waiting for the
 * expected chrome before asserting it keeps this from being a race.
 */
const waitForNavigationBand = async (page: Page, width: number): Promise<void> => {
  const expectSidebar = width >= 768;
  await page
    .waitForFunction(
      (wantSidebar) =>
        (document.querySelectorAll('nav#primary-sidebar').length === 1) === wantSidebar &&
        (document.querySelectorAll('button[aria-label="Open navigation"]').length === 1) === !wantSidebar,
      expectSidebar,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
};

const assertNavigationMatchesBand = async (page: Page, width: number): Promise<void> => {
  const sidebarVisible = await page.locator('nav#primary-sidebar').count();
  const menuButton = await page.locator('button[aria-label="Open navigation"]').count();

  // The drawer is portal-only, so below the breakpoint the only inline
  // landmark must be gone and the menu button must be present instead.
  const expectSidebar = width >= 768;
  check(
    `${expectSidebar ? 'desktop' : 'compact'} layout at ${width}px shows the correct navigation`,
    expectSidebar ? sidebarVisible === 1 && menuButton === 0 : sidebarVisible === 0 && menuButton === 1,
    `sidebar=${sidebarVisible} menuButton=${menuButton}`,
  );
};

const assertDashboardMounted = async (page: Page): Promise<void> => {
  const revenue = await page.locator('[data-testid="metric-value-Total Revenue"]').textContent();
  const orders = await page.locator('[data-testid="metric-value-Average Order Value"]').textContent();

  check('the dashboard renders a revenue KPI', revenue !== null && revenue.trim().length > 0, `got ${revenue}`);
  check(
    'the revenue KPI is populated, not zero',
    revenue !== null && /\$[\d,]/.test(revenue) && !/^\$0(\.00)?$/.test(revenue.trim()),
    `got ${revenue}`,
  );
  check('the dashboard renders a second KPI', orders !== null && orders.trim().length > 0, `got ${orders}`);
  check('the dashboard renders the restock watchlist', await page.getByText('Restock watchlist').count() > 0);
  check('the dashboard renders recent orders', await page.getByText('Recent orders').count() > 0);

  // Both charts must actually draw. A zero-size canvas renders no exception and
  // no text, so without this the dashboard could be blank and still pass.
  const charts = await page.locator('#main-content canvas').count();
  check('the dashboard renders its charts', charts >= 2, `found ${charts} canvases, expected at least 2`);
  const painted = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#main-content canvas')).filter(
      (canvas) => canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0,
    ).length,
  );
  check('the charts have non-zero dimensions', painted >= 2, `${painted} of ${charts} canvases were sized`);

  /* ---- UI-CSS-01: status badges must not stretch into vertical sausages ---- */
  {
    const badges = await page.locator('.status-badge').all();
    const boxes = await Promise.all(badges.map((badge) => badge.boundingBox()));
    const heights = boxes.map((box) => box?.height ?? Number.NaN);
    const tallest = heights.length === 0 ? Number.NaN : Math.max(...heights);
    check(
      'status badges render compact, never stretched (UI-CSS-01)',
      badges.length > 0 && heights.every((height) => height <= 30),
      `${badges.length} badges, tallest ${tallest}px, heights ${JSON.stringify(heights.slice(0, 8))}`,
    );
    check(
      'status badges are at least 20px tall so they stay legible pills',
      heights.every((height) => height >= 20),
      JSON.stringify(heights.slice(0, 8)),
    );
  }

  /* ---- UI-LAYOUT-01: the donut legend must not clip ---- */
  {
    const legend = page.locator('ul[aria-label*="Revenue by category"]');
    check('the donut legend is present', (await legend.count()) === 1, `count ${await legend.count()}`);

    // The legend is below the donut, and the donut is centred in the column.
    const stacking = await page.evaluate(() => {
      const root = document.querySelector('ul[aria-label*="Revenue by category"]')?.parentElement;
      if (!root) return null;
      return { direction: getComputedStyle(root).flexDirection, width: root.getBoundingClientRect().width };
    });
    check(
      'the donut and its legend are stacked, not side by side (UI-LAYOUT-01)',
      stacking !== null && stacking.direction === 'column',
      JSON.stringify(stacking),
    );

    // Every name and value must be inside its own row's box, with no
    // horizontal clipping or ellipsis.
    const clipped = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('ul[aria-label*="Revenue by category"] > li > button'));
      return rows
        .map((row) => {
          const rowBox = row.getBoundingClientRect();
          const parts = Array.from(row.children).filter(
            (child) => !(child.classList.contains('visually-hidden')) && getComputedStyle(child).position !== 'absolute',
          );
          const name = parts[0] as HTMLElement | undefined;
          const overflows = parts
            .filter((part) => part.getBoundingClientRect().right > rowBox.right + 0.5)
            .map((part) => (part.textContent ?? '').slice(0, 24));
          const ellipsised = name !== undefined && name.scrollWidth > name.clientWidth + 1;
          return { text: (name?.textContent ?? '').slice(0, 32), overflows, ellipsised };
        })
        .filter((entry) => entry.overflows.length > 0 || entry.ellipsised);
    });
    check(
      'every donut legend row shows its name and values without clipping (UI-LAYOUT-01)',
      clipped.length === 0,
      JSON.stringify(clipped.slice(0, 4)),
    );

    const centreCaption = await page.getByText('Product Sales', { exact: true }).count();
    check('the donut centre is captioned as product sales (FIN-DATA-01)', centreCaption === 1, `count ${centreCaption}`);
    const staleCaption = await page.getByText('Total revenue', { exact: true }).count();
    check('the misleading "Total revenue" centre caption is gone (FIN-DATA-01)', staleCaption === 0, `count ${staleCaption}`);
  }

  /* ---- UX-METRIC-01 / UX-DASH-01: no duplicated percentage or interval ---- */
  {
    // The growth percentage must appear exactly once inside the growth card.
    // Counting "vs " text across the whole grid is wrong: Total Revenue
    // legitimately carries a trend badge with its own comparison label.
    const growth = await page.evaluate(() => {
      const value = document.querySelector('[data-testid="metric-value-Revenue Growth"]');
      const card = value?.closest('.metric-card') ?? null;
      if (!card || !value) return null;
      const rendered = (value.textContent ?? '').trim();
      const occurrences = (card.textContent ?? '').split(rendered).length - 1;
      return { rendered, occurrences, cardText: (card.textContent ?? '').replace(/\s+/g, ' ').trim() };
    });
    check(
      'the growth percentage is printed exactly once on its card (UX-METRIC-01)',
      growth !== null && growth.occurrences === 1,
      JSON.stringify(growth),
    );
    check(
      'the growth card keeps its comparison hint (UX-METRIC-01)',
      growth !== null && /vs /.test(growth.cardText),
      JSON.stringify(growth?.cardText),
    );

    // Total Revenue is the card that has nowhere else to put the trend.
    const revenueCard = await page.evaluate(() => {
      const value = document.querySelector('[data-testid="metric-value-Total Revenue"]');
      const card = value?.closest('.metric-card') ?? null;
      return card ? (card.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
    });
    check(
      'total revenue still carries the growth trend (UX-METRIC-01)',
      revenueCard !== null && /vs /.test(revenueCard),
      JSON.stringify(revenueCard),
    );
  }
  {
    const internalIntervals = await page.locator('div[aria-label="Aggregation interval"]').count();
    check(
      'the interval control appears exactly once, in the card header (UX-DASH-01)',
      internalIntervals === 1,
      `found ${internalIntervals}`,
    );
    const weekly = await page.locator('div[aria-label="Aggregation interval"] button', { hasText: 'Weekly' }).count();
    check('the surviving interval control offers Weekly', weekly === 1, `count ${weekly}`);
    const metrics = await page.locator('.ant-segmented[aria-label="Time series metric"]').count();
    check('the series control survives in the chart (UX-DASH-01)', metrics === 1, `count ${metrics}`);
  }
};

const assertInventoryLoaded = async (page: Page, viewportWidth: number): Promise<void> => {
  const rows = page.locator('div.ant-table-row');
  // The virtual body measures its window after mount, so a freshly navigated
  // route legitimately has no rows for a frame.
  await rows.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  const count = await rows.count();

  check('the inventory table renders rows', count > 0, `found ${count} rows`);

  // Locate the name column from the header rather than assuming an index: the
  // column set changes with the density band, but "Product" is always present.
  const sorted = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('.ant-table-thead th'));
    const nameIndex = headers.findIndex((th) => (th.textContent ?? '').includes('Product'));
    return Array.from(document.querySelectorAll('div.ant-table-row'))
      .slice(0, 20)
      .map((row) => (row.querySelectorAll('[role="cell"]')[nameIndex]?.textContent ?? '').trim())
      .filter((value) => value.length > 0);
  });
  check('the inventory table shows a product', sorted.length > 0 && sorted[0].length > 0, `got ${JSON.stringify(sorted[0])}`);
  check(
    'the virtual table exposes row semantics to assistive tech',
    (await rows.first().getAttribute('role')) === 'row',
    `role was ${await rows.first().getAttribute('role')}`,
  );
  check(
    'the virtual table exposes cell semantics to assistive tech',
    (await rows.first().locator('div[role="cell"]').count()) > 0,
  );

  const isAlphabetical = sorted.every(
    (value, index) => index === 0 || value.localeCompare(sorted[index - 1], undefined, { numeric: true }) >= 0,
  );
  check('the inventory table is sorted by name', isAlphabetical, `got ${JSON.stringify(sorted.slice(0, 5))}`);

  /* ---- UI-TABLE-01: the "Updated" header must not be truncated ---- */
  // The column is desktop-only by design (`resolveColumnDensity` folds it into
  // the expandable row below 768px), so asserting it at phone widths would be
  // asserting that a deliberately hidden column exists.
  const hasUpdatedHeader = async (): Promise<boolean> =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.ant-table-thead th')).some(
        (th) =>
          (th.querySelector('.ant-table-column-title')?.textContent ?? '').trim().toLowerCase() === 'updated',
      ),
    );

  if (viewportWidth < 768) {
    check(
      'the "Updated" column is folded away on narrow viewports (UI-TABLE-01)',
      (await hasUpdatedHeader()) === false,
    );
  } else {
    const updated = await page.evaluate(() => {
      const header = Array.from(document.querySelectorAll('.ant-table-thead th')).find((th) =>
        (th.querySelector('.ant-table-column-title')?.textContent ?? '').trim().toLowerCase() === 'updated',
      );
      if (!header) return null;
      // Compare the label's own box against the header cell's, so an ellipsis
      // or a clipped overflow is detected even though the DOM text is intact.
      const cell = header.getBoundingClientRect();
      const label = Array.from(header.querySelectorAll('span, .ant-table-column-sorters'))
        .map((node) => node.getBoundingClientRect())
        .reduce<DOMRect | null>((widest, rect) => (widest === null || rect.width > widest.width ? rect : widest), null);
      return {
        text: (header.querySelector('.ant-table-column-title')?.textContent ?? '').trim(),
        clipped: label !== null && label.right > cell.right + 0.5,
        ellipsised:
          (header.querySelector('.ant-table-column-title') as HTMLElement | null) !== null &&
          ((header.querySelector('.ant-table-column-title') as HTMLElement).scrollWidth >
            (header.querySelector('.ant-table-column-title') as HTMLElement).clientWidth + 1 ||
            header.scrollWidth > header.clientWidth + 1),
        width: Math.round(cell.width),
      };
    });
    check(
      'the inventory table shows the full "Updated" column header (UI-TABLE-01)',
      updated !== null && updated.text === 'Updated',
      `header ${JSON.stringify(updated)}`,
    );
    check(
      'the "Updated" header is not clipped or ellipsised (UI-TABLE-01)',
      updated !== null && !updated.clipped && !updated.ellipsised,
      `header ${JSON.stringify(updated)}`,
    );
    check(
      'the "Updated" column is wide enough for its label and sorter (UI-TABLE-01)',
      updated !== null && updated.width >= 172,
      `rendered ${updated?.width}px`,
    );
  }
};

const assertSalesLoaded = async (page: Page, viewportWidth: number): Promise<void> => {
  const rows = page.locator('div.ant-table-row');
  check('the sales table renders rows', (await rows.count()) > 0, `found ${await rows.count()} rows`);
  // The range picker collapses out of the toolbar on phone widths, so it is only
// asserted where the toolbar is actually visible.
  if (viewportWidth >= 768) {
    const rangeInputs = await page.locator('input[aria-label="Custom reporting period"]').count();
    check('the sales screen offers a date range picker', rangeInputs === 2, `found ${rangeInputs} range inputs`);
  }
};

/**
 * Opens an order drawer and checks the fulfillment cost breakdown.
 *
 * This is the assertion that could not exist in the Node suites: Ant Design
 * mounts a Drawer through a portal, so under `renderToStaticMarkup` the panel
 * renders nothing and the Descriptions rows inside it are unobservable. That is
 * exactly how a wrong key (`content` instead of `children`) survived — every
 * cost row silently rendered empty.
 */
const assertOrderDrawer = async (page: Page): Promise<void> => {
  const openButton = page.locator('button[aria-label^="Open order"]').first();
  await openButton.waitFor({ state: 'visible', timeout: 15_000 });
  await openButton.click();

  const panel = page.locator('.ant-drawer-body').first();
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  check('the order drawer opens', await panel.isVisible());
  check('the order drawer renders a header', (await page.locator('.ant-drawer-title').first().textContent() ?? '').includes('ORD-'));

  const body = (await panel.textContent()) ?? '';

  check('the order drawer shows the order number', /ORD-\d{4}-\d{5}/.test(body), body.slice(0, 80));
  check(
    'the order drawer lists line items',
    (await panel.locator('tr.ant-table-row, div.ant-table-row').count()) > 0,
  );

  // Every label must be paired with a value on the same row. An empty cell is
  // the failure mode of a missing Descriptions key.
  for (const label of ['Subtotal', 'Tax', 'Cost of goods', 'Net profit', 'Margin']) {
    const row = panel.locator('.ant-descriptions-item', { hasText: label }).first();
    const value = ((await row.textContent()) ?? '').replace(label, '').trim();
    check(`the cost breakdown renders ${label}`, value.length > 0, `value was empty for "${label}"`);
  }

  const totalValue = ((await panel.locator('.ant-descriptions-item', { hasText: 'Order total' }).first().textContent()) ?? '')
    .replace('Order total', '')
    .trim();
  check('the cost breakdown renders a currency total', /\$\s?[\d,]+(\.\d{2})?/.test(totalValue), `got "${totalValue}"`);

  await page.locator('.ant-drawer-close').first().click();
  await panel.waitFor({ state: 'hidden', timeout: 15_000 });
  check('the order drawer closes', !(await panel.isVisible()));
};

/** Opens and dismisses the create-product drawer. */
const assertProductDrawer = async (page: Page): Promise<void> => {
  const trigger = page.getByRole('button', { name: /new product|add product/i }).first();
  if ((await trigger.count()) === 0) {
    check('the inventory screen offers a create action', false, 'no create button found');
    return;
  }
  await trigger.click();

  const panel = page.locator('.ant-drawer-body').first();
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  check('the product drawer opens', await panel.isVisible());
  check('the product drawer exposes the name field', (await panel.locator('input[aria-label="Product name"]').count()) === 1);

  await page.locator('.ant-drawer-close').first().click();
  await panel.waitFor({ state: 'hidden', timeout: 15_000 });
  check('the product drawer closes', !(await panel.isVisible()));
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const main = async (): Promise<number> => {
  let server: PreviewServer | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    server = await preview({
      configFile: false,
      root: process.cwd(),
      preview: { host: '127.0.0.1', port: 4173, strictPort: true },
      logLevel: 'error',
    });
    const baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? 'http://127.0.0.1:4173';
    console.log(`Serving the production build at ${baseUrl}`);

    browser = await chromium.launch({ headless: true });
    // One context for the whole run: IndexedDB persists inside a context, so
    // the 30-product / 100-order seed happens once on the cold start rather
    // than before every viewport.
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attach(page);

    /* Cold start — this is where the products schema crash used to fire. */
    section('Cold start (the regression that took the app down)');
    await goto(page, baseUrl, 'dashboard');
    // Router owns the single <main> landmark; a second one would mean the layout
  // regressed into nesting a duplicate #main-content inside it.
  check('the app mounts exactly one main landmark', (await page.locator('main#main-content').count()) === 1,
    `found ${await page.locator('main#main-content').count()}`);
  check('no element duplicates the main-content id', (await page.locator('#main-content').count()) === 1,
    `found ${await page.locator('#main-content').count()}`);
    check('no error boundary fallback is rendered', (await page.getByText('could not be displayed').count()) === 0);
    check('no workspace error fallback is rendered', (await page.getByText('hit an unexpected error').count()) === 0);
    await assertDashboardMounted(page);
    check('the cold start produced no SchemaError', !consoleErrors.some((e) => /SchemaError/i.test(e)));

    /* Route + viewport sweep. */
    section('Routes at every required viewport');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await goto(page, baseUrl, 'dashboard');
      await waitForNavigationBand(page, viewport.width);
      await assertNavigationMatchesBand(page, viewport.width);
      await assertNoHorizontalOverflow(page, viewport.width);
      await assertDashboardMounted(page);

      await goto(page, baseUrl, 'inventory');
      await waitForNavigationBand(page, viewport.width);
      await assertNavigationMatchesBand(page, viewport.width);
      await assertNoHorizontalOverflow(page, viewport.width);
      await assertInventoryLoaded(page, viewport.width);

      await goto(page, baseUrl, 'sales');
      await waitForNavigationBand(page, viewport.width);
      await assertNavigationMatchesBand(page, viewport.width);
      await assertNoHorizontalOverflow(page, viewport.width);
      await assertSalesLoaded(page, viewport.width);

      console.log(`  — ${viewport.width}px ok`);
    }

    /* Overlays, which only exist once a real portal can mount. */
    section('Overlays');
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, baseUrl, 'sales');
    await assertOrderDrawer(page);

    await goto(page, baseUrl, 'inventory');
    await assertProductDrawer(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, baseUrl, 'sales');
    await assertOrderDrawer(page);
    await assertNoHorizontalOverflow(page, 390);

    /* Console hygiene. */
    section('Console hygiene');
    check(
      'no unhandled page exceptions',
      pageErrors.length === 0,
      pageErrors.slice(0, 3).join(' | '),
    );
    check(
      'no console errors',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | '),
    );
    check(
      "no Ant Design deprecation warnings (including Drawer 'width')",
      deprecationWarnings.length === 0,
      deprecationWarnings.slice(0, 3).join(' | '),
    );
    check(
      'no SchemaError reached the console',
      !consoleErrors.some((error) => /SchemaError|is not indexed/i.test(error)),
      consoleErrors.filter((e) => /SchemaError/i.test(e)).slice(0, 2).join(' | '),
    );
  } finally {
    await context?.close();
    await browser?.close();
    await server?.close();
  }

  console.log(`\n[e2e] ${assertions - failures.length}/${assertions} assertions passed`);

  if (failures.length > 0) {
    console.log(`\n[e2e] ${failures.length} FAILURES:`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    if (pageErrors.length > 0) {
      console.log('\n[e2e] page exceptions:');
      for (const error of pageErrors.slice(0, 10)) console.log(`  ! ${error}`);
    }
    if (consoleErrors.length > 0) {
      console.log('\n[e2e] console errors:');
      for (const error of consoleErrors.slice(0, 10)) console.log(`  ! ${error}`);
    }
    return 1;
  }

  return 0;
};

process.exit(await main());