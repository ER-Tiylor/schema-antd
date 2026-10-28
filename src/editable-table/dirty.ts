/**
 * 草稿判脏：按语义比较，不做 JSON.stringify（键顺序、Dayjs 实例、函数都会被误判）。
 *
 * - Date / dayjs（$d）/ moment（_d）：比较时间戳；
 * - 数组：长度 + 逐项；
 * - 普通对象：键并集 + 递归；缺失键与 undefined 视为相等；
 * - 其余对象（File、类实例等）：只认同引用，避免结构不同却 toString 相同导致误判。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    // dayjs 存 $d，moment 存 _d；两者都不可变，直接取值比较
    const inner = record.$d ?? record._d;
    if (inner instanceof Date) return inner.getTime();
  }
  return null;
}

export function isEqualValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;

  const aTime = toTimestamp(a);
  const bTime = toTimestamp(b);
  if (aTime !== null || bTime !== null) return aTime === bTime;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isEqualValue(item, b[index]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!isEqualValue(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

export function isEqualRow(a: unknown, b: unknown): boolean {
  return isEqualValue(a, b);
}

/**
 * 进入编辑时的逻辑快照。
 * 日期/对象控件值本身不可变，直接复用；嵌套普通对象与数组必须复制，
 * 否则后续合并不影响判脏、但外部改原对象会污染基线。
 */
export function cloneSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSnapshot(item)) as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = cloneSnapshot(item);
    }
    return result as T;
  }
  return value;
}
