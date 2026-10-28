import type { Key, ReactElement, ReactNode, Ref } from 'react';
import type { FormInstance, TableProps } from 'antd';

import type { TableFooterContext } from '../TableFooter';
import type { EditableColumn, NamePath, ToolbarPlacement } from '../types';

export interface RowValidationError {
  rowKey: Key;
  name: NamePath;
  messages: string[];
}

/**
 * 结构变化通知。
 *
 * 批量删除（勾选后删除）时**逐行触发**，且触发时表格数据已是删除后的状态：
 * 回调里调 `getDataSync()` 拿到的是删完的集合，被删行只通过这里的 `row` 提供。
 */
export interface RowStructureChange<T> {
  type: 'add' | 'insert' | 'remove' | 'replace';
  rowKey: Key;
  row?: T;
}

export interface FullEditableTableRef<T> {
  addRow(record?: Partial<T>): void;
  insertRow(anchorKey: Key, position: 'before' | 'after', record?: Partial<T>): void;
  removeRow(rowKey: Key): void;
  /** 按 rowOrder 读取每行常驻 Form 的当前值，合并未映射到表单的原始字段 */
  getDataSync(): T[];
  validate(): Promise<{ valid: true; rows: T[] } | { valid: false; errors: RowValidationError[] }>;
  submit(): Promise<void>;
  /** 显式替换整表数据并重建身份；动态属性重算，但不触发 linkage/events */
  setData(rows: T[]): void;
}

export interface FullEditableTableProps<T extends object>
  extends Omit<TableProps<T>, 'columns' | 'dataSource' | 'rowKey' | 'components'> {
  columns: EditableColumn<T>[];
  /** 只在初始化与 setData 时使用，不随 props 变化覆盖用户正在输入的内容；缺省为空表 */
  initialRows?: T[];
  /** 业务 rowKey；缺省时由组件生成稳定的本地 key */
  rowKey?: keyof T | ((row: T) => Key);
  createRow?: () => Partial<T>;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  /** 表体最大高度（scroll.y 的便捷入口）：超过后表体自身滚动；不传则整表撑开 */
  maxHeight?: number;
  /** 新增按钮（追加到末尾），默认显示 */
  showAddButton?: boolean;
  /** 新增按钮文案，默认「新增」 */
  addButtonText?: string;
  /** 行内操作列：插入按钮（默认插到本行之后），默认显示 */
  showInsertAction?: boolean;
  /** 行内操作列：删除按钮，默认显示 */
  showDeleteAction?: boolean;
  /** 插入位置，默认 after（插到本行之后） */
  insertPosition?: 'before' | 'after';
  /** 内置操作列的覆盖属性（标题 / 宽度 / fixed 等） */
  actionColumnProps?: Partial<EditableColumn<T>>;
  /** 底部新增按钮右侧插槽；不传则只渲染新增按钮 */
  renderFooterExtra?: (ctx: FullTableFooterContext<T>) => ReactNode;
  /** 行多选（勾选框），默认关闭；调用方自己传 rowSelection 时以调用方为准 */
  showRowSelection?: boolean;
  /** 底部批量删除按钮，默认关闭；只删勾选行，需同时开启 showRowSelection */
  showBatchDelete?: boolean;
  /** 批量删除文案，默认「批量删除」 */
  batchDeleteText?: string;
  /** 内置工具条（新增 / 插槽 / 批量删除）位置，默认顶部（与老家族 BatchEdit 一致） */
  toolbarPlacement?: ToolbarPlacement;
  /** 内置按钮是否带图标（新增 / 批量删除），默认不带 */
  showButtonIcon?: boolean;
  onSubmit?: (rows: T[]) => Promise<void> | void;
  /** 观察回调，不是组件内部正确性依赖的同步通道 */
  onRowValuesChange?: (rowKey: Key, changed: Partial<T>) => void;
  onRowsStructureChange?: (info: RowStructureChange<T>) => void;
  onValidationFailed?: (errors: RowValidationError[]) => void;
  /** 表级校验出口：行级校验全部通过后执行，返回错误则阻断提交 */
  onValidateRows?: (rows: T[]) => Promise<RowValidationError[] | void> | RowValidationError[] | void;
}

/** 底部插槽：比普通表格多一个插入能力 */
export interface FullTableFooterContext<T> extends TableFooterContext<T> {
  insertRow(anchorKey: Key, position: 'before' | 'after', record?: Partial<T>): void;
}

export interface FullTableRuntime<T> {
  getInitialRecord(key: string): T | undefined;
  registerForm(key: string, form: FormInstance): () => void;
  disabled?: boolean;
  onRowValuesChange?: (rowKey: Key, changed: Record<string, unknown>) => void;
}

export type FullEditableTableComponent = <T extends object>(
  props: FullEditableTableProps<T> & { ref?: Ref<FullEditableTableRef<T>> },
) => ReactElement;
