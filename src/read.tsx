/**
 * 只读展示的内置格式化。
 *
 * 原则：宁缺毋猜。用 schema 里真实存在的 options / treeData / dataSource 解析 label；
 * 解析不到就显示原始值或占位符，绝不把 ID 伪装成名称，也不发请求去猜。
 */
import type { ReactNode } from 'react';
import dayjs from 'dayjs';

import type { FieldDefinition } from './registry';
import type { FieldSchema } from './types';

export const EMPTY_TEXT = '—';

const DATE_TYPES = new Set(['DatePicker']);
const TIME_TYPES = new Set(['TimePicker']);
const BOOLEAN_TYPES = new Set(['Checkbox']);
const OPTION_TYPES = new Set(['Select', 'RadioGroup', 'CheckboxGroup', 'TreeSelect', 'Cascader']);
const UPLOAD_TYPES = new Set(['Upload']);
const TRANSFER_TYPES = new Set(['Transfer']);

/** 多值展示分隔符：与数组默认展示保持一致 */
const MULTI_SEPARATOR = '、';
/** Cascader 层级分隔符 */
const PATH_SEPARATOR = ' / ';

interface OptionNode {
  label?: unknown;
  title?: unknown;
  value?: unknown;
  key?: unknown;
  children?: unknown;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function toDateText(value: unknown, props: Record<string, unknown>): string {
  const date = dayjs.isDayjs(value) ? value : dayjs(value as string | number | Date);
  if (!date.isValid()) return EMPTY_TEXT;
  const format = typeof props.format === 'string' ? props.format : 'YYYY-MM-DD';
  return date.format(format);
}

function toTimeText(value: unknown, props: Record<string, unknown>): string {
  const time = dayjs.isDayjs(value) ? value : dayjs(value as string | number | Date);
  if (!time.isValid()) return EMPTY_TEXT;
  const format = typeof props.format === 'string' ? props.format : 'HH:mm:ss';
  return time.format(format);
}

/** 取节点的 label（TreeSelect 用 title，Transfer 用 title） */
function nodeLabel(node: OptionNode): string | undefined {
  const label = node.label ?? node.title;
  return typeof label === 'string' && label ? label : undefined;
}

/**
 * 深度查找：支持 TreeSelect / Cascader 的 children 嵌套。
 * 找不到返回 undefined，由调用方降级成原始值。
 */
function findLabelDeep(items: unknown, value: unknown): string | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const node = item as OptionNode;
    // TreeSelect 允许 value ?? key 的降级，这里照搬
    if ((node.value ?? node.key) === value) {
      return nodeLabel(node);
    }
    const nested = findLabelDeep(node.children, value);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Cascader：值是路径数组，逐层下钻后拼成「浙江 / 杭州」 */
function resolveCascaderPath(options: unknown, path: unknown[]): string {
  const labels: string[] = [];
  let level = options;
  for (const key of path) {
    if (!Array.isArray(level)) break;
    const node = level.find(
      (item) =>
        item && typeof item === 'object' && ((item as OptionNode).value ?? (item as OptionNode).key) === key,
    ) as OptionNode | undefined;
    if (!node) {
      // 中间层断了就把这一层及以下按原始值输出，不做半截猜测
      labels.push(String(key));
      level = undefined;
      break;
    }
    labels.push(nodeLabel(node) ?? String(key));
    level = node.children;
  }
  return labels.join(PATH_SEPARATOR);
}

/** 不同控件的选项容器不同 */
function getOptionItems(type: string, props: Record<string, unknown>): unknown {
  if (TRANSFER_TYPES.has(type)) return props.dataSource;
  if (type === 'TreeSelect') return props.treeData ?? props.options;
  return props.options ?? props.treeData;
}

function toPlainText(value: unknown, type: string, props: Record<string, unknown>): string {
  if (BOOLEAN_TYPES.has(type)) return value ? '是' : '否';
  if (DATE_TYPES.has(type)) return toDateText(value, props);
  if (TIME_TYPES.has(type)) return toTimeText(value, props);

  // Cascader 的路径数组必须整条解析，不能按普通多值拼
  if (type === 'Cascader' && Array.isArray(value)) {
    return resolveCascaderPath(getOptionItems(type, props), value);
  }

  if (OPTION_TYPES.has(type) || TRANSFER_TYPES.has(type)) {
    const items = getOptionItems(type, props);
    if (Array.isArray(value)) {
      return value
        .map((item) => findLabelDeep(items, item) ?? toPlainText(item, 'Input', {}))
        .join(MULTI_SEPARATOR);
    }
    const label = findLabelDeep(items, value);
    if (label !== undefined) return label;
  }

  // 上传控件：展示文件名，拿不到 name 就退回序号
  if (UPLOAD_TYPES.has(type) && Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (item && typeof item === 'object') {
          const file = item as { name?: unknown; url?: unknown };
          if (typeof file.name === 'string' && file.name) return file.name;
          if (typeof file.url === 'string' && file.url) return file.url;
        }
        return typeof item === 'string' ? item : `文件 ${index + 1}`;
      })
      .join(MULTI_SEPARATOR);
  }

  // 历史 {value,label} 协议：有 label 就用 label，没有就落到原始值
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const legacy = value as { label?: unknown };
    if (typeof legacy.label === 'string' && legacy.label) return legacy.label;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPlainText(item, 'Input', {})).join(MULTI_SEPARATOR);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';

  return String(value);
}

export function defaultRenderRead<TValue>(
  value: TValue | undefined,
  schema: FieldSchema<TValue>,
): ReactNode {
  if (isEmpty(value)) return EMPTY_TEXT;
  return toPlainText(value, schema.type, schema.props ?? {});
}

/** 只读内容优先级：schema.renderRead > 注册项 renderRead > 内置格式化 */
export function renderReadValue<TValue>(
  value: TValue | undefined,
  schema: FieldSchema<TValue>,
  definition?: FieldDefinition,
): ReactNode {
  if (schema.renderRead) {
    return schema.renderRead(value as TValue, schema);
  }
  if (definition?.renderRead) {
    return definition.renderRead(value, schema.props ?? {});
  }
  return defaultRenderRead(value, schema);
}
