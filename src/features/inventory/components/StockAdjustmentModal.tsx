/**
 * Stock adjustment modal (plan Task 3.2).
 *
 * Built on `App.useApp()` — Ant Design 6 removed the static `Modal.confirm`
 * family, and context-based modals inherit the app's theme and locale.
 *
 * The form is deliberately opinionated about the *transactional* guards the
 * mutation layer enforces, so a user learns the constraint before submitting:
 *
 *  - a negative resulting quantity is impossible — the delta is validated
 *    against the available balance as the user types;
 *  - a zero delta is rejected as a no-op rather than silently logged;
 *  - every change carries a reason, because the inventory log is the audit
 *    record and an unexplained row is a defect in the data.
 *
 * `validateAdjustment` is exported pure so the guards are assertable.
 */

import { App, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useEffect, useMemo, type FC } from 'react';

import { colorTokens, fontTokens, layoutTokens } from '../../../app/theme/tokens';
import { StatusBadge } from '../../../shared/components/primitives/StatusBadge';
import { useIsCompact } from '../../../shared/components/primitives/ResponsiveContainer';
import { formatCurrency, formatNumber } from '../../../shared/utils/currency';
import {
  INVENTORY_CHANGE_TYPE_LABEL,
  INVENTORY_CHANGE_TYPES,
  type InventoryChangeType,
  type Product,
  type ProductVariant,
  type UUID,
} from '../../../shared/types';

/** Signed delta the modal submits, after normalising the mode. */
export interface AdjustmentInput {
  productId: UUID;
  variantId?: UUID;
  changeType: InventoryChangeType;
  quantity: number;
  reason: string;
}

export interface AdjustmentValidation {
  valid: boolean;
  /** User-facing explanation when `valid` is false. */
  message?: string;
  /** Quantity after the change, for live preview. */
  resultingQuantity: number;
}

/** The largest absolute change a single adjustment may apply. */
export const MAX_ADJUSTMENT_QUANTITY = 100_000;

/** Longest accepted reason. Mirrored on the input's `maxLength`. */
export const MAX_REASON_LENGTH = 240;

export const MIN_REASON_LENGTH = 3;

/**
 * The transactional guard, in the same order the mutation layer applies it.
 *
 * Exported so the rule set can be asserted without opening a modal.
 */
export const validateAdjustment = (input: {
  changeType: InventoryChangeType;
  quantity: number;
  currentQuantity: number;
  reason: string;
}): AdjustmentValidation => {
  const { changeType, quantity, currentQuantity, reason } = input;

  if (!Number.isInteger(quantity)) {
    return { valid: false, message: 'Quantity must be a whole number of units.', resultingQuantity: currentQuantity };
  }
  if (quantity === 0) {
    return { valid: false, message: 'Enter a non-zero quantity — a zero change is not recorded.', resultingQuantity: currentQuantity };
  }
  if (Math.abs(quantity) > MAX_ADJUSTMENT_QUANTITY) {
    return {
      valid: false,
      message: `Quantity must be between 1 and ${formatNumber(MAX_ADJUSTMENT_QUANTITY)} units.`,
      resultingQuantity: currentQuantity,
    };
  }

  const signedDelta = resolveSignedDelta(changeType, quantity);
  const resultingQuantity = currentQuantity + signedDelta;

  if (resultingQuantity < 0) {
    return {
      valid: false,
      message: `Only ${formatNumber(currentQuantity)} units are available; this change would leave stock negative.`,
      resultingQuantity,
    };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < MIN_REASON_LENGTH) {
    return {
      valid: false,
      message: `Record a reason of at least ${MIN_REASON_LENGTH} characters for the inventory log.`,
      resultingQuantity,
    };
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return {
      valid: false,
      message: `Reason must be ${MAX_REASON_LENGTH} characters or fewer.`,
      resultingQuantity,
    };
  }

  return { valid: true, resultingQuantity };
};

/**
 * How a change type moves stock.
 *
 * - `increase` / `decrease` take a magnitude and the form applies the sign, so
 *   an operator never has to type a minus sign for a lost unit;
 * - `signed` is a free correction (a stock count fix), where the operator's own
 *   sign is the whole meaning of the entry.
 */
export type ChangeDirection = 'increase' | 'decrease' | 'signed';

export const CHANGE_DIRECTION: Record<InventoryChangeType, ChangeDirection> = {
  restock: 'increase',
  return: 'increase',
  sale: 'decrease',
  damage: 'decrease',
  adjustment: 'signed',
};

export const CHANGE_DIRECTION_LABEL: Record<ChangeDirection, string> = {
  increase: 'Adds to stock',
  decrease: 'Removes from stock',
  signed: 'Adds or removes, by sign',
};

export const resolveChangeDirection = (changeType: InventoryChangeType): ChangeDirection =>
  CHANGE_DIRECTION[changeType];

/** Every change type is recordable by hand; the ledger needs no exclusions. */
export const ADJUSTABLE_CHANGE_TYPES: readonly InventoryChangeType[] = INVENTORY_CHANGE_TYPES;

/** Applies the direction of `changeType` to a typed quantity. */
export const resolveSignedDelta = (changeType: InventoryChangeType, quantity: number): number => {
  if (!Number.isFinite(quantity)) return 0;
  switch (CHANGE_DIRECTION[changeType]) {
    case 'increase':
      return Math.abs(Math.trunc(quantity));
    case 'decrease':
      return -Math.abs(Math.trunc(quantity));
    case 'signed':
      return Math.trunc(quantity);
  }
};

export interface StockAdjustmentModalProps {
  open: boolean;
  product: Product | null;
  /** Pre-selects a variant, e.g. from the expanded inventory row. */
  variantId?: UUID;
  onCancel: () => void;
  onSubmit: (input: AdjustmentInput) => Promise<void> | void;
  /** Shows a failure from the transaction without closing the modal. */
  error?: string;
}

/**
 * The dialog's content, exported separately from the modal shell.
 *
 * Ant Design overlays mount through a portal and cannot be rendered without a
 * document, so the form is a plain component the shell wraps. That keeps the
 * fields, the preview and the guards testable on their own.
 *
 * `onConfirmed` runs after validation; the shell decides whether the resulting
 * zero-stock case needs a confirmation round trip.
 */
export const StockAdjustmentForm: FC<{
  product: Product | null;
  variantId?: UUID;
  form: FormInstance<AdjustmentInput>;
  /** Current balance for the selected scope, used by the live preview. */
  currentQuantity: number;
  onFinish: (values: AdjustmentInput) => Promise<void> | void;
  error?: string;
}> = ({ product, variantId, form, currentQuantity, onFinish, error }) => {
  const variants = useMemo(
    () => product?.variants.filter((variant) => !variant.isArchived) ?? [],
    [product],
  );

  const selectedVariantId = Form.useWatch('variantId', form) ?? variantId;
  const changeType = Form.useWatch('changeType', form) ?? 'restock';
  const quantity = Form.useWatch('quantity', form) ?? 0;

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (!product) return undefined;
    if (!selectedVariantId) return undefined;
    return variants.find((variant) => variant.id === selectedVariantId);
  }, [product, selectedVariantId, variants]);

  const direction = resolveChangeDirection(changeType);
  const quantityHelp =
    direction === 'signed'
      ? 'A plain correction: enter a negative number to remove stock, positive to add it.'
      : `${CHANGE_DIRECTION_LABEL[direction]} — enter a magnitude and the sign is applied for you.`;

  const preview = validateAdjustment({
    changeType,
    quantity: Number.isInteger(quantity) ? (quantity as number) : Number.NaN,
    currentQuantity,
    reason: Form.useWatch('reason', form) ?? '',
  });

  const marginNote = selectedVariant
    ? `Unit price ${formatCurrency(selectedVariant.price)} · unit cost ${formatCurrency(selectedVariant.costPrice)}`
    : product
      ? `Base price ${formatCurrency(product.basePrice)} · base cost ${formatCurrency(product.baseCost)}`
      : null;

  return (
    <>
      {product === null ? null : (
      <Form<AdjustmentInput>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ changeType: 'restock' }}
        onFinish={onFinish}
      >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            <Typography.Text strong style={{ color: colorTokens.textPrimary }}>
              {product.name}
            </Typography.Text>
            <Space size={8} wrap>
              <StatusBadge domain="stock" status={product.status} size="small" />
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeSmall }}>
                {`${formatNumber(currentQuantity)} units available`}
              </Typography.Text>
            </Space>
            {marginNote ? (
              <Typography.Text style={{ color: colorTokens.textTertiary, fontSize: fontTokens.fontSizeTiny }}>
                {marginNote}
              </Typography.Text>
            ) : null}
          </div>

          {variants.length > 0 ? (
            <Form.Item
              name="variantId"
              label="Variant"
              extra="Choose a specific variant, or leave unset to adjust the product-level total."
            >
              <Select
                allowClear
                placeholder="Product-level total"
                aria-label="Variant to adjust"
                options={variants.map((variant) => ({
                  label: `${variant.name} — ${formatNumber(variant.stockQuantity)} units`,
                  value: variant.id,
                }))}
              />
            </Form.Item>
          ) : null}

          <Form.Item
            name="changeType"
            label="Change type"
            rules={[{ required: true, message: 'Choose a change type.' }]}
          >
            <Select
              aria-label="Inventory change type"
              options={ADJUSTABLE_CHANGE_TYPES.map((type) => ({
                label: INVENTORY_CHANGE_TYPE_LABEL[type],
                value: type,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="quantity"
            label="Quantity"
            rules={[{ required: true, message: 'Enter a quantity of units.' }]}
            extra={quantityHelp}
          >
            <InputNumber
              min={direction === 'signed' ? -MAX_ADJUSTMENT_QUANTITY : 1}
              max={MAX_ADJUSTMENT_QUANTITY}
              precision={0}
              step={1}
              style={{ width: '100%' }}
              aria-label="Quantity of units to adjust"
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label="Reason"
            rules={[
              { required: true, whitespace: true, message: 'A reason is required for the audit log.' },
              { min: MIN_REASON_LENGTH, message: `Use at least ${MIN_REASON_LENGTH} characters.` },
              { max: MAX_REASON_LENGTH, message: `Use at most ${MAX_REASON_LENGTH} characters.` },
            ]}
          >
            <Input.TextArea
              rows={2}
              maxLength={MAX_REASON_LENGTH}
              showCount
              placeholder="e.g. Supplier delivery received against PO-4471"
              aria-label="Reason for the stock adjustment"
            />
          </Form.Item>

          <div
            aria-live="polite"
            style={{
              padding: 12,
              borderRadius: 8,
              background: colorTokens.backgroundSubtle,
              border: `1px solid ${preview.valid ? colorTokens.borderColor : colorTokens.warning}`,
            }}
          >
            {preview.valid ? (
              <Typography.Text style={{ color: colorTokens.textSecondary, fontSize: fontTokens.fontSizeSmall }}>
                {`New balance: ${formatNumber(preview.resultingQuantity)} units (${resolveSignedDelta(changeType, Number(quantity) || 0) > 0 ? '+' : ''}${formatNumber(resolveSignedDelta(changeType, Number(quantity) || 0))})`}
              </Typography.Text>
            ) : (
              <Typography.Text style={{ color: colorTokens.warning, fontSize: fontTokens.fontSizeSmall }}>
                {preview.message}
              </Typography.Text>
            )}
          </div>

        {error ? (
          <Typography.Text
            role="alert"
            style={{
              display: 'block',
              marginTop: 12,
              color: colorTokens.error,
              fontSize: fontTokens.fontSizeSmall,
            }}
          >
            {error}
          </Typography.Text>
        ) : null}
      </Form>
      )}
    </>
  );
};

/** Overlay shell: dialog chrome, the confirmation gate and the submit buttons. */
export const StockAdjustmentModal: FC<StockAdjustmentModalProps> = ({
  open,
  product,
  variantId,
  onCancel,
  onSubmit,
  error,
}) => {
  // Ant Design 6 removed the static `Modal.confirm`; the context-bound
  // instance is the supported way to open a dialog from a component.
  const { modal } = App.useApp();
  const compact = useIsCompact();
  const [form] = Form.useForm<AdjustmentInput>();

  const variants = useMemo(
    () => product?.variants.filter((variant) => !variant.isArchived) ?? [],
    [product],
  );

  const watchedVariantId = Form.useWatch('variantId', form) ?? variantId;
  const watchedChangeType = Form.useWatch('changeType', form) ?? 'restock';
  const watchedQuantity = Form.useWatch('quantity', form) ?? 0;

  const currentQuantity = useMemo(() => {
    if (!product) return 0;
    if (!watchedVariantId) return product.totalStock;
    return variants.find((variant) => variant.id === watchedVariantId)?.stockQuantity ?? 0;
  }, [product, variants, watchedVariantId]);

  // Reset whenever a different product opens the dialog, so a previous entry can
  // never leak into a new adjustment.
  useEffect(() => {
    if (!open || !product) return;
    form.setFieldsValue({
      variantId,
      changeType: 'restock',
      quantity: undefined,
      reason: '',
    });
  }, [open, product, variantId, form]);

  const handleOk = async (): Promise<void> => {
    if (!product) return;
    const values = await form.validateFields();
    const validation = validateAdjustment({
      changeType: values.changeType,
      currentQuantity,
      reason: values.reason,
      quantity: values.quantity,
    });
    if (!validation.valid) return;

    // Zeroing available stock is destructive and immediately affects whether the
    // product is sellable, so it is confirmed through the context-bound modal
    // instance rather than submitted straight away.
    if (validation.resultingQuantity === 0 && CHANGE_DIRECTION[values.changeType] === 'decrease') {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: 'This will take the product out of stock',
          content: `${product.name} will have 0 units available and be marked Out of Stock. The change is recorded in the inventory log and is not undone automatically.`,
          okText: 'Record adjustment',
          cancelText: 'Go back',
          okButtonProps: { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    await onSubmit({
      productId: product.id,
      ...(values.variantId ? { variantId: values.variantId } : {}),
      changeType: values.changeType,
      quantity: values.quantity,
      reason: values.reason.trim(),
    });
  };

  const preview = validateAdjustment({
    changeType: watchedChangeType,
    quantity: Number.isInteger(watchedQuantity) ? watchedQuantity : Number.NaN,
    currentQuantity,
    reason: Form.useWatch('reason', form) ?? '',
  });

  return (
    <Modal
      open={open}
      title="Adjust stock"
      onCancel={onCancel}
      onOk={handleOk}
      okText="Record adjustment"
      cancelText="Cancel"
      width={compact ? '100%' : 520}
      mask={{ closable: false }}
      destroyOnHidden
      okButtonProps={{
        disabled: !preview.valid,
        style: { minHeight: layoutTokens.touchTargetMinSize },
      }}
      cancelButtonProps={{ style: { minHeight: layoutTokens.touchTargetMinSize } }}
    >
      <StockAdjustmentForm
        product={product}
        {...(variantId ? { variantId } : {})}
        form={form}
        currentQuantity={currentQuantity}
        onFinish={handleOk}
        {...(error ? { error } : {})}
      />
    </Modal>
  );
};

export default StockAdjustmentModal;
