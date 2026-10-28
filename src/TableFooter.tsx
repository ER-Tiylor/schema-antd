/**
 * 两个可编辑表格共用的工具条：新增按钮 + 插槽 + 批量删除。
 *
 * 位置由 placement 决定（默认底部；顶部与老家族 BatchEdit 的工具条一致），
 * 按钮顺序固定为「新增 → 插槽 → 批量删除」：插槽紧跟新增按钮是既有约定，
 * 批量删除是危险操作，放最右端避免误触。位置变化不改变顺序语义。
 *
 * 插槽是 render props：调用方拿到的 ctx 与 ref 上的行操作能力一致，
 * 快捷录入之类的弹窗确认后可以直接 addRow，不必再额外持一份 ref。
 */
import type { CSSProperties, ReactNode } from 'react';
import { Button } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import type { ToolbarPlacement } from './types';

/** 工具条能拿到的行操作能力；两边表格都提供 */
export interface TableFooterContext<T> {
  addRow(record?: Partial<T>): void;
  /** 当前已确认的数据快照，不含正在编辑的草稿 */
  getDataSync(): T[];
}

interface TableFooterProps {
  addText?: string;
  /** 不传则不渲染新增按钮（只留插槽） */
  onAdd?: () => void;
  disabled?: boolean;
  extra?: ReactNode;
  /** 批量删除文案，默认「批量删除」 */
  batchDeleteText?: string;
  /** 已选行数；为 0 时批量删除不可点 */
  selectedCount?: number;
  /** 不传则不渲染批量删除按钮（只留新增与插槽） */
  onBatchDelete?: () => void;
  /** 工具条位置，默认底部 */
  placement?: ToolbarPlacement;
  /** 内置按钮是否带图标（新增 / 批量删除），默认不带 */
  showIcon?: boolean;
}

const BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export function TableFooter({
  addText = '新增',
  onAdd,
  disabled,
  extra,
  batchDeleteText = '批量删除',
  selectedCount = 0,
  onBatchDelete,
  placement = 'bottom',
  showIcon,
}: TableFooterProps) {
  if (!onAdd && !extra && !onBatchDelete) return null;

  return (
    <div
      className="schema-table-footer"
      style={
        placement === 'top'
          ? { ...BASE_STYLE, marginTop: 8, marginBottom: 8 }
          : { ...BASE_STYLE, marginTop: 8 }
      }
    >
      {onAdd ? (
        <Button
          type="dashed"
          disabled={disabled}
          icon={showIcon ? <PlusOutlined /> : undefined}
          onClick={onAdd}
        >
          {addText}
        </Button>
      ) : null}
      {extra}
      {onBatchDelete ? (
        <Button
          danger
          disabled={disabled || selectedCount === 0}
          icon={showIcon ? <DeleteOutlined /> : undefined}
          onClick={onBatchDelete}
        >
          {batchDeleteText}
          {selectedCount > 0 ? `（${selectedCount}）` : ''}
        </Button>
      ) : null}
    </div>
  );
}
