/**
 * Dashboard KPI grid.
 *
 * Six labelled surfaces — revenue, growth, net profit, margin, average order
 * value and stock alerts — laid out on a responsive grid that never drops below
 * a single readable column on phones.
 *
 * The card descriptors are produced by the pure, exported
 * {@link buildKpiCards} so the mapping from aggregate statistics to display
 * values is assertable without rendering.
 */

import {
  DollarOutlined,
  LineChartOutlined,
  PercentageOutlined,
  PieChartOutlined,
  ShoppingCartOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { FC, ReactNode } from 'react';

import { layoutTokens } from '../../../app/theme/tokens';
import { KpiSkeletonGrid } from '../../../shared/components/feedback/SkeletonBoard';
import { MetricCard, type MetricAccent } from '../../../shared/components/primitives/MetricCard';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber, formatPercent, formatSignedPercent } from '../../../shared/utils/currency';
import type { KPIStats } from '../../../shared/types';

export type KpiMetricKey =
  | 'totalRevenue'
  | 'revenueGrowthPct'
  | 'grossProfit'
  | 'profitMarginPct'
  | 'averageOrderValue'
  | 'stockAlerts';

export type StockAlertKind = 'low_stock' | 'out_of_stock';

export interface KpiCardDescriptor {
  key: KpiMetricKey;
  title: string;
  value: string;
  icon: ReactNode;
  accent: MetricAccent;
  /** Present when the card has a comparison to show. */
  trend?: number;
  /** Whether a rising trend is a good outcome for this metric. */
  positiveIsGood?: boolean;
  trendComparisonLabel?: string;
  secondaryLabel?: string;
  hint?: string;
  /** Cards that are navigational get an affordance and an action. */
  interactive?: boolean;
  ariaDescription: string;
}

export const buildKpiCards = (
  stats: KPIStats,
  hasPreviousPeriod: boolean,
  comparisonLabel = 'vs previous period',
): KpiCardDescriptor[] => {
  const stockAlerts = stats.lowStockItemsCount + stats.outOfStockItemsCount;
  const growth = stats.revenueGrowthPct;

  return [
    {
      key: 'totalRevenue',
      title: 'Total Revenue',
      value: formatCurrency(stats.totalRevenue),
      icon: <DollarOutlined />,
      accent: 'primary',
      ...(hasPreviousPeriod
        ? { trend: growth, positiveIsGood: true, trendComparisonLabel: comparisonLabel }
        : {}),
      ariaDescription: `Total recognised revenue of ${formatCurrency(stats.totalRevenue)}.`,
    },
    {
      key: 'revenueGrowthPct',
      title: 'Revenue Growth',
      value: hasPreviousPeriod ? formatSignedPercent(growth) : '—',
      icon: <LineChartOutlined />,
      accent: hasPreviousPeriod ? (growth >= 0 ? 'success' : 'danger') : 'neutral',
      // No `trend` here on purpose. The card's own value *is* the growth
      // percentage, so a trend badge would print the identical number a second
      // time directly underneath it. `Total Revenue` carries the trend, which
      // is the card that has no other place to put it.
      hint: hasPreviousPeriod ? comparisonLabel : 'No earlier period to compare',
      ariaDescription: hasPreviousPeriod
        ? `Revenue ${growth >= 0 ? 'grew' : 'fell'} ${formatPercent(Math.abs(growth))} against the previous period.`
        : 'Revenue growth is unavailable because there is no earlier period in range.',
    },
    {
      key: 'grossProfit',
      title: 'Net Profit',
      value: formatCurrency(stats.grossProfit),
      icon: <PieChartOutlined />,
      accent: stats.grossProfit >= 0 ? 'success' : 'danger',
      secondaryLabel: `Margin ${formatPercent(stats.profitMarginPct)}`,
      ariaDescription: `Net profit of ${formatCurrency(stats.grossProfit)}, a ${formatPercent(stats.profitMarginPct)} margin.`,
    },
    {
      key: 'profitMarginPct',
      title: 'Profit Margin',
      value: formatPercent(stats.profitMarginPct),
      icon: <PercentageOutlined />,
      accent: stats.profitMarginPct >= 0 ? 'success' : 'danger',
      secondaryLabel: `${formatNumber(stats.totalOrders)} orders`,
      ariaDescription: `Net profit equals ${formatPercent(stats.profitMarginPct)} of revenue across ${formatNumber(stats.totalOrders)} orders.`,
    },
    {
      key: 'averageOrderValue',
      title: 'Average Order Value',
      value: formatCurrency(stats.averageOrderValue),
      icon: <ShoppingCartOutlined />,
      accent: 'info',
      secondaryLabel: `${formatNumber(stats.totalOrders)} valid orders`,
      ariaDescription: `Average order value of ${formatCurrency(stats.averageOrderValue)}.`,
    },
    {
      key: 'stockAlerts',
      title: 'Stock Alerts',
      value: formatNumber(stockAlerts),
      icon: <WarningOutlined />,
      accent: stockAlerts > 0 ? 'warning' : 'success',
      secondaryLabel: `${formatNumber(stats.lowStockItemsCount)} low · ${formatNumber(stats.outOfStockItemsCount)} out`,
      interactive: true,
      ariaDescription:
        stockAlerts > 0
          ? `${formatNumber(stats.lowStockItemsCount)} products at or below their safety threshold and ${formatNumber(stats.outOfStockItemsCount)} out of stock.`
          : 'Every product is above its safety threshold.',
    },
  ];
};

export interface KPIOverviewGridProps {
  stats: KPIStats;
  /** When false, growth cards show a dash instead of a fabricated delta. */
  hasPreviousPeriod?: boolean;
  comparisonLabel?: string;
  loading?: boolean;
  onStockAlertClick?: (kind: StockAlertKind) => void;
  onMetricClick?: (key: KpiMetricKey) => void;
}

export const KPIOverviewGrid: FC<KPIOverviewGridProps> = ({
  stats,
  hasPreviousPeriod = true,
  comparisonLabel = 'vs previous period',
  loading = false,
  onStockAlertClick,
  onMetricClick,
}) => {
  const compact = useIsCompact();
  const cards = buildKpiCards(stats, hasPreviousPeriod, comparisonLabel);

  if (loading) return <KpiSkeletonGrid count={cards.length} />;

  const columns = compact ? 1 : cards.length > 4 ? 3 : 2;

  return (
    <section
      aria-label="Key performance indicators"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: layoutTokens.gridGutter,
      }}
    >
      {cards.map((card) => {
        // Stock alerts drill into the inventory view; the rest are informational
        // unless the host supplies a destination.
        const onClick =
          card.key === 'stockAlerts'
            ? onStockAlertClick
              ? () => onStockAlertClick(stats.outOfStockItemsCount > 0 ? 'out_of_stock' : 'low_stock')
              : undefined
            : onMetricClick
              ? () => onMetricClick(card.key)
              : undefined;

        return (
          <MetricCard
            key={card.key}
            title={card.title}
            value={card.value}
            icon={card.icon}
            accent={card.accent}
            {...(card.trend !== undefined ? { trend: card.trend } : {})}
            {...(card.positiveIsGood !== undefined ? { positiveIsGood: card.positiveIsGood } : {})}
            {...(card.trendComparisonLabel ? { trendComparisonLabel: card.trendComparisonLabel } : {})}
            {...(card.secondaryLabel ? { secondaryLabel: card.secondaryLabel } : {})}
            {...(card.hint ? { hint: card.hint } : {})}
            {...(onClick ? { onClick } : {})}
            ariaDescription={card.ariaDescription}
          />
        );
      })}
    </section>
  );
};

export default KPIOverviewGrid;
