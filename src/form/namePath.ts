/** NamePath 工具：契约要求所有路径比较都基于“规范化后的数组”，不做字符串猜测 */
import type { NamePath } from '../types';

export type NormalizedNamePath = (string | number)[];

export function normalizeNamePath(path: NamePath): NormalizedNamePath {
  return Array.isArray(path) ? path : [path];
}

/** 'customer.id' 与 ['customer','id'] 是两条不同路径，键也必须不同 */
export function namePathKey(path: NamePath): string {
  return JSON.stringify(normalizeNamePath(path));
}

export function isSameNamePath(a: NamePath, b: NamePath): boolean {
  return namePathKey(a) === namePathKey(b);
}

/** 合并依赖列表并去重，保持先后顺序 */
export function dedupeNamePaths(paths: NamePath[]): NamePath[] {
  const seen = new Set<string>();
  const result: NamePath[] = [];
  for (const path of paths) {
    const key = namePathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

/** 从整表值对象里按路径取值，用于 dynamic 依赖订阅 */
export function getNestedValue(values: unknown, path: NamePath): unknown {
  return normalizeNamePath(path).reduce<unknown>((current, key) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string | number, unknown>)[key];
  }, values);
}
