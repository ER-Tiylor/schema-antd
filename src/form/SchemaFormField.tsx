/**
 * SchemaFormField：唯一可复用的字段绑定层。
 *
 * 普通 SchemaForm、EditableTable 活动行、FullEditableTable 每一行都复用它，
 * 不另建第二套 Form.Item 绑定。它负责：具名 Form.Item、dynamic 派生、
 * 隐藏时跳过校验、以及把用户交互交给 FormRuntimeHost 派发。
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Form } from 'antd';
import type { FormItemProps } from 'antd';

import { IS_DEV } from '../env';
import { SchemaField } from '../SchemaField';
import type { AnyFormFieldSchema, FieldMode, FormFieldSchema, ReadContext } from '../types';
import type { FormRuntimeHost } from './FormRuntimeHost';
import { useFormRuntimeHost } from './FormRuntimeHost';
import { deriveFieldState, normalizeFieldSchema, withDerivedProps } from './derive';
import type { DerivedFieldState } from './derive';
import { dedupeNamePaths, getNestedValue, namePathKey } from './namePath';

export interface SchemaFormFieldProps {
  /** 普通字段或 type: 'Custom' 的局部自定义字段 */
  schema: AnyFormFieldSchema;
  /** 只调整布局与错误展示，不改变绑定/校验/联动语义 */
  compact?: boolean;
  /** 表单级只读，优先于字段自身 mode */
  mode?: FieldMode;
  /** 表单级禁用，永远优先于字段配置 */
  disabled?: boolean;
}

const EMPTY_DEPS: NonNullable<FormFieldSchema['dynamic']>['dependencies'] = [];

/** 漏写 dependencies 的字段已提醒过，按字段名去重，避免千格表格刷屏 */
const warnedMissingDeps = new Set<string>();

/**
 * `dynamic.dependencies` 在契约里是必填，但配置可能来自 JS 或后端下发。
 * 缺了只会退化成静态字段（联动不生效），所以只在开发态提示一次，不抛错。
 */
function warnMissingDependencies(schema: AnyFormFieldSchema) {
  const key = namePathKey(schema.name);
  if (warnedMissingDeps.has(key)) return;
  warnedMissingDeps.add(key);
  console.warn(`[schema] 字段 "${key}" 配了 dynamic 却没有 dependencies，将按静态字段渲染`);
}

function SchemaFormFieldInner(props: SchemaFormFieldProps) {
  // 归一化必须早于 dynamic 判断：类型专有属性可能就地编译出 dependencies
  const schema = normalizeFieldSchema(props.schema);
  const dependencies = schema.dynamic?.dependencies;
  if (IS_DEV && schema.dynamic && !dependencies) warnMissingDependencies(schema);
  const reactive = Boolean(
    dependencies?.length || schema.linkage?.some((rule) => rule.immediate),
  );
  return reactive ? (
    <ReactiveField {...props} schema={schema} />
  ) : (
    <FieldBody {...props} schema={schema} />
  );
}

export const SchemaFormField = memo(SchemaFormFieldInner);

function FieldBody({ schema, compact, mode, disabled }: SchemaFormFieldProps) {
  const form = Form.useFormInstance();
  const host = useFormRuntimeHost();

  useEffect(() => host?.registerField(schema), [host, schema]);

  const readCtx: ReadContext = useMemo(
    () => ({
      get: (name) => form.getFieldValue(name),
      getValues: () => form.getFieldsValue(true),
    }),
    [form],
  );

  const derived = deriveFieldState(schema, readCtx);
  return <FieldContent schema={schema} compact={compact} mode={mode} disabled={disabled} derived={derived} />;
}

/** 静态字段不订阅；动态字段变化后仍复用相同的绑定与校验。 */
function ReactiveField(props: SchemaFormFieldProps) {
  const { schema } = props;
  const form = Form.useFormInstance();
  const host = useFormRuntimeHost();
  // immediate 规则的依赖：变更来源无关（初始化、回填、setData 都重算），
  // 与非 immediate 的“只响应用户交互”区分开。
  const immediateDeps = useMemo(
    () =>
      (schema.linkage ?? [])
        .filter((rule) => rule.immediate)
        .flatMap((rule) => rule.dependencies),
    [schema],
  );

  // 依赖订阅：用稳定 selector + ref 取最新依赖，
  // 避免把一个 NamePath 数组误当成单条嵌套路径传给 useWatch。
  const dependencies = schema.dynamic?.dependencies ?? EMPTY_DEPS;
  const watchDependencies = useMemo(
    () =>
      immediateDeps.length
        ? dedupeNamePaths([...dependencies, ...immediateDeps])
        : dependencies,
    [dependencies, immediateDeps],
  );
  const depsRef = useRef(watchDependencies);
  depsRef.current = watchDependencies;
  const selector = useMemo(
    () =>
      (values: Record<string, unknown>) =>
        depsRef.current.map((dep) => getNestedValue(values, dep)),
    [],
  );
  // useWatch 内部按 JSON 比较，值没变就返回同一个引用，可直接做 effect 依赖
  const watchedDeps = Form.useWatch(selector, { form, preserve: true });

  // schema 多为模块级常量，用 ref 兜住内联定义，避免每次渲染都重跑 immediate 规则
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  useEffect(() => {
    // undefined 是 useWatch 首帧占位，等它读到真实依赖值再跑，避免初始化跑两遍
    if (!immediateDeps.length || watchedDeps === undefined) return;
    host?.runImmediateRulesOf(schemaRef.current);
  }, [host, watchedDeps, immediateDeps.length]);

  return <FieldBody {...props} />;
}

function FieldContent({ schema, compact, mode, disabled, derived }: SchemaFormFieldProps & { derived: DerivedFieldState }) {
  const form = Form.useFormInstance();
  const host = useFormRuntimeHost();
  const visible = derived.visible;

  // 隐藏期间跳过校验：清掉历史错误，重新显示后按当时的规则恢复
  const nameKey = namePathKey(schema.name);
  useEffect(() => {
    if (!visible) {
      form.setFields([{ name: schema.name, errors: [] }]);
    }
    // name 用 nameKey 表达，避免数组字面量每次渲染都触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, form, nameKey]);

  const finalMode: FieldMode = mode ?? schema.mode ?? 'edit';
  if (finalMode === 'read') {
    // 只读态同样消费派生结果：props 里的 queryParams / options / format 必须透传
    return <ReadableSchemaFormField schema={schema} state={derived} compact={compact} />;
  }

  // dynamic.disabled 覆盖字段级 props.disabled；表单级 disabled 永远优先
  const finalDisabled = disabled ? true : derived.disabled;
  const rules = derived.rules;
  const field: FormFieldSchema = withDerivedProps(schema, derived.props);

  const itemProps: FormItemProps = {
    name: schema.name,
    // 表格单元格由列头承担标题，compact 不重复渲染 label
    label: compact ? undefined : schema.label,
    rules,
    dependencies: schema.dependencies,
    hidden: !visible,
    ...(compact ? { style: { marginBottom: 0 } } : null),
    ...schema.formItemProps,
  };

  return (
    <Form.Item {...itemProps}>
      <BoundField fieldSchema={schema} field={field} host={host} disabled={finalDisabled} />
    </Form.Item>
  );
}

interface BoundFieldProps {
  /** Form.Item 注入 */
  value?: unknown;
  /** Form.Item 注入 */
  onChange?: (value: unknown) => void;
  /** Form.Item 注入 */
  id?: string;
  fieldSchema: FormFieldSchema;
  field: FormFieldSchema;
  host: FormRuntimeHost | null;
  disabled?: boolean;
}

/**
 * Form.Item 固定以 value/onChange 注入，控件各自的受控属性名由 SchemaField 的注册表处理。
 * 事件顺序：先写 Form Store，再派发 events/linkage，保证 ctx.get() 读到新值。
 */
function BoundField({ value, onChange, id, fieldSchema, field, host, disabled }: BoundFieldProps) {
  const handleChange = (next: unknown, ...meta: unknown[]) => {
    // Form.Item 的受控写入是同步的，先落 Store 再派发，保证 ctx.get() 读到新值
    onChange?.(next);
    host?.dispatchUserChange(fieldSchema, next, meta);
  };

  return (
    <SchemaField schema={field} value={value} onChange={handleChange} disabled={disabled} id={id} />
  );
}

/**
 * 只读字段：轻量展示，订阅 Store 但不注册具名 Form.Item、不参与校验。
 *
 * 不注册指的是不传 name；label 与外层布局仍要走 Form.Item，
 * 否则整表只读后会只剩一列值、字段名全丢，和编辑态对不上。
 */
function ReadableSchemaFormField({
  schema,
  state,
  compact,
}: {
  schema: FormFieldSchema;
  state: DerivedFieldState;
  compact?: boolean;
}) {
  const form = Form.useFormInstance();
  const value = Form.useWatch(schema.name, { form, preserve: true } as never);
  // dynamic.visible 同样作用于只读态；普通表单隐藏即不渲染（表格由列自己保留 <td>）
  if (!state.visible) return null;
  return (
    <Form.Item
      label={compact ? undefined : schema.label}
      {...(compact ? { style: { marginBottom: 0 } } : null)}
      {...schema.formItemProps}
    >
      <SchemaField schema={withDerivedProps(schema, state.props)} value={value as never} mode="read" />
    </Form.Item>
  );
}
