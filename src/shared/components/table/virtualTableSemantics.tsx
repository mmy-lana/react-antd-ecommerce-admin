import type { TableProps } from 'antd';
import { createElement, type ComponentType, type HTMLAttributes } from 'react';

/**
 * ARIA roles for Ant Design's `virtual` tables.
 *
 * A virtualized table is not rendered as a `<table>`. `rc-table` swaps in a
 * flex-column body whose rows and cells are plain `<div>`s, and the outer
 * wrapper is a `<div class="ant-table">` with no role either. The result is a
 * grid of unlabelled text nodes to a screen reader: no row count, no column
 * association, and no way to know a cell belongs to a row.
 *
 * `components.body.row` / `components.body.cell` is Ant Design's documented
 * escape hatch for exactly this, so the roles are re-attached here instead of
 * at each call site. Every other prop — `className`, `style`, `data-row-key`,
 * and the measurement ref the virtual body depends on — is forwarded
 * untouched, so virtualisation and sticky headers are unaffected.
 *
 * The header keeps its real `<table>`, so a screen reader still gets a grid
 * assembled from `columnheader` cells with `row`/`cell` rows beneath.
 */

type BodyRowProps<T> = HTMLAttributes<HTMLDivElement> & {
  record?: T;
  index?: number;
  renderIndex?: number;
};

type BodyCellProps<T> = HTMLAttributes<HTMLTableCellElement> & {
  record?: T;
  index?: number;
  renderIndex?: number;
};

const VirtualRow = <T,>({ className, ...rest }: BodyRowProps<T>) =>
  createElement('div', { ...rest, className, role: 'row' });

const VirtualCell = <T,>({ className, ...rest }: BodyCellProps<T>) =>
  createElement('div', { ...rest, className, role: 'cell' });

/**
 * Generic over the row type: `TableComponents<T>` is invariant in `T`, so a
 * single shared constant cannot be handed to two tables of different record
 * types. Call it per table: `components={virtualTableSemantics<Product>()}`.
 */
export const virtualTableSemantics = <T,>(): TableProps<T>['components'] => ({
  body: {
    row: VirtualRow<T> as ComponentType<HTMLAttributes<HTMLDivElement>>,
    cell: VirtualCell<T> as ComponentType<HTMLAttributes<HTMLTableCellElement>>,
  },
});
