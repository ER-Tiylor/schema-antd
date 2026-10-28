/**
 * 把 Form Store 的值合并回完整业务记录。
 *
 * 只合并普通对象；数组、日期等整体替换。表单里被显式清空（undefined）的字段
 * 必须覆盖初始值，不能被旧数据“复活”。
 *
 * EditableTable 与 FullEditableTable 共用，避免各自实现一份合并策略。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function mergeInto(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      result[key] = undefined;
      continue;
    }
    result[key] = isPlainObject(value) ? mergeInto(result[key], value) : value;
  }
  return result;
}

export function mergeRowValues<T extends object>(initial: T, values: unknown): T {
  if (!isPlainObject(values)) return { ...initial };
  // 初始记录本身不是普通对象时（极少见）直接以表单值为准
  return mergeInto(initial, values) as T;
}
