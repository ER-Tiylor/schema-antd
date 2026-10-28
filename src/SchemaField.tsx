/**
 * SchemaField：单字段渲染组件。
 *
 * 只负责“把一份扁平 Schema 渲染成一个受控控件或轻量只读内容”，
 * 不处理 name/label/rules，也不持有表单状态——这些属于 SchemaForm 层。
 */
import type { ReactNode } from 'react';

import type { FieldDefinition } from './registry';
import { getFieldDefinition } from './registry';
import { IS_DEV } from './env';
import { renderReadValue } from './read';
import type {
  AnyFieldSchema,
  CustomFieldSchema,
  CustomRenderContext,
  FieldMode,
  FieldSchema,
} from './types';

export interface SchemaFieldProps<TValue = unknown> {
  schema: AnyFieldSchema<TValue>;
  value?: TValue;
  /** 统一为 (value, ...meta)；Select/AppSelect 的 meta[0] 即选中项 */
  onChange?: (value: TValue, ...meta: unknown[]) => void;
  /** 高于 schema.mode */
  mode?: FieldMode;
  /** 运行态禁用，优先于 schema.props.disabled */
  disabled?: boolean;
  /** Form.Item 注入，用于 label 关联与 scrollToField */
  id?: string;
}

/** 这三个属性由 SchemaField 独占，schema.props 中的同名项必须剔除 */
const CONTROLLED_KEYS = ['value', 'defaultValue', 'onChange'];

interface EditorProps<TValue> {
  definition: FieldDefinition;
  schema: FieldSchema<TValue>;
  value?: TValue;
  onChange?: (value: TValue, ...meta: unknown[]) => void;
  disabled?: boolean;
  id?: string;
}

function Editor<TValue>({ definition, schema, value, onChange, disabled, id }: EditorProps<TValue>) {
  const Component = definition.component;
  const valuePropName = definition.valuePropName ?? 'value';

  const componentProps: Record<string, unknown> = { ...schema.props };
  for (const key of CONTROLLED_KEYS) delete componentProps[key];

  const finalDisabled = disabled ?? (schema.props?.disabled as boolean | undefined);

  const handleChange = (...args: unknown[]) => {
    const [rawValue, ...meta] = args;
    const nextValue = definition.getValueFromEvent
      ? definition.getValueFromEvent(...args)
      : rawValue;
    onChange?.(nextValue as TValue, ...meta);
  };

  return (
    <Component
      {...componentProps}
      {...{ [valuePropName]: value }}
      onChange={handleChange}
      {...(finalDisabled === undefined ? {} : { disabled: finalDisabled })}
      {...(id === undefined ? {} : { id })}
    />
  );
}

export function SchemaField<TValue = unknown>({
  schema,
  value,
  onChange,
  mode,
  disabled,
  id,
}: SchemaFieldProps<TValue>) {
  const finalMode: FieldMode = mode ?? schema.mode ?? 'edit';

  // 局部自定义字段：必须在查 Registry 之前拦下，否则会落到「未注册类型」的报错路径
  if (schema.type === 'Custom') {
    return (
      <CustomField
        schema={schema as CustomFieldSchema<TValue>}
        value={value}
        onChange={onChange}
        mode={finalMode}
        disabled={disabled}
        id={id}
      />
    );
  }

  const definition = getFieldDefinition(schema.type);

  if (finalMode === 'read') {
    return (
      <span className="schema-field schema-field-read">
        {renderReadValue(value, schema, definition)}
      </span>
    );
  }

  if (!definition) {
    // 未注册类型是配置错误，开发态直接炸出来，生产态降级为可见提示
    if (IS_DEV) {
      throw new Error(`[schema] 未注册的字段类型："${schema.type}"`);
    }
    return <span className="schema-field schema-field-error">未知字段类型：{schema.type}</span>;
  }

  // 编辑态不额外包 DOM，避免影响控件在表格单元格里的宽度与对齐
  return (
    <Editor
      definition={definition}
      schema={schema}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id={id}
    />
  );
}

interface CustomFieldProps<TValue> {
  schema: CustomFieldSchema<TValue>;
  value?: TValue;
  onChange?: (value: TValue, ...meta: unknown[]) => void;
  mode: FieldMode;
  disabled?: boolean;
  id?: string;
}

/** 只读空展示按 render 函数去重提示：schema 允许每帧重建，用函数引用才稳定 */
const warnedEmptyRead = new WeakSet<object>();

// TValue 在这里无关紧要，只取用于报错的身份信息，避免被泛型不变量卡住
function describeCustomField(schema: object): string {
  const extra = schema as { label?: unknown; name?: unknown };
  const parts: string[] = [];
  if (typeof extra.label === 'string' && extra.label) parts.push(extra.label);
  if (extra.name !== undefined) parts.push(`name=${JSON.stringify(extra.name)}`);
  return parts.length ? parts.join(' · ') : '未命名字段';
}

/** 配置错误：开发态直接抛，生产态给可见提示，不回退成普通输入 */
function failCustomField(schema: object, reason: string): ReactNode {
  const message = `[schema] 自定义字段配置错误（${reason}）：${describeCustomField(schema)}`;
  if (IS_DEV) throw new Error(message);
  return <span className="schema-field schema-field-error">自定义字段配置错误：{reason}</span>;
}

/**
 * 局部自定义字段：不查 Registry，把最终属性交给 schema.render。
 *
 * 属性组装（统一运行契约 §3.1）：dynamic.props 已在上层合并，这里补
 * disabled / id、剔除受控键，并保证 ctx.schema.props 与 ctx.props 同一引用。
 */
function CustomField<TValue>({
  schema,
  value,
  onChange,
  mode,
  disabled,
  id,
}: CustomFieldProps<TValue>) {
  if (typeof schema.render !== 'function') {
    return failCustomField(schema, 'render 必须是函数');
  }

  const props: Record<string, unknown> = { ...(schema.props ?? {}) };
  // schema.props 里的受控键不得覆盖表单注入的通道
  for (const key of CONTROLLED_KEYS) delete props[key];
  // 表单级 disabled / dynamic.disabled 已合并成 SchemaField.disabled
  if (disabled !== undefined) props.disabled = disabled;
  if (id !== undefined) props.id = id;

  const effectiveSchema: CustomFieldSchema<TValue> = { ...schema, props };

  if (mode === 'read') {
    // 只读 JSX 不套文本 span：render 可能返回块级元素或 Portal
    if (schema.renderRead) {
      return <>{schema.renderRead(value as TValue, effectiveSchema)}</>;
    }
    const node = schema.render({ mode: 'read', value, props, schema: effectiveSchema });
    if (IS_DEV && (node === null || node === undefined) && !warnedEmptyRead.has(schema.render)) {
      warnedEmptyRead.add(schema.render);
      console.warn(
        `[schema] 自定义字段的只读分支返回了 ${node === null ? 'null' : 'undefined'}：` +
          `${describeCustomField(schema)}。若无 renderRead，请确认是有意不展示。`,
      );
    }
    return <>{node}</>;
  }

  if (typeof onChange !== 'function') {
    return failCustomField(schema, '编辑态缺少 onChange');
  }

  const ctx: CustomRenderContext<TValue> = {
    mode: 'edit',
    value,
    onChange,
    props,
    schema: effectiveSchema,
  };
  return <>{schema.render(ctx)}</>;
}
