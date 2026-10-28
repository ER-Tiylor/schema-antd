/**
 * 字段状态的统一派生（统一运行契约 §3）。
 *
 * `dynamic` 是字段的运行时派生配置，不是编辑态专属配置：
 * 编辑态与只读态必须共用这一份求值逻辑，两种模式只在
 * 属性下发、校验、事件与写入行为上不同，派生结果本身一致。
 */
import type { Derived, FieldSchema, FormFieldSchema, ReadContext, Rule } from '../types';
import { getNestedValue } from './namePath';

export interface DerivedFieldState {
  /** 显示优先级：dynamic.visible > visible > !hidden > true */
  visible: boolean;
  /** 仅 dynamic.disabled 的结果；表单级 disabled 由调用方优先合并 */
  disabled?: boolean;
  /** 仅 dynamic.props 的覆盖项；静态 props 由调用方浅合并 */
  props?: Record<string, unknown>;
  /** 隐藏时规则为空：隐藏期间跳过校验 */
  rules: Rule[];
}

function resolveDerived<T>(value: Derived<T> | undefined, ctx: ReadContext, fallback: T): T {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? (value as (readCtx: ReadContext) => T)(ctx) : value;
}

function isRequiredRule(rule: Rule): boolean {
  return (rule as { required?: boolean }).required === true;
}

/** dynamic.required 必须形成真实校验，而不只是星号 */
function withRequired(rules: Rule[], required: boolean, label?: unknown): Rule[] {
  if (required) {
    if (rules.some(isRequiredRule)) return rules;
    const labelText = typeof label === 'string' && label ? label : '该项';
    return [{ required: true, message: `请填写${labelText}` }, ...rules];
  }
  return rules.filter((rule) => !isRequiredRule(rule));
}

/**
 * 计算字段当前的有效状态。派生函数必须是纯函数，只依赖 dynamic.dependencies 声明的字段。
 */
export function deriveFieldState(schema: FormFieldSchema, ctx: ReadContext): DerivedFieldState {
  const dynamic = schema.dynamic;

  const visible =
    dynamic?.visible !== undefined
      ? resolveDerived(dynamic.visible, ctx, true)
      : schema.visible !== undefined
        ? schema.visible
        : !schema.hidden;

  const disabled =
    dynamic?.disabled === undefined ? undefined : resolveDerived(dynamic.disabled, ctx, false);
  const props = dynamic?.props === undefined ? undefined : resolveDerived(dynamic.props, ctx, {});

  let rules: Rule[] =
    dynamic?.rules === undefined ? (schema.rules ?? []) : resolveDerived(dynamic.rules, ctx, []);
  if (dynamic?.required !== undefined) {
    rules = withRequired(rules, resolveDerived(dynamic.required, ctx, false), schema.label);
  }
  if (!visible) rules = [];

  return { visible, disabled, props, rules };
}

/** 把 dynamic.props 浅合并到静态 props 上，用于编辑态与只读态共用同一份有效属性 */
export function withDerivedProps<T extends FieldSchema>(
  schema: T,
  props?: Record<string, unknown>,
): T {
  if (!props || !Object.keys(props).length) return schema;
  return { ...schema, props: { ...schema.props, ...props } };
}

/**
 * 用行记录构造只读上下文。
 *
 * 单活动行表格的 Form Store 里只有活动行的草稿，普通行没有自己的 Form，
 * 必须从 record 取数；用 Form 会读到活动行的值（错行）。
 * `getValues()` 因此返回整条行记录，而不是整表值。
 */
export function createRecordReadContext(record: unknown): ReadContext {
  return {
    get: (name) => getNestedValue(record, name),
    getValues: () =>
      record && typeof record === 'object' ? (record as Record<string, unknown>) : {},
  };
}
