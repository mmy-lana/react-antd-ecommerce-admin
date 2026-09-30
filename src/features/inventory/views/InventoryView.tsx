/**
 * Inventory screen (plan Task 5.3).
 *
 * Owns the catalogue's four interactive surfaces — analytics cards, the filter
 * toolbar, the virtualized table and the two overlays — and keeps them on one set
 * of filters and one selection. Selection in particular is shared state: the
 * batch action bar, the table's checkbox column and the "clear selection"
 * affordance all read the same `ProductSelection`, so a row checked on mobile is
 * still checked after a rotation.
 *
 * Both overlays (`ProductFormDrawer`, `StockAdjustmentModal`) mount through
 * portals and therefore render nothing under `renderToStaticMarkup`. The layout
 * is exported separately as {@link InventoryViewBody} so the harness can assert
 * the analytics, toolbar, table and batch bar without a document.
 */

import { App as AntdApp, Button, Card, Col, InputNumber, Popconfirm, Row, Typography } from 'antd';
import { EditOutlined, SwapOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { useRouter } from '../../../app/Router';
import { EmptyStateView } from '../../../shared/components/feedback/EmptyStateView';
import { SkeletonBoard } from '../../../shared/components/feedback/SkeletonBoard';
import { exportRowsToCsv, stockRecordCsvColumns } from '../../../shared/utils/exportCsv';
import { formatCurrency, formatNumber } from '../../../shared/utils/currency';
import {
  useInventory,
  useProductSelection,
  type InventoryAnalytics,
  type InventoryFilters,
} from '../hooks/useInventory';
import { useProductMutations, type ProductDraft } from '../hooks/useProductMutations';
import { ProductFormDrawer, type ProductFormValues } from '../components/ProductFormDrawer';
import type {
  CategoryFilter,
  Product,
  StockStatus,
  StockStatusFilter,
  UUID,
} from '../../../shared/types';
import { useIsMobile } from '../../../shared/components/primitives/ResponsiveContainer';
import { InventoryTable, type InventoryRowAction } from '../components/InventoryTable';
import { StockAdjustmentModal, type AdjustmentInput } from '../components/StockAdjustmentModal';
import {
  ALL_FILTER_VALUE,
  hasActiveInventoryFilters,
  StockFilterToolbar,
  STOCK_STATUS_FILTER_OPTIONS,
} from '../components/StockFilterToolbar';

/** Statuses a batch restock can be applied to, in the order they are offered. */
export const BATCH_RESTOCK_STATUSES: readonly StockStatus[] = ['low_stock', 'out_of_stock'];

/** How many units a batch restock adds to every selected product. */
export const DEFAULT_BATCH_RESTOCK_QUANTITY = 20;

export const BATCH_RESTOCK_REASON = 'Batch restock from the inventory view';

/**
 * Copy for the archive confirmation.
 *
 * Exported as a pure function so the wording — which is part of the destructive
 * action's contract — is assertable without opening a portal.
 */
export const archiveConfirmationCopy = (selectedCount: number): { title: string; description: string } => ({
  title: `Archive ${selectedCount} product${selectedCount === 1 ? '' : 's'}?`,
  description:
    'Archived products are hidden from the catalogue but keep their history. Any stock they hold stays on the books until it is adjusted.',
});

export interface AnalyticsCard {
  key: string;
  label: string;
  value: string;
  hint: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
}

/**
 * The four inventory KPI cards.
 *
 * Pure, so the suite asserts the numbers without rendering a component.
 */
export const buildAnalyticsCards = (analytics: InventoryAnalytics): AnalyticsCard[] => [
  {
    key: 'catalogue',
    label: 'Active products',
    value: formatNumber(analytics.totalProducts - analytics.archivedCount),
    hint: `${formatNumber(analytics.archivedCount)} archived and hidden by default`,
    tone: 'neutral',
  },
  {
    key: 'stockValue',
    label: 'Stock value at cost',
    value: formatCurrency(analytics.stockCost),
    hint: `Retail value ${formatCurrency(analytics.stockValue)}`,
    tone: 'neutral',
  },
  {
    key: 'lowStock',
    label: 'Below safety line',
    value: formatNumber(analytics.lowStockCount),
    hint: 'Reorder before the next sales cycle',
    tone: 'warning',
  },
  {
    key: 'outOfStock',
    label: 'Out of stock',
    value: formatNumber(analytics.outOfStockCount),
    hint: 'Not sellable until a restock lands',
    tone: 'error',
  },
];

const TONE_COLOR: Record<AnalyticsCard['tone'], string> = {
  neutral: colorTokens.textPrimary,
  success: colorTokens.success,
  warning: colorTokens.warning,
  error: colorTokens.error,
};

/** The form's values, widened to the draft the mutation layer expects. */
export const toProductDraft = (values: ProductFormValues): ProductDraft => ({
  ...values,
  variants: values.variants.map((variant) => ({
    ...variant,
    ...(variant.id === undefined ? {} : { id: variant.id }),
  })),
});

/**
 * Resolves a `?status=` query value to a real filter.
 *
 * A hand-edited URL must not put the toolbar into a state its own select cannot
 * represent, so anything unrecognised is ignored.
 */
export const toStockStatusFilter = (raw: string | undefined): StockStatusFilter | undefined => {
  if (raw === undefined || raw === ALL_FILTER_VALUE) return undefined;
  return STOCK_STATUS_FILTER_OPTIONS.some((option) => option.value === raw)
    ? (raw as StockStatusFilter)
    : undefined;
};

export interface InventoryViewBodyProps {
  products: readonly Product[];
  analytics: InventoryAnalytics;
  loading: boolean;
  filters: InventoryFilters;
  hasActiveFilters: boolean;
  totalCount: number;
  selectedRowKeys: readonly UUID[];
  onSelectedRowKeysChange: (keys: UUID[]) => void;
  onCategoryChange: (category: CategoryFilter) => void;
  onStockStatusChange: (status: StockStatusFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onResetFilters: () => void;
  showArchivedOnly: boolean;
  onToggleArchivedView: () => void;
  onOpenProduct: (product: Product) => void;
  onCreateProduct: () => void;
  onAdjustStock: (product: Product, variantId?: UUID) => void;
  onExport: () => void;
  onBatchRestock: (productIds: readonly UUID[], quantity: number) => Promise<void>;
  onArchive: (productIds: readonly UUID[]) => Promise<void>;
  mutationsPending: boolean;
  error: string | null;
  /** Overrides the batch quantity in the harness. */
  initialBatchQuantity?: number;
  extraToolbarContent?: ReactNode;
}

export const InventoryViewBody: FC<InventoryViewBodyProps> = ({
  products,
  analytics,
  loading,
  filters,
  hasActiveFilters,
  totalCount,
  selectedRowKeys,
  onSelectedRowKeysChange,
  onCategoryChange,
  onStockStatusChange,
  onSearchQueryChange,
  onResetFilters,
  showArchivedOnly,
  onToggleArchivedView,
  onOpenProduct,
  onCreateProduct,
  onAdjustStock,
  onExport,
  onBatchRestock,
  onArchive,
  mutationsPending,
  error,
  initialBatchQuantity = DEFAULT_BATCH_RESTOCK_QUANTITY,
  extraToolbarContent,
}) => {
  const isMobile = useIsMobile();
  const [batchQuantity, setBatchQuantity] = useState<number>(initialBatchQuantity);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cards = useMemo(() => buildAnalyticsCards(analytics), [analytics]);
  const hasSelection = selectedRowKeys.length > 0;

  const runBatch = async (action: (productIds: readonly UUID[], quantity: number) => Promise<void>): Promise<void> => {
    setBatchError(null);
    setBusy(true);
    try {
      await action(selectedRowKeys, batchQuantity);
      onSelectedRowKeysChange([]);
    } catch (cause) {
      setBatchError(cause instanceof Error ? cause.message : 'The batch operation could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const rowActions: readonly InventoryRowAction[] = useMemo(
    () => [
      { key: 'adjust', label: 'Adjust stock', icon: <SwapOutlined />, onClick: (product) => onAdjustStock(product) },
      { key: 'edit', label: 'Edit details', icon: <EditOutlined />, onClick: (product) => onOpenProduct(product) },
    ],
    [onAdjustStock, onOpenProduct],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layoutTokens.contentPadding, minWidth: 0 }}>
      {loading ? (
        <SkeletonBoard variant="kpi" />
      ) : (
        <Row gutter={[layoutTokens.gridGutter, layoutTokens.gridGutter]}>
          {cards.map((card) => (
            <Col key={card.key} xs={12} xl={6} style={{ minWidth: 0 }}>
              <Card size="small" styles={{ body: { padding: layoutTokens.contentPadding } }}>
                <Typography.Text
                  style={{
                    color: colorTokens.textTertiary,
                    fontSize: fontTokens.fontSizeSmall,
                    display: 'block',
                  }}
                >
                  {card.label}
                </Typography.Text>
                <Typography.Text
                  strong
                  style={{
                    color: TONE_COLOR[card.tone],
                    fontSize: fontTokens.fontSizeHeading3,
                    display: 'block',
                    lineHeight: 1.3,
                  }}
                >
                  {card.value}
                </Typography.Text>
                <Typography.Text
                  style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}
                >
                  {card.hint}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <StockFilterToolbar
        filters={filters}
        onCategoryChange={onCategoryChange}
        onStockStatusChange={onStockStatusChange}
        onSearchQueryChange={onSearchQueryChange}
        onReset={onResetFilters}
        totalCount={totalCount}
        filteredCount={products.length}
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {extraToolbarContent}
            <Button
              onClick={onExport}
              disabled={products.length === 0}
              style={{ minHeight: layoutTokens.touchTargetMinSize }}
            >
              Export CSV
            </Button>
            <Button
              type="primary"
              onClick={onCreateProduct}
              style={{ minHeight: layoutTokens.touchTargetMinSize }}
            >
              New product
            </Button>
          </div>
        }
      />

      {error === null && batchError === null ? null : (
        <Card
          role="alert"
          size="small"
          style={{ borderColor: colorTokens.error, background: colorTokens.errorSurface }}
        >
          <Typography.Text style={{ color: colorTokens.error }}>
            {error ?? batchError}
          </Typography.Text>
        </Card>
      )}

      {hasSelection ? (
        <Card
          size="small"
          aria-label="Batch actions"
          styles={{ body: { padding: layoutTokens.gridGutter } }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: layoutTokens.gridGutter,
              flexWrap: 'wrap',
            }}
          >
            <Typography.Text strong style={{ color: colorTokens.textPrimary }}>
              {selectedRowKeys.length} selected
            </Typography.Text>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: colorTokens.textSecondary,
                fontSize: fontTokens.fontSizeSmall,
              }}
            >
              Add units each
              <InputNumber
                min={1}
                max={100000}
                value={batchQuantity}
                onChange={(value) => setBatchQuantity(Math.max(1, Math.trunc(value ?? initialBatchQuantity)))}
                style={{ width: 96 }}
                aria-label="Units to add to each selected product"
              />
            </label>

            <Button
              type="primary"
              loading={busy}
              disabled={mutationsPending}
              onClick={() => void runBatch((ids, quantity) => onBatchRestock(ids, quantity))}
              style={{ minHeight: layoutTokens.touchTargetMinSize }}
            >
              Restock selected
            </Button>

            <Popconfirm
              title={archiveConfirmationCopy(selectedRowKeys.length).title}
              description={archiveConfirmationCopy(selectedRowKeys.length).description}
              okText="Archive"
              okButtonProps={{ danger: true }}
              onConfirm={() => void runBatch((ids) => onArchive(ids))}
            >
              <Button danger disabled={busy || mutationsPending} style={{ minHeight: layoutTokens.touchTargetMinSize }}>
                Archive
              </Button>
            </Popconfirm>

            <Button
              type="text"
              onClick={() => onSelectedRowKeysChange([])}
              disabled={busy}
              style={{ minHeight: layoutTokens.touchTargetMinSize }}
            >
              Clear selection
            </Button>
          </div>
        </Card>
      ) : null}

      <InventoryTable
        products={products}
        loading={loading}
        selectedRowKeys={selectedRowKeys}
        onSelectedRowKeysChange={onSelectedRowKeysChange}
        onRowClick={onOpenProduct}
        rowActions={rowActions}
        showArchivedOnly={showArchivedOnly}
        onToggleArchivedView={onToggleArchivedView}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onResetFilters}
        scrollY={isMobile ? 420 : undefined}
        emptyState={
          <EmptyStateView
            variant={hasActiveFilters ? 'filtered' : 'empty'}
            title={hasActiveFilters ? 'No products match these filters' : 'The catalogue is empty'}
            description={
              hasActiveFilters
                ? 'Widen the search, or reset the filters to see the whole catalogue.'
                : 'Add your first product to start tracking stock.'
            }
            {...(hasActiveFilters
              ? {
                  action: (
                    <Button
                      onClick={onResetFilters}
                      style={{ minHeight: layoutTokens.touchTargetMinSize }}
                    >
                      Reset filters
                    </Button>
                  ),
                }
              : {})}
          />
        }
      />
    </div>
  );
};

/**
 * The connected inventory screen: owns filters, selection, overlays and the
 * mutations that write to IndexedDB.
 */
export const InventoryView: FC = () => {
  const { message } = AntdApp.useApp();
  const { query } = useRouter();

  const [filters, setFilters] = useState<InventoryFilters>({
    category: ALL_FILTER_VALUE,
    stockStatus: ALL_FILTER_VALUE,
    searchQuery: '',
  });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{ product: Product; variantId?: UUID } | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  const inventory = useInventory({ filters, ...(includeArchived ? { includeArchived: true } : {}) });
  const mutations = useProductMutations();
  const selection = useProductSelection();

  // A `?status=` deep link from the dashboard pre-selects the matching filter.
  const deepLinkedStatus = query.status;
  useEffect(() => {
    const status = toStockStatusFilter(deepLinkedStatus);
    if (status === undefined) return;
    setFilters((previous) =>
      previous.stockStatus === status ? previous : { ...previous, stockStatus: status },
    );
  }, [deepLinkedStatus]);

  const openEditor = (product: Product | null): void => {
    setOverlayError(null);
    setEditingProduct(product);
    setFormOpen(true);
  };

  const openAdjustment = (product: Product, variantId?: UUID): void => {
    setOverlayError(null);
    setAdjustTarget(variantId === undefined ? { product } : { product, variantId });
  };

  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setOverlayError(null);
    try {
      await action();
      message.success(success);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'The operation could not be completed.';
      setOverlayError(text);
      message.error(text);
      throw cause;
    }
  };

  const batchRestock = async (productIds: readonly UUID[], quantity: number): Promise<void> => {
    for (const productId of productIds) {
      // Sequential on purpose: each restock is its own transaction, and a
      // partial failure must not silently roll the earlier ones back.
      await mutations.mutateProductStock({
        productId,
        changeType: 'restock',
        quantity,
        reason: BATCH_RESTOCK_REASON,
      });
    }
  };

  return (
    <>
      <InventoryViewBody
        products={inventory.filteredProducts}
        analytics={inventory.analytics}
        loading={inventory.loading}
        filters={filters}
        hasActiveFilters={hasActiveInventoryFilters(filters)}
        totalCount={inventory.totalCount}
        selectedRowKeys={[...selection.selectedIds]}
        onSelectedRowKeysChange={(keys) => selection.selectMany(keys)}
        onCategoryChange={(category) => setFilters((previous) => ({ ...previous, category }))}
        onStockStatusChange={(stockStatus: StockStatusFilter) =>
          setFilters((previous) => ({ ...previous, stockStatus }))
        }
        onSearchQueryChange={(searchQuery) => setFilters((previous) => ({ ...previous, searchQuery }))}
        onResetFilters={() =>
          setFilters({ category: ALL_FILTER_VALUE, stockStatus: ALL_FILTER_VALUE, searchQuery: '' })
        }
        showArchivedOnly={includeArchived}
        onToggleArchivedView={() => setIncludeArchived((previous) => !previous)}
        onOpenProduct={openEditor}
        onCreateProduct={() => openEditor(null)}
        onAdjustStock={openAdjustment}
        onExport={() =>
          exportRowsToCsv({
            filename: 'inventory',
            columns: stockRecordCsvColumns,
            rows: [...inventory.filteredProducts],
          })
        }
        onBatchRestock={(ids, quantity) =>
          run(() => batchRestock(ids, quantity), `Restocked ${ids.length} product${ids.length === 1 ? '' : 's'}.`)
        }
        onArchive={(ids) =>
          run(
            async () => {
              for (const id of ids) await mutations.archiveProduct(id);
            },
            `Archived ${ids.length} product${ids.length === 1 ? '' : 's'}.`,
          )
        }
        mutationsPending={mutations.pending}
        error={inventory.error}
      />

      <ProductFormDrawer
        open={formOpen}
        product={editingProduct}
        onClose={() => setFormOpen(false)}
        submitting={mutations.pending}
        {...(overlayError === null ? {} : { error: overlayError })}
        onSubmit={async (values, productId) => {
          await run(async () => {
            if (productId === null) {
              await mutations.createProduct(toProductDraft(values));
            } else {
              await mutations.updateProduct(productId, toProductDraft(values));
            }
            setFormOpen(false);
          }, productId === null ? 'Product created.' : 'Product updated.');
        }}
      />

      <StockAdjustmentModal
        open={adjustTarget !== null}
        product={adjustTarget?.product ?? null}
        {...(adjustTarget?.variantId === undefined ? {} : { variantId: adjustTarget.variantId })}
        onCancel={() => setAdjustTarget(null)}
        {...(overlayError === null ? {} : { error: overlayError })}
        onSubmit={async (input: AdjustmentInput) => {
          await run(async () => {
            await mutations.mutateProductStock({
              productId: input.productId,
              ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
              changeType: input.changeType,
              quantity: input.quantity,
              reason: input.reason,
            });
            setAdjustTarget(null);
          }, 'Stock updated.');
        }}
      />
    </>
  );
};

export default InventoryView;
