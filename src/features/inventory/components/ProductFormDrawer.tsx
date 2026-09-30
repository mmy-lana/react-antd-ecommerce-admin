/**
 * Create/edit product drawer.
 *
 * Width follows the plan's overlay contract: `viewportWidth < 480 ? '100%' : 460`.
 *
 * Variants are edited with a `Form.List` so the whole product — including its
 * variant rows and their per-variant thresholds — validates and submits as one
 * unit, matching the atomic product write the store performs.
 *
 * Validation rules that mirror the mutation layer's guarantees live here so an
 * invalid product never reaches a transaction:
 *  - a variant SKU must be unique within the product;
 *  - base price and cost must be non-negative;
 *  - a product must have at least one variant with a non-empty name.
 */

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from 'antd';
import { useEffect, useMemo, type FC } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { useOverlayWidth } from '../../../shared/components/primitives/ResponsiveContainer';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { parseCurrencyInput, roundToCents, toCurrencyInputValue } from '../../../shared/utils/currency';
import { nowIsoUtc } from '../../../shared/utils/dateMath';
import {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  STOCK_STATUSES,
  STOCK_STATUS_LABEL,
  type Product,
  type ProductCategory,
  type ProductVariant,
  type StockStatus,
} from '../../../shared/types';

export const PRODUCT_DRAWER_BASE_WIDTH = 460;

/** Upper bound on variants per product; guards the transaction's array size. */
export const MAX_VARIANTS_PER_PRODUCT = 24;

export interface ProductFormValues {
  name: string;
  sku: string;
  category: ProductCategory;
  brand: string;
  description: string;
  basePrice: number;
  baseCost: number;
  safetyStockThreshold: number;
  status: StockStatus;
  tags: string[];
  variants: {
    id?: string;
    name: string;
    sku: string;
    price: number;
    costPrice: number;
    stockQuantity: number;
    safetyStockThreshold: number;
  }[];
}

export interface ProductFormDrawerProps {
  open: boolean;
  /** `null` creates a new product. */
  product: Product | null;
  onClose: () => void;
  onSubmit: (values: ProductFormValues, productId: string | null) => Promise<void> | void;
  submitting?: boolean;
  error?: string;
}

interface VariantFormValues {
  id?: string;
  name: string;
  sku: string;
  price: number;
  costPrice: number;
  stockQuantity: number;
  safetyStockThreshold: number;
}

const toVariantFormValues = (variant: ProductVariant): VariantFormValues => ({
  id: variant.id,
  name: variant.name,
  sku: variant.sku,
  price: roundToCents(variant.price),
  costPrice: roundToCents(variant.costPrice),
  stockQuantity: variant.stockQuantity,
  safetyStockThreshold: variant.safetyStockThreshold,
});

const toProductFormValues = (product: Product): ProductFormValues => ({
  name: product.name,
  sku: product.sku,
  category: product.category as ProductCategory,
  brand: product.brand,
  description: product.description,
  basePrice: roundToCents(product.basePrice),
  baseCost: roundToCents(product.baseCost),
  safetyStockThreshold: product.safetyStockThreshold,
  status: product.status,
  tags: [...product.tags],
  variants: product.variants.map(toVariantFormValues),
});

export const emptyProductFormValues = (): ProductFormValues => ({
  name: '',
  sku: '',
  category: PRODUCT_CATEGORIES[0],
  brand: PRODUCT_BRANDS[0],
  description: '',
  basePrice: 0,
  baseCost: 0,
  safetyStockThreshold: 0,
  status: 'in_stock',
  tags: [],
  variants: [{ name: '', sku: '', price: 0, costPrice: 0, stockQuantity: 0, safetyStockThreshold: 0 }],
});

/**
 * Structural guard mirroring the store's write path: no blank variant rows, no
 * duplicate variant SKUs, and nothing archived silently through this form.
 */
export const validateProductForm = (values: ProductFormValues): string[] => {
  const problems: string[] = [];

  if (values.name.trim().length === 0) problems.push('Product name is required.');
  if (values.sku.trim().length === 0) problems.push('Product SKU is required.');
  if (values.basePrice < 0) problems.push('Base price cannot be negative.');
  if (values.baseCost < 0) problems.push('Base cost cannot be negative.');
  if (values.safetyStockThreshold < 0) problems.push('Safety stock threshold cannot be negative.');

  const namedVariants = values.variants.filter((variant) => variant.name.trim().length > 0);
  if (namedVariants.length === 0) {
    problems.push('Add at least one variant with a name.');
  }
  if (values.variants.length > MAX_VARIANTS_PER_PRODUCT) {
    problems.push(`A product can hold at most ${MAX_VARIANTS_PER_PRODUCT} variants.`);
  }

  const skus = new Set<string>();
  for (const variant of namedVariants) {
    const key = variant.sku.trim().toLowerCase();
    if (key.length === 0) {
      problems.push(`Variant “${variant.name.trim()}” is missing a SKU.`);
      continue;
    }
    if (skus.has(key)) {
      problems.push(`Variant SKU “${variant.sku.trim()}” is used more than once in this product.`);
    }
    skus.add(key);

    if (variant.price < 0) problems.push(`Variant “${variant.name.trim()}” has a negative price.`);
    if (variant.costPrice < 0) problems.push(`Variant “${variant.name.trim()}” has a negative cost.`);
    if (variant.stockQuantity < 0) {
      problems.push(`Variant “${variant.name.trim()}” has negative stock.`);
    }
    if (variant.safetyStockThreshold < 0) {
      problems.push(`Variant “${variant.name.trim()}” has a negative safety stock threshold.`);
    }
  }

  return problems;
};

/**
 * The drawer's content, exported separately from the overlay shell.
 *
 * Ant Design overlays mount through a portal and cannot be rendered without a
 * document, so the fields live in a plain component that the drawer wraps.
 */
export const ProductFormFields: FC<{
  product: Product | null;
  form: FormInstance<ProductFormValues>;
  onFinish: (values: ProductFormValues) => Promise<void> | void;
  submitting?: boolean;
  error?: string;
}> = ({ product, form, onFinish, submitting = false, error }) => {
  const compact = useIsCompact();
  const isEditing = product !== null;
  const initialisedAt = useMemo(() => nowIsoUtc(), [product]);

  // `initialValues` rather than an effect: the drawer is destroyed on close, so
  // the form remounts with the right values each time, and the values exist on
  // the very first render instead of one commit later.
  const initialValues = useMemo<ProductFormValues>(
    () => (product ? toProductFormValues(product) : emptyProductFormValues()),
    [product],
  );

  const handleFinish = async (values: ProductFormValues): Promise<void> => {
    const problems = validateProductForm(values);
    if (problems.length > 0) {
      form.setFields([
        {
          name: ['variants'],
          errors: problems,
        },
      ]);
      return;
    }
    await onFinish(values);
  };

  return (
      <Form<ProductFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={initialValues}
        requiredMark
        disabled={submitting}
      >
        <Form.Item
          name="name"
          label="Product name"
          rules={[{ required: true, whitespace: true, message: 'Enter a product name.' }]}
        >
          <Input maxLength={120} placeholder="Aurora Wireless Headphones" aria-label="Product name" />
        </Form.Item>

        <Space.Compact block style={{ marginBottom: layoutTokens.formRowGap }}>
          <Form.Item
            name="sku"
            label="SKU"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true, whitespace: true, message: 'Enter a SKU.' }]}
          >
            <Input maxLength={40} placeholder="AUD-0001" aria-label="Product SKU" />
          </Form.Item>

          <Form.Item
            name="status"
            label="Status"
            style={{ width: 180, marginBottom: 0 }}
            rules={[{ required: true }]}
          >
            <Select
              aria-label="Product stock status"
              options={STOCK_STATUSES.map((status) => ({ label: STOCK_STATUS_LABEL[status], value: status }))}
            />
          </Form.Item>
        </Space.Compact>

        <Space.Compact block style={{ marginBottom: layoutTokens.formRowGap }}>
          <Form.Item
            name="category"
            label="Category"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true }]}
          >
            <Select
              aria-label="Product category"
              options={PRODUCT_CATEGORIES.map((category) => ({ label: category, value: category }))}
            />
          </Form.Item>

          <Form.Item
            name="brand"
            label="Brand"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true, message: 'Select a brand.' }]}
          >
            <Select
              showSearch
              aria-label="Product brand"
              options={PRODUCT_BRANDS.map((brand) => ({ label: brand, value: brand }))}
            />
          </Form.Item>
        </Space.Compact>

        <Form.Item name="description" label="Description">
          <Input.TextArea
            rows={3}
            maxLength={600}
            showCount
            placeholder="Short merchandising description"
            aria-label="Product description"
          />
        </Form.Item>

        <Space.Compact block style={{ marginBottom: layoutTokens.formRowGap }}>
          <Form.Item
            name="basePrice"
            label="Base price"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true, message: 'Enter a base price.' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              step={1}
              prefix="$"
              style={{ width: '100%' }}
              formatter={(value) => toCurrencyInputValue(Number(value ?? 0))}
              parser={(value: string | undefined): number => parseCurrencyInput(value ?? '') ?? 0}
              aria-label="Base price in dollars"
            />
          </Form.Item>

          <Form.Item
            name="baseCost"
            label="Base cost"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true, message: 'Enter a base cost.' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              step={1}
              prefix="$"
              style={{ width: '100%' }}
              formatter={(value) => toCurrencyInputValue(Number(value ?? 0))}
              parser={(value: string | undefined): number => parseCurrencyInput(value ?? '') ?? 0}
              aria-label="Base cost in dollars"
            />
          </Form.Item>

          <Form.Item
            name="safetyStockThreshold"
            label="Safety stock"
            style={{ width: 150, marginBottom: 0 }}
            rules={[{ required: true, message: 'Enter a safety threshold.' }]}
          >
            <InputNumber
              min={0}
              precision={0}
              step={1}
              style={{ width: '100%' }}
              aria-label="Safety stock threshold in units"
            />
          </Form.Item>
        </Space.Compact>

        <Form.Item name="tags" label="Tags">
          <Select
            mode="tags"
            allowClear
            aria-label="Product tags"
            placeholder="Add tags and press Enter"
            tokenSeparators={[',']}
            maxCount={12}
            open={false}
            suffixIcon={null}
          />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 8 }}>
          Variants
        </Typography.Title>
        <Typography.Paragraph style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
          Each variant carries its own SKU, price and safety threshold. Leave the name blank to drop the row.
        </Typography.Paragraph>

        <Form.List
          name="variants"
          rules={[
            {
              validator: async (_, items: VariantFormValues[] | undefined) => {
                if (!items) return;
                const problems = validateProductForm({
                  name: 'placeholder',
                  sku: 'placeholder',
                  category: PRODUCT_CATEGORIES[0],
                  brand: PRODUCT_BRANDS[0],
                  description: '',
                  basePrice: 0,
                  baseCost: 0,
                  safetyStockThreshold: 0,
                  status: 'in_stock',
                  tags: [],
                  variants: items,
                }).filter((problem) => !problem.startsWith('Product ') && !problem.startsWith('Base ') && !problem.startsWith('Safety stock threshold cannot') && !problem.startsWith('Add at least one variant') && !problem.startsWith('A product can hold'));
                if (problems.length > 0) throw new Error(problems.join(' '));
              },
            },
          ]}
        >
          {(fields, { add, remove }, meta) => (
            <>
              {fields.length === 0 ? (
                <Typography.Paragraph style={{ color: colorTokens.textTertiary }}>
                  No variants yet. Add one to make this product purchasable.
                </Typography.Paragraph>
              ) : null}

              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 12,
                    marginBottom: 12,
                    border: `1px solid ${colorTokens.borderColor}`,
                    borderRadius: 10,
                    background: colorTokens.backgroundCanvas,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Typography.Text strong style={{ color: colorTokens.textPrimary }}>
                      {`Variant ${index + 1}`}
                    </Typography.Text>
                    <Button
                      type="text"
                      danger
                      aria-label={`Remove variant ${index + 1}`}
                      icon={<DeleteOutlined />}
                      className="table-action-button"
                      onClick={() => remove(field.name)}
                      style={{ minHeight: layoutTokens.touchTargetMinSize, minWidth: layoutTokens.touchTargetMinSize }}
                    />
                  </div>

                  <Space.Compact block>
                    <Form.Item
                      {...field}
                      key={`${field.key}-name`}
                      name={[field.name, 'name']}
                      noStyle
                    >
                      <Input placeholder="Variant name" aria-label={`Variant ${index + 1} name`} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      key={`${field.key}-sku`}
                      name={[field.name, 'sku']}
                      noStyle
                    >
                      <Input placeholder="SKU" aria-label={`Variant ${index + 1} SKU`} style={{ maxWidth: 160 }} />
                    </Form.Item>
                  </Space.Compact>

                  <Space size={8} wrap>
                    <Form.Item
                      {...field}
                      key={`${field.key}-price`}
                      name={[field.name, 'price']}
                      noStyle
                    >
                      <InputNumber
                        min={0}
                        precision={2}
                        prefix="$"
                        step={1}
                        placeholder="Price"
                        aria-label={`Variant ${index + 1} price`}
                        style={{ minWidth: 120 }}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      key={`${field.key}-cost`}
                      name={[field.name, 'costPrice']}
                      noStyle
                    >
                      <InputNumber
                        min={0}
                        precision={2}
                        prefix="$"
                        step={1}
                        placeholder="Cost"
                        aria-label={`Variant ${index + 1} cost`}
                        style={{ minWidth: 120 }}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      key={`${field.key}-stock`}
                      name={[field.name, 'stockQuantity']}
                      noStyle
                    >
                      <InputNumber
                        min={0}
                        precision={0}
                        step={1}
                        placeholder="Stock"
                        aria-label={`Variant ${index + 1} stock quantity`}
                        style={{ minWidth: 120 }}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      key={`${field.key}-threshold`}
                      name={[field.name, 'safetyStockThreshold']}
                      noStyle
                    >
                      <InputNumber
                        min={0}
                        precision={0}
                        step={1}
                        placeholder="Safety"
                        aria-label={`Variant ${index + 1} safety threshold`}
                        style={{ minWidth: 120 }}
                      />
                    </Form.Item>
                  </Space>

                  {/* Preserve the existing variant id on edit. */}
                  <Form.Item {...field} key={`${field.key}-id`} name={[field.name, 'id']} hidden>
                    <Input />
                  </Form.Item>
                </div>
              ))}

              <Form.ErrorList errors={meta.errors} />

              <Button
                type="dashed"
                block
                icon={<PlusOutlined aria-hidden="true" />}
                disabled={fields.length >= MAX_VARIANTS_PER_PRODUCT}
                onClick={() =>
                  add({ name: '', sku: '', price: 0, costPrice: 0, stockQuantity: 0, safetyStockThreshold: 0 })
                }
                style={{ minHeight: layoutTokens.touchTargetMinSize }}
              >
                {`Add variant (${fields.length}/${MAX_VARIANTS_PER_PRODUCT})`}
              </Button>
            </>
          )}
        </Form.List>

        {error ? (
          <Typography.Text
            role="alert"
            style={{ display: 'block', marginTop: 16, color: colorTokens.error, fontSize: fontTokens.fontSizeSmall }}
          >
            {error}
          </Typography.Text>
        ) : null}

        <span className="visually-hidden">
          {`Form initialised at ${initialisedAt}. Editing ${
            isEditing ? `existing product with ${product.variants.length} variants` : 'a new product'
          }.`}
        </span>

        {compact ? <div style={{ height: layoutTokens.contentPadding }} /> : null}
      </Form>
  );
};

/** Overlay shell: drawer chrome plus the submit and cancel actions. */
export const ProductFormDrawer: FC<ProductFormDrawerProps> = ({
  open,
  product,
  onClose,
  onSubmit,
  submitting = false,
  error,
}) => {
  const width = useOverlayWidth(PRODUCT_DRAWER_BASE_WIDTH);
  const [form] = Form.useForm<ProductFormValues>();
  const isEditing = product !== null;

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, product, form]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      /**
       * `size`, not `width`.
       *
       * Ant Design 6 declares `size?: 'default' | 'large' | number | string` —
       * a dynamic pixel or `'100%'` value is a supported input, and `size` is
       * the *replacement* API. `width` is not merely stylistic here: `Drawer.js`
       * runs `warning.deprecated(!(deprecatedName in props), 'width', 'size')`
       * on every render, so passing it logs
       * `[antd: Drawer] 'width' is deprecated` to the console. The v5-era rule
       * that `size` only accepts two literals no longer applies.
       */
      size={width}
      title={isEditing ? `Edit ${product.name}` : 'New product'}
      aria-label={isEditing ? `Edit product ${product.name}` : 'Create a new product'}
      destroyOnHidden
      mask={{ closable: false }}
      extra={
        <Space size={8}>
          <Button onClick={onClose} disabled={submitting} style={{ minHeight: layoutTokens.touchTargetMinSize }}>
            Cancel
          </Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={() => form.submit()}
            style={{ minHeight: layoutTokens.touchTargetMinSize }}
          >
            {isEditing ? 'Save changes' : 'Create product'}
          </Button>
        </Space>
      }
    >
      <ProductFormFields
        product={product}
        form={form}
        onFinish={(values) => onSubmit(values, product?.id ?? null)}
        submitting={submitting}
        {...(error ? { error } : {})}
      />
    </Drawer>
  );
};

export default ProductFormDrawer;
