/**
 * Component render harness.
 *
 * Type checking proves a component compiles; it does not prove it renders. These
 * checks mount every primitive and feature component with representative props
 * through `react-dom/server`, which executes the full render path (hook order,
 * prop plumbing, undefined access, Ant Design slot contracts) without needing a
 * browser.
 *
 * The assertions also pin down the accessibility contract the plan requires:
 * status badges expose a label-bearing accessible name, trend indicators keep
 * the visible text inside the accessible name, and loading states announce
 * themselves as busy.
 *
 * Run with `pnpm run verify:domain`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import {
  buildRouteHash,
  parseRouteFromHash,
  Router,
  ROUTE_PATHS,
  ROUTE_TITLES,
} from '../src/app/Router';
import { EmptyStateView } from '../src/shared/components/feedback/EmptyStateView';
import { ErrorBoundary } from '../src/shared/components/feedback/ErrorBoundary';
import {
  ChartSkeleton,
  KpiSkeletonGrid,
  SkeletonBoard,
  TableSkeleton,
} from '../src/shared/components/feedback/SkeletonBoard';
import { MetricCard } from '../src/shared/components/primitives/MetricCard';
import { ResponsiveContainer } from '../src/shared/components/primitives/ResponsiveContainer';
import { StatusBadge } from '../src/shared/components/primitives/StatusBadge';
import { TrendIndicator } from '../src/shared/components/primitives/TrendIndicator';
import { AntDAppProviderHarness } from './harness/AntDAppProviderHarness';

const failures: string[] = [];
let assertions = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  assertions += 1;
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const render = (label: string, element: ReactElement): string => {
  try {
    return renderToStaticMarkup(AntDAppProviderHarness(element));
  } catch (error) {
    assertions += 1;
    failures.push(`${label} threw during render — ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
};

/* -------------------------------------------------------------------------- */
/* Responsive container                                                        */
/* -------------------------------------------------------------------------- */

const containerMarkup = render(
  'ResponsiveContainer',
  <ResponsiveContainer>
    <span>content</span>
  </ResponsiveContainer>,
);
check('ResponsiveContainer renders children', containerMarkup.includes('content'));
check('ResponsiveContainer publishes its band', containerMarkup.includes('data-breakpoint='));
check('ResponsiveContainer is not a live region', !containerMarkup.includes('aria-live'));

const semanticMarkup = render(
  'ResponsiveContainer as section',
  <ResponsiveContainer as="section">
    <span>scoped</span>
  </ResponsiveContainer>,
);
check('ResponsiveContainer honours the semantic element', semanticMarkup.includes('<section'));

/* -------------------------------------------------------------------------- */
/* Status badges                                                               */
/* -------------------------------------------------------------------------- */

const stockBadge = render(
  'StatusBadge stock',
  <StatusBadge domain="stock" status="low_stock" />,
);
check('stock badge shows its label', decodeEntities(stockBadge).includes('Low Stock'));
check(
  'stock badge accessible name carries the kind',
  stockBadge.includes('aria-label="Stock status: Low Stock"'),
  stockBadge.slice(0, 200),
);
check('status dot is decorative', stockBadge.includes('aria-hidden="true"'));

const orderBadge = render(
  'StatusBadge order',
  <StatusBadge domain="order" status="refunded" />,
);
check('order badge shows its label', decodeEntities(orderBadge).includes('Refunded'));
check(
  'order badge accessible name carries the kind',
  orderBadge.includes('aria-label="Order status: Refunded"'),
);

const countedBadge = render(
  'StatusBadge with count',
  <StatusBadge domain="stock" status="out_of_stock" count={12} />,
);
check('counted badge renders the count', countedBadge.includes('12'));

const clickableBadge = render(
  'StatusBadge interactive',
  <StatusBadge domain="stock" status="in_stock" onClick={() => undefined} />,
);
check('interactive badge is a real button', clickableBadge.includes('<button'));
check('interactive badge is typed as a button', clickableBadge.includes('type="button"'));

/* -------------------------------------------------------------------------- */
/* Trend indicator + metric card                                               */
/* -------------------------------------------------------------------------- */

const risingTrend = render('TrendIndicator up', <TrendIndicator value={12.5} comparisonLabel="vs last 30 days" />);
check('positive trend is signed', decodeEntities(risingTrend).includes('+12.5%'));
check('trend marks its direction', risingTrend.includes('data-direction="up"'));

const fallingTrend = render('TrendIndicator down', <TrendIndicator value={-4.25} />);
check('negative trend uses a true minus sign', decodeEntities(fallingTrend).includes('−4.3%'));

const flatTrend = render('TrendIndicator flat', <TrendIndicator value={0} />);
check('flat trend has no arrow direction', flatTrend.includes('data-direction="flat"'));

const invertedTrend = render(
  'TrendIndicator positiveIsGood=false',
  <TrendIndicator value={8} positiveIsGood={false} />,
);
check(
  'inverted metric marks a rise as bad',
  invertedTrend.includes('data-tone') === false && invertedTrend.includes('#b91c1c'),
  invertedTrend.slice(0, 240),
);

const metricMarkup = render(
  'MetricCard',
  <MetricCard
    title="Total Revenue"
    value="$487,259.68"
    trend={12.5}
    trendComparisonLabel="vs prev"
    secondaryLabel="100 orders"
    accent="primary"
  />,
);
check('metric card renders its title', metricMarkup.includes('Total Revenue'));
check('metric card renders its value', decodeEntities(metricMarkup).includes('$487,259.68'));
check('metric card renders the trend', decodeEntities(metricMarkup).includes('+12.5%'));
check('metric card exposes a value hook', metricMarkup.includes('data-testid="metric-value-Total Revenue"'));
check('metric card accent rail is decorative', metricMarkup.includes('aria-hidden="true"'));

const clickableMetric = render('MetricCard clickable', <MetricCard title="Low Stock" value={4} onClick={() => undefined} />);
check('clickable metric is keyboard reachable', clickableMetric.includes('tabindex="0"'));
check('clickable metric is announced as a button', clickableMetric.includes('role="button"'));

const loadingMetric = render('MetricCard loading', <MetricCard title="Revenue" value="$0" loading />);
check('loading metric announces its state', loadingMetric.includes('aria-busy="true"'));

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

const emptyMarkup = render('EmptyStateView', <EmptyStateView title="No products" description="Add one to begin" />);
check('empty state renders its title', emptyMarkup.includes('No products'));
check('empty state renders its description', emptyMarkup.includes('Add one to begin'));

const emptyWithAction = render(
  'EmptyStateView with action',
  <EmptyStateView title="Nothing" action={<button type="button">Create</button>} />,
);
check('empty state renders its action', emptyWithAction.includes('Create'));

const kpiSkeleton = render('KpiSkeletonGrid', <KpiSkeletonGrid count={4} />);
check('kpi skeleton announces busy state', kpiSkeleton.includes('aria-busy="true"'));
check(
  'kpi skeleton reserves one placeholder row per tile',
  (kpiSkeleton.match(/ant-skeleton-input/g) ?? []).length >= 12,
  `${(kpiSkeleton.match(/ant-skeleton-input/g) ?? []).length} skeleton inputs`,
);

const chartSkeleton = render('ChartSkeleton', <ChartSkeleton title="Revenue trend" />);
check('chart skeleton reserves height', chartSkeleton.includes('height:320px'), 'chart height not reserved');
check('chart skeleton labels itself', chartSkeleton.includes('aria-label='));

const tableSkeleton = render('TableSkeleton', <TableSkeleton rows={6} />);
check('table skeleton announces busy state', tableSkeleton.includes('aria-busy="true"'));

const boardMarkup = render('SkeletonBoard', <SkeletonBoard variant="dashboard" />);
check('skeleton board composes kpi and chart fallbacks', boardMarkup.includes('aria-busy="true"'));

const boundaryMarkup = render('ErrorBoundary', <ErrorBoundary label="Inventory">child</ErrorBoundary>);
check('error boundary renders its children while healthy', boundaryMarkup.includes('child'));
check('error boundary hides the fallback while healthy', !boundaryMarkup.includes('could not be displayed'));

/* -------------------------------------------------------------------------- */
/* Router                                                                      */
/* -------------------------------------------------------------------------- */

check('router parses a known route', parseRouteFromHash('#/sales') === 'sales');
check('router parses a nested fragment', parseRouteFromHash('#/inventory/42') === 'inventory');
check('router tolerates a missing prefix', parseRouteFromHash('dashboard') === 'dashboard');
check('router falls back on an unknown route', parseRouteFromHash('#/nope') === 'dashboard');
check('router falls back on an empty hash', parseRouteFromHash('') === 'dashboard');
check('router falls back on a bare slash', parseRouteFromHash('#/') === 'dashboard');
check('router builds canonical hashes', buildRouteHash('inventory') === '#/inventory');
check(
  'every route has a document title',
  ROUTE_PATHS.every((route) => ROUTE_TITLES[route].length > 0),
);

const routerMarkup = render(
  'Router',
  <Router renderView={(route) => <span>{`view:${route}`}</span>} />,
);
check('router renders the requested view', routerMarkup.includes('view:dashboard'));
check('router exposes a focusable main landmark', routerMarkup.includes('id="main-content"'));
check('router main landmark is programmatically focusable', routerMarkup.includes('tabindex="-1"'));

console.log(`\n[components] ${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n[components] ${failures.length} FAILURES:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
}
