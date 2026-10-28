import type { AppOption, SelectId } from './types';

/** 键序稳定的序列化，避免同一个 queryParams 因对象字面量顺序不同而重复请求 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * 空 ID 的统一口径：`undefined` / `null` / `''` 都视为未选择。
 * 后端序列化空值常给空串，若只判 null 会多跑一次 resolve('')。
 */
export function isEmptyId(value: SelectId | null | undefined): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * 必需的查询参数是否齐备。
 * 缺任何一个都不该发请求——用空条件解析，可能拿到别的租户/省份的记录。
 */
export function hasRequiredParams(
  required: string[] | undefined,
  params: Record<string, unknown> | undefined,
): boolean {
  if (!required || !required.length) return true;
  return required.every((key) => {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

/**
 * 选项内容键：父组件每次渲染新建数组时，用它判断内容是否真的变了。
 * 用内容而不是引用做依赖，才符合设计文档 §10 的要求。
 */
export function optionsContentKey(list?: AppOption[] | null): string {
  if (!list || !list.length) return '';
  return stableStringify(
    list.map((item) => [typeof item.value, item.value, item.label, item.disabled ?? false]),
  );
}

/** 解析缓存键：必须覆盖 source + value + queryParams，并可带权限命名空间 */
export function buildResolveKey(parts: {
  scope?: string;
  sourceKey: string;
  value: SelectId;
  params?: Record<string, unknown>;
}): string {
  return [parts.scope ?? '', parts.sourceKey, typeof parts.value, String(parts.value), stableStringify(parts.params ?? null)].join('|');
}

/** 把 AntD Select 的选中项选项收敛成标准 AppOption */
export function normalizeOption(option: unknown): AppOption | undefined {
  if (!option || typeof option !== 'object') return undefined;
  const record = option as { value?: SelectId; label?: unknown; disabled?: boolean; raw?: unknown };
  if (record.value === undefined) return undefined;
  return {
    value: record.value,
    label: typeof record.label === 'string' ? record.label : String(record.label ?? record.value),
    disabled: record.disabled,
    raw: record.raw,
  };
}

/** 已选项 + 候选合并去重，已选项优先，保证回显标签不被搜索结果覆盖 */
export function mergeOptions(
  selected: AppOption | null,
  ...groups: (AppOption[] | undefined)[]
): AppOption[] {
  const map = new Map<SelectId, AppOption>();
  if (selected) map.set(selected.value, selected);
  for (const group of groups) {
    for (const option of group ?? []) {
      if (!map.has(option.value)) map.set(option.value, option);
    }
  }
  return [...map.values()];
}
