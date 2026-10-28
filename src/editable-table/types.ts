import type { Key, ReactElement, ReactNode, Ref } from 'react';
import type { TableProps } from 'antd';

import type { TableFooterContext } from '../TableFooter';
import type { EditableColumn, ToolbarPlacement } from '../types';

/** onSave 返回 T 表示“本次确认版本”，返回 void 表示由上层刷新 dataSource */
export type SaveResult<T> = T | void;

export type EditingState =
  | { status: 'idle' }
  | { status: 'editing'; rowKey: Key }
  | { status: 'validating'; rowKey: Key }
  | { status: 'saving'; rowKey: Key };

export interface DiscardConfirmContext<T> {
  /** switch：切换编辑行；cancel：取消/覆盖草稿 */
  reason: 'switch' | 'cancel';
  currentRow: T;
  nextRow: T | null;
}

export interface EditableRowActionContext<T> {
  row: T;
  /** 该行是否为当前活动行 */
  active: boolean;
  /** 校验或保存进行中，冲突操作应禁用 */
  busy: boolean;
  edit(): void;
  save(): void;
  cancel(): void;
  remove(): void;
}

export interface EditableTableProps<T extends object>
  extends Omit<TableProps<T>, 'columns' | 'rowKey'> {
  rowKey: keyof T | ((row: T) => Key);
  columns: EditableColumn<T>[];
  /** 仅在活动行校验通过后调用；抛错视为保存失败，草稿保留 */
  onSave(nextRow: T, originalRow: T): Promise<SaveResult<T>> | SaveResult<T>;
  onDelete?(row: T): Promise<void> | void;
  /** 有脏差异需要切换时优先使用它；返回 false 表示不切换 */
  onBeforeEditSwitch?(currentRow: T, nextRow: T): boolean | Promise<boolean>;
  /** 覆盖内置“放弃修改”确认框 */
  confirmDiscard?(ctx: DiscardConfirmContext<T>): boolean | Promise<boolean>;
  /** 保存抛错时的出口；未提供则内置提示一次 */
  onSaveError?(error: unknown): void;
  /** dataSource 受控时，ref.setData() 通过它向上层发出替换请求 */
  onSetData?(rows: T[]): void | Promise<void>;
  /** 默认 true：追加行尾操作列 */
  showActions?: boolean;
  actionsColumnProps?: Partial<EditableColumn<T>>;
  renderActions?(ctx: EditableRowActionContext<T>): ReactNode;
  /** 整表只读：不进入编辑、不渲染操作列 */
  disabled?: boolean;
  /** 表体最大高度（scroll.y 的便捷入口）：超过后表体自身滚动；不传则整表撑开 */
  maxHeight?: number;
  /**
   * 新增按钮（追加到末尾），默认开启。
   * dataSource 受控，组件自己加不了行：只有同时提供 createRow 与 onSetData 时才默认显示，
   * 显式传值优先（想关掉就传 false）。
   */
  showAddButton?: boolean;
  /** 新增按钮文案，默认「新增」 */
  addButtonText?: string;
  /** 新增行默认值；必须能产出唯一 rowKey，否则新增被拒绝 */
  createRow?: () => Partial<T>;
  /** 底部新增按钮右侧插槽；不传则只渲染新增按钮 */
  renderFooterExtra?: (ctx: TableFooterContext<T>) => ReactNode;
  /** 行多选（勾选框），默认关闭；调用方自己传 rowSelection 时以调用方为准 */
  showRowSelection?: boolean;
  /**
   * 底部批量删除按钮，默认关闭；只删勾选行。
   * dataSource 受控，删除同样经由 onSetData 落地。
   */
  showBatchDelete?: boolean;
  /** 批量删除文案，默认「批量删除」 */
  batchDeleteText?: string;
  /** 内置工具条（新增 / 插槽 / 批量删除）位置，默认顶部（与老家族 BatchEdit 一致） */
  toolbarPlacement?: ToolbarPlacement;
  /** 内置按钮是否带图标（新增 / 批量删除），默认不带 */
  showButtonIcon?: boolean;
}

export interface EditableTableRef<T extends object> {
  /** 仅返回已确认的 dataSource 快照，不含正在编辑的草稿 */
  getDataSync(): T[];
  /** 活动行草稿（原始行 + 表单值合并）；无活动行返回 null */
  getEditingDraftSync(): T | null;
  getEditingRowKey(): Key | null;
  isEditing(): boolean;
  /** 当前活动行是否有未保存差异 */
  isDirty(): boolean;
  /** 结束编辑并丢弃草稿；脏数据需确认，返回是否已退出 */
  cancelEdit(): Promise<boolean>;
  /**
   * 请求替换已确认数据，成功后才结束编辑；脏草稿需先确认。
   *
   * 返回值回答的是“这次请求是否已生效”，false 不是错误，调用方可以忽略：
   * - resolve true：onSetData 已成功执行；
   * - resolve false：未做任何改动——用户放弃覆盖，或被校验/保存占用（稍后重试）；
   * - reject：只有两种情况——未提供 onSetData（集成错误，须在丢草稿前暴露），
   *   或 onSetData 自身失败（草稿保留，原样上抛）。
   */
  setData(rows: T[]): Promise<boolean>;
}

export type EditableTableComponent = <T extends object>(
  props: EditableTableProps<T> & { ref?: Ref<EditableTableRef<T>> },
) => ReactElement;
