/**
 * EditableTable：单活动行编辑。
 *
 * 拓扑见《EditableTable 技术设计文档 v0.3 §7.2》：
 * `<Form component={false}>` 位于 Table 上层，只提供 Form Context；
 * 只有活动行的可编辑单元格挂载 SchemaFormField，其余行是只读内容，
 * 不创建 Form.Item，因此普通行没有表单成本。
 *
 * 数据权威：非编辑时为传入的 dataSource；编辑时 Form Store 只持有草稿，
 * 保存成功不隐式修改 props，等待上层刷新。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ForwardedRef, Key, ReactNode } from 'react';
import { Button, Form, Modal, Space, Table, message } from 'antd';
import type { FormInstance, TableProps } from 'antd';

import { IS_DEV } from '../env';
import { createRecordReadContext, deriveFieldState, withDerivedProps } from '../form/derive';
import { FormRuntimeHostProvider } from '../form/FormRuntimeHost';
import { SchemaFormField } from '../form/SchemaFormField';
import { namePathKey } from '../form/namePath';
import { mergeRowValues } from '../rowMerge';
import { TableFooter } from '../TableFooter';
import { resolveTableScroll } from '../tableScroll';
import { SchemaField } from '../SchemaField';
import type { EditableColumn, FieldSchema } from '../types';
import { cloneSnapshot, isEqualRow } from './dirty';
import type {
  DiscardConfirmContext,
  EditableRowActionContext,
  EditableTableComponent,
  EditableTableProps,
  EditableTableRef,
  EditingState,
} from './types';

const ACTION_COLUMN_KEY = '__schemaActions';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '保存失败';
}

/** 列协议自查：editable 必须有 field，且 field.name 与 dataIndex 完全一致 */
function warnColumnConfig<T extends object>(column: EditableColumn<T>) {
  const field = column.field;
  // 'read' 也是挂 field 的列，同样的协议校验对它成立
  const editable = Boolean(column.editable);
  const dataIndex = (column as { dataIndex?: unknown }).dataIndex;
  const title = String((column as { title?: unknown }).title ?? '');

  if (editable && !field) {
    console.error(`[EditableTable] 列 "${title}" 声明了 editable 但缺少 field`);
    return;
  }
  if (!editable || !field) return;

  if (dataIndex === undefined) {
    console.error(`[EditableTable] 列 "${title}" 缺少 dataIndex，无法把 field.name 映射到行数据`);
    return;
  }
  const indexPath = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  if (namePathKey(indexPath as (string | number)[]) !== namePathKey(field.name)) {
    console.error(
      `[EditableTable] 列 "${title}" 的 dataIndex=${JSON.stringify(dataIndex)} 与 field.name=${JSON.stringify(field.name)} 不一致；V1 要求二者为同一规范化 NamePath`,
    );
  }
}

function EditableTableInner<T extends object>(
  props: EditableTableProps<T>,
  ref: ForwardedRef<EditableTableRef<T>>,
) {
  const {
    columns,
    rowKey,
    dataSource,
    onSave,
    onDelete,
    onBeforeEditSwitch,
    confirmDiscard,
    onSaveError,
    onSetData,
    showActions = true,
    actionsColumnProps,
    renderActions,
    disabled,
    scroll,
    maxHeight,
    showAddButton,
    addButtonText,
    createRow,
    renderFooterExtra,
    showRowSelection,
    showBatchDelete,
    batchDeleteText,
    toolbarPlacement = 'top',
    showButtonIcon,
    // 可编辑表格默认不分页：分页会把行藏起来，与「逐行录入」的用法相冲
    pagination = false,
    ...tableProps
  } = props;

  /**
   * 新增按钮默认开启，但受控 dataSource 下组件自己加不了行：
   * 只有调用方接得上（createRow + onSetData）才默认显示，显式传值优先。
   */
  const addEnabled = showAddButton ?? (onSetData !== undefined && createRow !== undefined);

  const [form] = Form.useForm<T>();
  const [editing, setEditing] = useState<EditingState>({ status: 'idle' });

  // 回调与受控数据走 ref，避免命令式接口和单元格 render 频繁换身份
  const latestRef = useRef({
    onSave,
    onDelete,
    onBeforeEditSwitch,
    confirmDiscard,
    onSaveError,
    onSetData,
    renderActions,
    disabled,
    createRow,
  });
  latestRef.current = {
    onSave,
    onDelete,
    onBeforeEditSwitch,
    confirmDiscard,
    onSaveError,
    onSetData,
    renderActions,
    disabled,
    createRow,
  };

  const rowKeyRef = useRef(rowKey);
  rowKeyRef.current = rowKey;
  const getRowKey = useCallback((row: T): Key => {
    const current = rowKeyRef.current;
    if (typeof current === 'function') return current(row);
    return (row as Record<string, unknown>)[current as string] as Key;
  }, []);

  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;

  const editingRef = useRef(editing);
  editingRef.current = editing;

  /** 同步锁：setState 是异步的，冲突操作必须靠它立即挡住 */
  const busyRef = useRef(false);

  /** 进入编辑时的逻辑快照，判脏与 onSave(originalRow) 都用它 */
  const originalRef = useRef<T | null>(null);

  const findRow = useCallback(
    (key: Key): T | undefined => (dataSourceRef.current ?? []).find((row) => getRowKey(row) === key),
    [getRowKey],
  );

  const isDirtyNow = useCallback((): boolean => {
    const original = originalRef.current;
    if (!original) return false;
    const current = mergeRowValues(original, form.getFieldsValue(true));
    return !isEqualRow(original, current);
  }, [form]);

  const askDiscard = useCallback(async (ctx: DiscardConfirmContext<T>): Promise<boolean> => {
    const custom = latestRef.current.confirmDiscard;
    if (custom) return Boolean(await custom(ctx));
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '放弃未保存的修改？',
        content:
          ctx.reason === 'switch'
            ? '当前行有未保存的修改，切换到其他行后这些修改将丢失。'
            : '当前行有未保存的修改，退出编辑后这些修改将丢失。',
        okText: '放弃修改',
        cancelText: '继续编辑',
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, []);

  const beginEdit = useCallback(
    (row: T) => {
      originalRef.current = cloneSnapshot(row);
      // 先清空再写值：同一个 FormInstance 跨行复用，不能留下上一行的字段值
      form.resetFields();
      form.setFieldsValue(row as never);
      setEditing({ status: 'editing', rowKey: getRowKey(row) });
    },
    [form, getRowKey],
  );

  const endEdit = useCallback(() => {
    originalRef.current = null;
    form.resetFields();
    setEditing({ status: 'idle' });
  }, [form]);

  const requestEdit = useCallback(
    async (row: T) => {
      if (latestRef.current.disabled || busyRef.current) return;
      const targetKey = getRowKey(row);
      const current = editingRef.current;
      if (current.status !== 'idle' && current.rowKey === targetKey) return;

      if (current.status === 'editing') {
        const currentRow = findRow(current.rowKey);
        if (currentRow && isDirtyNow()) {
          const gate = latestRef.current.onBeforeEditSwitch;
          const allowed = gate
            ? Boolean(await gate(currentRow, row))
            : await askDiscard({ reason: 'switch', currentRow, nextRow: row });
          if (!allowed) return;
        }
      }

      // 校验/保存期间并发发起切换，前面已被 busyRef 挡住；这里再兜一次
      if (busyRef.current) return;
      beginEdit(row);
    },
    [askDiscard, beginEdit, findRow, getRowKey, isDirtyNow],
  );

  const handleSave = useCallback(async () => {
    const current = editingRef.current;
    if (current.status !== 'editing' || busyRef.current) return;

    const rowKeyValue = current.rowKey;
    busyRef.current = true;
    setEditing({ status: 'validating', rowKey: rowKeyValue });

    try {
      try {
        await form.validateFields();
      } catch {
        // 校验失败：保留草稿与编辑态，错误由 Form.Item 展示
        setEditing({ status: 'editing', rowKey: rowKeyValue });
        return;
      }

      setEditing({ status: 'saving', rowKey: rowKeyValue });
      const original = originalRef.current;
      const originalRow = (original ?? {}) as T;
      const nextRow = mergeRowValues(originalRow, form.getFieldsValue(true));

      try {
        // 返回 T 表示本次确认版本；V1 不做隐式乐观更新，展示等上层 dataSource
        await latestRef.current.onSave(nextRow, originalRow);
      } catch (error) {
        setEditing({ status: 'editing', rowKey: rowKeyValue });
        const fail = latestRef.current.onSaveError;
        if (fail) fail(error);
        else message.error(errorText(error));
        return;
      }

      endEdit();
    } finally {
      busyRef.current = false;
    }
  }, [endEdit, form]);

  const handleCancel = useCallback(async () => {
    const current = editingRef.current;
    if (current.status !== 'editing' || busyRef.current) return;
    if (isDirtyNow()) {
      const currentRow = findRow(current.rowKey);
      if (currentRow) {
        const allowed = await askDiscard({ reason: 'cancel', currentRow, nextRow: null });
        if (!allowed) return;
      }
    }
    endEdit();
  }, [askDiscard, endEdit, findRow, isDirtyNow]);

  const handleDelete = useCallback(async (row: T) => {
    const remove = latestRef.current.onDelete;
    if (!remove || busyRef.current) return;
    await remove(row);
  }, []);

  /** 勾选态只在开启多选时使用；批量删除没有勾选框就没有意义，所以它也会打开多选 */
  const selectable = showRowSelection === true || showBatchDelete === true;
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  // 行被外部移除（保存后刷新 / 删除）后，勾选里不能留下已经不存在的行
  useEffect(() => {
    if (selectedKeys.length === 0) return;
    const alive = new Set((dataSource ?? []).map((row) => String(getRowKey(row))));
    const next = selectedKeys.filter((key) => alive.has(String(key)));
    if (next.length !== selectedKeys.length) setSelectedKeys(next);
  }, [dataSource, getRowKey, selectedKeys]);

  const removeSelected = useCallback(async () => {
    if (selectedKeys.length === 0 || busyRef.current) return;

    const apply = latestRef.current.onSetData;
    if (!apply) {
      // dataSource 受控，组件没有自己的数据源，删除必须经由上层落地
      if (IS_DEV) {
        console.error('[EditableTable] 批量删除需要 onSetData：dataSource 受控，组件不能自己改数据');
      }
      return;
    }

    const keys = new Set(selectedKeys.map(String));
    const rows = dataSourceRef.current ?? [];
    const next = rows.filter((row) => !keys.has(String(getRowKey(row))));

    // 勾选里包含正在编辑的行时先确认：批量删除不能静默丢掉草稿
    const current = editingRef.current;
    const removesActive = current.status !== 'idle' && keys.has(String(current.rowKey));
    if (removesActive && isDirtyNow()) {
      const currentRow = findRow(current.rowKey);
      if (currentRow && !(await askDiscard({ reason: 'cancel', currentRow, nextRow: null }))) {
        return;
      }
    }

    busyRef.current = true;
    try {
      await apply(next);
    } catch (error) {
      // 按钮是 fire-and-forget 调用，错误必须在这里落地
      message.error(errorText(error));
      return;
    } finally {
      busyRef.current = false;
    }

    setSelectedKeys([]);
    if (removesActive) endEdit();
  }, [askDiscard, endEdit, findRow, getRowKey, isDirtyNow, selectedKeys]);

  const mergedRowSelection = useMemo(() => {
    // 调用方自带 rowSelection 时以调用方为准，内置勾选只是开关式的便捷入口
    if (tableProps.rowSelection) return tableProps.rowSelection;
    if (!selectable) return undefined;
    return {
      selectedRowKeys: selectedKeys,
      onChange: (keys: Key[]) => setSelectedKeys(keys),
    };
  }, [selectable, selectedKeys, tableProps.rowSelection]);

  /** 新增行等 dataSource 落地后再进入编辑：受控数据不在本次渲染周期内 */
  const pendingEditKeyRef = useRef<Key | null>(null);

  const addRow = useCallback(
    async (record?: Partial<T>) => {
      if (latestRef.current.disabled || busyRef.current) return;

      const apply = latestRef.current.onSetData;
      if (!apply) {
        // dataSource 受控，组件没有自己的数据源，新增必须经由上层落地
        if (IS_DEV) {
          console.error('[EditableTable] 新增行需要 onSetData：dataSource 受控，组件不能自己改数据');
        }
        return;
      }

      // 正在编辑且有草稿时，沿用退出编辑的确认流程
      if (editingRef.current.status !== 'idle') {
        if (isDirtyNow()) {
          const currentRow = findRow(editingRef.current.rowKey);
          if (currentRow && !(await askDiscard({ reason: 'cancel', currentRow, nextRow: null }))) {
            return;
          }
        }
        endEdit();
      }

      const nextRow = { ...(latestRef.current.createRow?.() ?? {}), ...(record ?? {}) } as T;
      const key = getRowKey(nextRow);
      if (key === undefined || key === null || key === '') {
        // 受控数据下 key 由上层数据决定，组件无法自造（自造会污染业务字段）
        if (IS_DEV) {
          console.error('[EditableTable] createRow 必须产出 rowKey 字段，否则新行无法定位');
        }
        return;
      }
      const rows = dataSourceRef.current ?? [];
      if (rows.some((row) => getRowKey(row) === key)) {
        if (IS_DEV) console.error(`[EditableTable] 新增行的 rowKey 已存在："${String(key)}"`);
        return;
      }

      busyRef.current = true;
      try {
        await apply([...rows, nextRow]);
      } catch (error) {
        // 按钮是 fire-and-forget 调用，错误必须在这里落地，不能变成未处理的 rejection
        message.error(errorText(error));
        return;
      } finally {
        busyRef.current = false;
      }
      pendingEditKeyRef.current = key;
    },
    [askDiscard, endEdit, findRow, getRowKey, isDirtyNow],
  );

  // 新行真正出现在 dataSource 后再进入编辑，否则会被「活动行已移除」的守卫立刻踢出
  useEffect(() => {
    const key = pendingEditKeyRef.current;
    if (key === null) return;
    const row = (dataSource ?? []).find((item) => getRowKey(item) === key);
    if (!row) return;
    pendingEditKeyRef.current = null;
    void requestEdit(row);
  }, [dataSource, getRowKey, requestEdit]);

  // 活动行被外部移除（例如删除后 dataSource 刷新）时必须退出编辑，避免残留草稿
  useEffect(() => {
    if (editing.status === 'idle') return;
    const stillExists = (dataSource ?? []).some((row) => getRowKey(row) === editing.rowKey);
    if (stillExists) return;
    if (IS_DEV) console.warn('[EditableTable] 活动行已不在 dataSource 中，自动退出编辑');
    originalRef.current = null;
    form.resetFields();
    setEditing({ status: 'idle' });
  }, [dataSource, editing, form, getRowKey]);

  const buildActionsColumn = useCallback(
    (busy: boolean): EditableColumn<T> => ({
      key: ACTION_COLUMN_KEY,
      title: '操作',
      width: 180,
      fixed: 'right' as const,
      ...actionsColumnProps,
      render: (_value: unknown, record: T): ReactNode => {
        const active = editing.status !== 'idle' && editing.rowKey === getRowKey(record);
        const ctx: EditableRowActionContext<T> = {
          row: record,
          active,
          busy,
          edit: () => void requestEdit(record),
          save: () => void handleSave(),
          cancel: () => void handleCancel(),
          remove: () => void handleDelete(record),
        };

        if (renderActions) return renderActions(ctx);

        return (
          <Space size={0}>
            {active ? (
              <>
                <Button size="small" type="link" disabled={busy} onClick={ctx.save}>
                  {editing.status === 'saving' ? '保存中…' : '保存'}
                </Button>
                <Button size="small" type="link" disabled={busy} onClick={ctx.cancel}>
                  取消
                </Button>
              </>
            ) : (
              <Button size="small" type="link" disabled={busy} onClick={ctx.edit}>
                编辑
              </Button>
            )}
            {onDelete ? (
              <Button size="small" type="link" danger disabled={busy} onClick={ctx.remove}>
                删除
              </Button>
            ) : null}
          </Space>
        );
      },
    }) as EditableColumn<T>,
    [actionsColumnProps, editing, getRowKey, handleCancel, handleDelete, handleSave, onDelete, renderActions, requestEdit],
  );

  const mergedColumns = useMemo(() => {
    const activeKey = editing.status === 'idle' ? null : editing.rowKey;
    const busy = editing.status === 'validating' || editing.status === 'saving';

    const mapColumn = (column: EditableColumn<T>): EditableColumn<T> => {
      const children = (column as { children?: EditableColumn<T>[] }).children;
      if (children?.length) {
        // 分组列只递归子列，自身不承载字段
        return { ...column, children: children.map(mapColumn) } as EditableColumn<T>;
      }

      if (IS_DEV) warnColumnConfig(column);

      const field = column.field;
      if (!field) return column;

      const originalRender = column.render;
      return {
        ...column,
        render: (value: unknown, record: T, index: number): ReactNode => {
          const active = activeKey !== null && getRowKey(record) === activeKey;
          if (active && column.editable && !disabled) {
            // 共享活动行 Form Store：不传 value，值由 Form.Item 从 Store 读写。
            // editable: 'read' 的列在活动行里同样只读：值跟随草稿，但不接受输入
            return (
              <SchemaFormField
                schema={field}
                compact
                mode={column.editable === 'read' ? 'read' : undefined}
                disabled={busy}
              />
            );
          }
          // 显式 render 优先于自动只读渲染（契约 §9.1）
          // antd 的 render 可能返回 RenderedCell，这里按 ReactNode 收窄
          if (originalRender) return originalRender(value, record, index) as ReactNode;

          // 普通行没有自己的 Form（Store 里只有活动行草稿）：
          // dynamic 必须用行记录派生，读 Form 会读到别的行。
          const derived = deriveFieldState(field, createRecordReadContext(record));
          // 表格只隐藏内容，<td> 结构由 AntD 保留
          if (!derived.visible) return null;
          return (
            <SchemaField
              schema={withDerivedProps(field as FieldSchema, derived.props)}
              value={value}
              mode="read"
            />
          );
        },
      } as EditableColumn<T>;
    };

    const mapped = columns.map(mapColumn);
    if (showActions && !disabled) {
      mapped.push(buildActionsColumn(editing.status === 'validating' || editing.status === 'saving'));
    }
    return mapped;
  }, [buildActionsColumn, columns, disabled, editing, getRowKey, showActions]);

  // maxHeight 是 scroll.y 的便捷入口，不传就完全沿用调用方的 scroll
  const mergedScroll = useMemo(
    () => resolveTableScroll<T>(scroll, maxHeight, 'EditableTable'),
    [scroll, maxHeight],
  );

  useImperativeHandle(
    ref,
    () => ({
      getDataSync: () => (dataSourceRef.current ?? []).slice(),
      getEditingDraftSync: () => {
        const original = originalRef.current;
        if (!original) return null;
        return mergeRowValues(original, form.getFieldsValue(true));
      },
      getEditingRowKey: () => {
        const current = editingRef.current;
        return current.status === 'idle' ? null : current.rowKey;
      },
      isEditing: () => editingRef.current.status !== 'idle',
      isDirty: isDirtyNow,
      cancelEdit: async () => {
        const current = editingRef.current;
        if (current.status === 'idle') return true;
        if (busyRef.current) return false;
        if (isDirtyNow()) {
          const currentRow = findRow(current.rowKey);
          if (currentRow) {
            const allowed = await askDiscard({ reason: 'cancel', currentRow, nextRow: null });
            if (!allowed) return false;
          }
        }
        endEdit();
        return true;
      },
      setData: async (rows: T[]) => {
        const apply = latestRef.current.onSetData;
        // 受控 dataSource 无法由组件自身替换，没接 onSetData 就是集成错误。
        // 放在最前面，避免先丢掉用户草稿再报错。
        if (!apply) {
          throw new Error('[EditableTable] dataSource 受控，setData 必须配合 onSetData 使用');
        }
        // 校验/保存中属于暂时冲突，不是错误；调用方稍后重试即可
        if (busyRef.current) return false;

        const current = editingRef.current;
        if (current.status !== 'idle' && isDirtyNow()) {
          const currentRow = findRow(current.rowKey);
          if (currentRow) {
            const allowed = await askDiscard({ reason: 'cancel', currentRow, nextRow: null });
            if (!allowed) return false;
          }
        }

        // 先交给上层，成功后才结束编辑：上层抛错时草稿必须还在
        busyRef.current = true;
        try {
          await apply(rows);
        } finally {
          busyRef.current = false;
        }
        endEdit();
        return true;
      },
    }),
    [askDiscard, endEdit, findRow, form, isDirtyNow],
  );

  // 工具条位置可配（默认顶部）；没有按钮也没有插槽时 TableFooter 自己返回 null
  const toolbar = (
    <TableFooter
      addText={addButtonText}
      onAdd={addEnabled ? () => void addRow() : undefined}
      disabled={disabled}
      extra={renderFooterExtra?.({
        addRow: (record) => void addRow(record),
        getDataSync: () => (dataSourceRef.current ?? []).slice(),
      })}
      batchDeleteText={batchDeleteText}
      selectedCount={selectedKeys.length}
      onBatchDelete={showBatchDelete ? () => void removeSelected() : undefined}
      placement={toolbarPlacement}
      showIcon={showButtonIcon}
    />
  );

  return (
    <Form<T> form={form as FormInstance<T>} component={false}>
      <FormRuntimeHostProvider form={form as FormInstance}>
        {toolbarPlacement === 'top' ? toolbar : null}
        <Table<T>
          {...tableProps}
          pagination={pagination}
          scroll={mergedScroll}
          rowKey={rowKey as TableProps<T>['rowKey']}
          dataSource={dataSource}
          columns={mergedColumns as TableProps<T>['columns']}
          rowSelection={mergedRowSelection}
        />
        {toolbarPlacement === 'bottom' ? toolbar : null}
      </FormRuntimeHostProvider>
    </Form>
  );
}

export const EditableTable = forwardRef(EditableTableInner) as unknown as EditableTableComponent;
