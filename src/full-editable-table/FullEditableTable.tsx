/**
 * FullEditableTable：全行常态编辑 + 结构增删 + 整表校验提交。
 *
 * V1 数据权威：每一行一个常驻 FormInstance；结构（rowOrder / rowKey）由
 * RowCollectionController 管理，输入不经过顶层状态镜像，避免整表重渲染。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ForwardedRef, Key } from 'react';
import { Button, Space, Table } from 'antd';
import type { FormInstance, TableProps } from 'antd';

import { IS_DEV } from '../env';
import { TableFooter } from '../TableFooter';
import { FullTableRuntimeContext } from './context';
import { EditableCell } from './EditableCell';
import { EditableRow } from './EditableRow';
import { mergeRowValues } from '../rowMerge';
import { resolveTableScroll } from '../tableScroll';
import type { EditableColumn } from '../types';
import type {
  FullEditableTableComponent,
  FullEditableTableProps,
  FullEditableTableRef,
  FullTableRuntime,
  RowStructureChange,
  RowValidationError,
} from './types';

/** Table 内部行身份字段，不写回业务数据 */
const ROW_KEY_FIELD = '__schemaRowKey';
/** 内置操作列的 key，与单活动行表格保持一致 */
const ACTION_COLUMN_KEY = '__schemaActions';

interface RowMeta<T> {
  key: string;
  initialRecord: T;
  /**
   * 交给 Table 的行对象，带内部身份字段。
   *
   * 身份必须跨「增删别的行」保持稳定：rc-table 的 BodyRow 没有 memo，
   * 行对象的引用一变，Cell 的 props 比较就失败，整张表的单元格都会重渲染
   * （实测 20 行 10 列加一行要 250ms，成本全在没变动的行上）。
   */
  record: T;
}

interface CollectionState<T> {
  rowOrder: string[];
  rowsByKey: Map<string, RowMeta<T>>;
}

const withRowKey = <T extends object>(row: T, key: string): T =>
  ({ ...row, [ROW_KEY_FIELD]: key }) as T;

function createCollection<T extends object>(
  rows: T[],
  keyFromRow: (row: T) => string | null,
  genKey: () => string,
): CollectionState<T> {
  const rowOrder: string[] = [];
  const rowsByKey = new Map<string, RowMeta<T>>();

  for (const row of rows) {
    const explicitKey = keyFromRow(row);
    let key = explicitKey ?? genKey();
    if (rowsByKey.has(key)) {
      if (IS_DEV) {
        console.error(`[FullEditableTable] rowKey 不唯一："${key}"，内部临时改用新 key，请检查数据`);
      }
      key = `${key}#${genKey()}`;
    }
    rowOrder.push(key);
    rowsByKey.set(key, { key, initialRecord: row, record: withRowKey(row, key) });
  }

  return { rowOrder, rowsByKey };
}

const TABLE_COMPONENTS = {
  body: { row: EditableRow, cell: EditableCell },
};

function FullEditableTableInner<T extends object>(
  props: FullEditableTableProps<T>,
  ref: ForwardedRef<FullEditableTableRef<T>>,
) {
  const {
    columns,
    initialRows,
    rowKey,
    createRow,
    minRows,
    maxRows,
    disabled,
    scroll,
    maxHeight,
    // 开箱即用：可编辑表格默认就带新增与行内增删，不需要每个页面重复声明
    showAddButton = true,
    addButtonText,
    showInsertAction = true,
    showDeleteAction = true,
    insertPosition = 'after',
    actionColumnProps,
    renderFooterExtra,
    showRowSelection,
    showBatchDelete,
    batchDeleteText,
    toolbarPlacement = 'top',
    showButtonIcon,
    // 可编辑表格默认不分页：分页会把行藏起来，与「逐行录入」的用法相冲
    pagination = false,
    onSubmit,
    onRowValuesChange,
    onRowsStructureChange,
    onValidationFailed,
    onValidateRows,
    ...tableProps
  } = props;

  // 所有回调走 ref，保证 imperative handle 与 row runtime 稳定
  const latestRef = useRef({
    createRow,
    minRows,
    maxRows,
    onSubmit,
    onRowValuesChange,
    onRowsStructureChange,
    onValidationFailed,
    onValidateRows,
    disabled,
  });
  latestRef.current = {
    createRow,
    minRows,
    maxRows,
    onSubmit,
    onRowValuesChange,
    onRowsStructureChange,
    onValidationFailed,
    onValidateRows,
    disabled,
  };

  const seqRef = useRef(0);
  const genKey = useCallback(() => `row_${(seqRef.current += 1)}`, []);

  const rowKeyPropRef = useRef(rowKey);
  rowKeyPropRef.current = rowKey;
  const keyFromRow = useCallback((row: T): string | null => {
    const current = rowKeyPropRef.current;
    if (current === undefined) return null;
    const value =
      typeof current === 'function'
        ? current(row)
        : (row as Record<string, unknown>)[current as string];
    // 缺失业务 key 时不能退化成字符串 "undefined"：多行会撞成同一个 key
    if (value === undefined || value === null) return null;
    return String(value);
  }, []);

  /**
   * 新行的内部身份：优先沿用业务 key（createRow 通常已经生成了本地 id），
   * 这样 addRow 之后仍然可以用 removeRow(record[rowKey]) 定位它；
   * 没有业务 key 或与现存行冲突时才生成本地 key。
   */
  const resolveNewRowKey = useCallback(
    (row: T, rowsByKey: Map<string, RowMeta<T>>) => {
      const explicitKey = keyFromRow(row);
      if (explicitKey === null) {
        // 本地 key 也要避开业务 key，否则两行的内部身份相同
        let localKey = genKey();
        while (rowsByKey.has(localKey)) localKey = genKey();
        return localKey;
      }
      if (!rowsByKey.has(explicitKey)) return explicitKey;
      if (IS_DEV) {
        console.error(
          `[FullEditableTable] 新行的 rowKey 与现存行重复："${explicitKey}"，内部改用本地 key，请检查数据`,
        );
      }
      return `${explicitKey}#${genKey()}`;
    },
    [genKey, keyFromRow],
  );

  const [collection, setCollection] = useState<CollectionState<T>>(() =>
    createCollection(initialRows ?? [], keyFromRow, genKey),
  );

  // 命令式操作需要读到最新快照，同时避免连续调用时的陈旧状态
  const collectionRef = useRef(collection);
  collectionRef.current = collection;

  const rowFormsRef = useRef(new Map<string, FormInstance>());

  const commit = useCallback((next: CollectionState<T>) => {
    collectionRef.current = next;
    setCollection(next);
  }, []);

  const runtime = useMemo<FullTableRuntime<T>>(
    () => ({
      getInitialRecord: (key) => collectionRef.current.rowsByKey.get(key)?.initialRecord,
      registerForm: (key, form) => {
        rowFormsRef.current.set(key, form);
        return () => {
          if (rowFormsRef.current.get(key) === form) {
            rowFormsRef.current.delete(key);
          }
        };
      },
      disabled,
      onRowValuesChange: (key, changed) =>
        latestRef.current.onRowValuesChange?.(key, changed as Partial<T>),
    }),
    // disabled 变化必须让单元格重新渲染
    [disabled],
  );

  const dataSource = useMemo(
    // 数组本身每次结构变更都是新的（Table 要据此更新行顺序），但行对象只在
    // 该行自己变化时才是新引用，未变动的行据此跳过单元格重渲染
    () => collection.rowOrder.map((key) => collection.rowsByKey.get(key)?.record as T),
    [collection],
  );

  const editableColumns = useMemo(
    () =>
      columns.map((column) => {
        if (!column.editable) return column;
        const originalOnCell = (column as { onCell?: (record: T) => Record<string, unknown> })
          .onCell;
        // 按行对象身份缓存 td 属性：行没变就返回同一个对象，rc-table 的 Cell
        // 才能靠 props 浅比较跳掉重渲染（行对象在增删别的行时是稳定的）
        const cellPropsCache = new WeakMap<T, Record<string, unknown>>();
        return {
          ...column,
          onCell: (record: T) => {
            const cached = cellPropsCache.get(record);
            // 属性不依赖行号，其他行增删不应使缓存失效。
            if (cached) return cached;
            const props = {
              ...(originalOnCell?.(record) ?? {}),
              field: column.field,
              // 'read' 列同样挂 field，但让绑定层按只读渲染：值仍来自本行 Form
              fieldMode: column.editable === 'read' ? ('read' as const) : undefined,
            };
            cellPropsCache.set(record, props);
            return props;
          },
        };
      }),
    [columns],
  );

  const notify = useCallback((info: RowStructureChange<T>) => {
    latestRef.current.onRowsStructureChange?.(info);
  }, []);

  const makeRecord = useCallback((record?: Partial<T>): T => {
    return { ...(latestRef.current.createRow?.() ?? {}), ...(record ?? {}) } as T;
  }, []);

  const overMax = useCallback(() => {
    const limit = latestRef.current.maxRows;
    if (limit !== undefined && collectionRef.current.rowOrder.length >= limit) {
      if (IS_DEV) console.warn(`[FullEditableTable] 已达 maxRows=${limit}，本次追加被忽略`);
      return true;
    }
    return false;
  }, []);

  const addRow = useCallback(
    (record?: Partial<T>) => {
      if (overMax()) return;
      const prev = collectionRef.current;
      const initial = makeRecord(record);
      const key = resolveNewRowKey(initial, prev.rowsByKey);
      const rowsByKey = new Map(prev.rowsByKey);
      rowsByKey.set(key, { key, initialRecord: initial, record: withRowKey(initial, key) });
      commit({ rowOrder: [...prev.rowOrder, key], rowsByKey });
      notify({ type: 'add', rowKey: key, row: initial });
    },
    [commit, makeRecord, notify, overMax, resolveNewRowKey],
  );

  const insertRow = useCallback(
    (anchorKey: Key, position: 'before' | 'after', record?: Partial<T>) => {
      if (overMax()) return;
      const prev = collectionRef.current;
      const index = prev.rowOrder.indexOf(String(anchorKey));
      if (index < 0) {
        if (IS_DEV) console.warn(`[FullEditableTable] insertRow 找不到锚点行 "${String(anchorKey)}"`);
        return;
      }
      const initial = makeRecord(record);
      const key = resolveNewRowKey(initial, prev.rowsByKey);
      const rowsByKey = new Map(prev.rowsByKey);
      rowsByKey.set(key, { key, initialRecord: initial, record: withRowKey(initial, key) });
      const rowOrder = [...prev.rowOrder];
      rowOrder.splice(position === 'before' ? index : index + 1, 0, key);
      commit({ rowOrder, rowsByKey });
      notify({ type: 'insert', rowKey: key, row: initial });
    },
    [commit, makeRecord, notify, overMax, resolveNewRowKey],
  );

  const removeRow = useCallback(
    (rowKeyValue: Key) => {
      const key = String(rowKeyValue);
      const prev = collectionRef.current;
      const meta = prev.rowsByKey.get(key);
      if (!meta) {
        if (IS_DEV) {
          console.warn(`[FullEditableTable] removeRow 找不到该行："${key}"，请确认传入的是行身份而不是其他字段`);
        }
        return;
      }

      const limit = latestRef.current.minRows;
      if (limit !== undefined && prev.rowOrder.length <= limit) {
        if (IS_DEV) console.warn(`[FullEditableTable] 已达 minRows=${limit}，本次删除被忽略`);
        return;
      }

      const rowsByKey = new Map(prev.rowsByKey);
      rowsByKey.delete(key);
      // 先移除注册，避免卸载 Effect 晚到又把已删除行登记回来
      rowFormsRef.current.delete(key);
      commit({ rowOrder: prev.rowOrder.filter((item) => item !== key), rowsByKey });
      notify({ type: 'remove', rowKey: key, row: meta.initialRecord });
    },
    [commit, notify],
  );

  /** 勾选态只在开启多选时使用；批量删除没有勾选框就没有意义，所以它也会打开多选 */
  const selectable = showRowSelection === true || showBatchDelete === true;
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  // 行被删掉（单行删除 / setData 重建）后，勾选里不能留下已经不存在的行身份
  useEffect(() => {
    if (selectedKeys.length === 0) return;
    const alive = selectedKeys.filter((key) => collection.rowsByKey.has(String(key)));
    if (alive.length !== selectedKeys.length) setSelectedKeys(alive);
  }, [collection, selectedKeys]);

  const removeRows = useCallback(
    (keys: Key[]) => {
      const prev = collectionRef.current;
      // 只删确实存在的行；重复 key 不占 minRows 的配额
      const existing = Array.from(new Set(keys.map(String))).filter((key) =>
        prev.rowsByKey.has(key),
      );
      if (existing.length === 0) return;

      const limit = latestRef.current.minRows;
      const allowed =
        limit === undefined ? existing.length : Math.max(0, prev.rowOrder.length - limit);
      if (allowed < existing.length && IS_DEV) {
        console.warn(`[FullEditableTable] minRows=${limit}，批量删除只执行前 ${allowed} 行`);
      }
      const removed = existing.slice(0, allowed);
      if (!removed.length) return;
      const removedSet = new Set(removed);
      const rowsByKey = new Map(prev.rowsByKey);
      removed.forEach(key => {
        rowsByKey.delete(key);
        rowFormsRef.current.delete(key);
      });
      commit({ rowOrder: prev.rowOrder.filter(key => !removedSet.has(key)), rowsByKey });
      // 保留逐行通知，回调读取到的是批量删除后的集合。
      removed.forEach(key => notify({ type: 'remove', rowKey: key, row: prev.rowsByKey.get(key)!.initialRecord }));
      setSelectedKeys(current => current.filter(key => !removedSet.has(String(key))));
    },
    [commit, notify],
  );

  const mergedRowSelection = useMemo(() => {
    // 调用方自带 rowSelection 时以调用方为准，内置勾选只是开关式的便捷入口
    if (tableProps.rowSelection) return tableProps.rowSelection;
    if (!selectable) return undefined;
    return {
      selectedRowKeys: selectedKeys,
      onChange: (keys: Key[]) => setSelectedKeys(keys),
    };
  }, [selectable, selectedKeys, tableProps.rowSelection]);

  const rowCount = collection.rowOrder.length;
  const atMaxRows = maxRows !== undefined && rowCount >= maxRows;
  const atMinRows = minRows !== undefined && rowCount <= minRows;

  // 内置操作列放在列定义之后，避免调用方既要手写删除列、又要和新增/插入按钮重复接线
  const tableColumns = useMemo(() => {
    const mapped = [...editableColumns] as EditableColumn<T>[];
    if (!showInsertAction && !showDeleteAction) return mapped;

    const actionColumn = {
      ...actionColumnProps,
      key: ACTION_COLUMN_KEY,
      title: actionColumnProps?.title ?? '操作',
      width: actionColumnProps?.width ?? (showInsertAction && showDeleteAction ? 110 : 70),
      render: (_: unknown, record: T) => {
        // 行身份来自内部 key 字段：业务 key 可能缺失，这里不能依赖它
        const key = String((record as Record<string, unknown>)[ROW_KEY_FIELD]);
        return (
          <Space size={0}>
            {showInsertAction ? (
              <Button
                type="link"
                size="small"
                disabled={disabled || atMaxRows}
                onClick={() => insertRow(key, insertPosition)}
              >
                插入
              </Button>
            ) : null}
            {showDeleteAction ? (
              <Button
                type="link"
                size="small"
                danger
                disabled={disabled || atMinRows}
                onClick={() => removeRow(key)}
              >
                删除
              </Button>
            ) : null}
          </Space>
        );
      },
    } as EditableColumn<T>;

    mapped.push(actionColumn);
    return mapped;
  }, [
    actionColumnProps,
    atMaxRows,
    atMinRows,
    disabled,
    editableColumns,
    insertPosition,
    insertRow,
    removeRow,
    showDeleteAction,
    showInsertAction,
  ]);

  const getDataSync = useCallback((): T[] => {
    const { rowOrder, rowsByKey } = collectionRef.current;
    return rowOrder.map((key) => {
      const meta = rowsByKey.get(key);
      const form = rowFormsRef.current.get(key);
      const values = form ? form.getFieldsValue(true) : {};
      return mergeRowValues((meta?.initialRecord ?? {}) as T, values);
    });
  }, []);

  const validate = useCallback(async () => {
    const { rowOrder } = collectionRef.current;
    const errors: RowValidationError[] = [];

    for (const key of rowOrder) {
      const form = rowFormsRef.current.get(key);
      if (!form) {
        // 注册表不完整意味着这一行会被漏校验，开发态必须暴露出来
        if (IS_DEV) console.error(`[FullEditableTable] 行 "${key}" 没有已注册的 FormInstance`);
        continue;
      }
      try {
        await form.validateFields();
      } catch (error) {
        const fields =
          (error as { errorFields?: { name: (string | number)[]; errors: string[] }[] })
            .errorFields ?? [];
        for (const field of fields) {
          errors.push({ rowKey: key, name: field.name, messages: field.errors });
        }
      }
    }

    const rows = getDataSync();
    if (errors.length) return { valid: false as const, errors };

    // 表级校验出口：行级全部通过后才执行
    const extra = await latestRef.current.onValidateRows?.(rows);
    if (extra && extra.length) return { valid: false as const, errors: extra };

    return { valid: true as const, rows };
  }, [getDataSync]);

  const submittingRef = useRef(false);
  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const result = await validate();
      if (!result.valid) {
        latestRef.current.onValidationFailed?.(result.errors);
        return;
      }
      await latestRef.current.onSubmit?.(result.rows);
    } finally {
      submittingRef.current = false;
    }
  }, [validate]);

  const setData = useCallback(
    (rows: T[]) => {
      const next = createCollection(rows, keyFromRow, genKey);
      commit(next);
      // 既有行刷新值：动态属性会重算，linkage/events 不触发
      next.rowsByKey.forEach((meta, key) => {
        rowFormsRef.current.get(key)?.setFieldsValue(meta.initialRecord as never);
      });
      notify({ type: 'replace', rowKey: '' });
    },
    [commit, genKey, keyFromRow, notify],
  );

  useImperativeHandle(
    ref,
    () => ({ addRow, insertRow, removeRow, getDataSync, validate, submit, setData }),
    [addRow, insertRow, removeRow, getDataSync, validate, submit, setData],
  );

  // maxHeight 是 scroll.y 的便捷入口，不传就完全沿用调用方的 scroll
  const mergedScroll = useMemo(
    () => resolveTableScroll<T>(scroll, maxHeight, 'FullEditableTable'),
    [scroll, maxHeight],
  );

  // 工具条位置可配（默认顶部）；没有按钮也没有插槽时 TableFooter 自己返回 null
  const toolbar = (
    <TableFooter
      addText={addButtonText}
      onAdd={showAddButton ? () => addRow() : undefined}
      disabled={disabled || atMaxRows}
      extra={renderFooterExtra?.({ addRow, insertRow, getDataSync })}
      batchDeleteText={batchDeleteText}
      selectedCount={selectedKeys.length}
      onBatchDelete={showBatchDelete ? () => removeRows(selectedKeys) : undefined}
      placement={toolbarPlacement}
      showIcon={showButtonIcon}
    />
  );

  return (
    <FullTableRuntimeContext.Provider value={runtime}>
      {toolbarPlacement === 'top' ? toolbar : null}
      <Table
        {...tableProps}
        pagination={pagination}
        scroll={mergedScroll}
        rowKey={ROW_KEY_FIELD}
        dataSource={dataSource}
        columns={tableColumns as TableProps<T>['columns']}
        components={TABLE_COMPONENTS as TableProps<T>['components']}
        rowSelection={mergedRowSelection}
      />
      {toolbarPlacement === 'bottom' ? toolbar : null}
    </FullTableRuntimeContext.Provider>
  );
}

export const FullEditableTable = forwardRef(
  FullEditableTableInner,
) as unknown as FullEditableTableComponent;
