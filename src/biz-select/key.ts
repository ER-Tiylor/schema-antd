/**
 * 稳定键推导。
 *
 * 缓存和 effect 都只认一个字符串，所以「源是谁」必须能算成一个 key。
 * 四档由强到弱：注册名 → 显式 cacheKey → 纯数据内容 → 函数引用。
 * 只有最后一档会在内联箭头函数下抖动，此时退化为实例级缓存（见设计文档 §7）。
 */
import { getSelectSourceVersion } from './registry';
import { nameSourceKey } from './source-id';
import type { SelectCode, SelectParams, SelectSource } from './types';
import { optionsContentKey } from './format';

const fnIds = new WeakMap<object, number>();
let fnIdSeq = 0;

/** 函数引用 → 稳定编号；模块级导出的函数因此可以跨实例共享缓存 */
function fnId(fn: object): number {
  const hit = fnIds.get(fn);
  if (hit !== undefined) return hit;
  fnIdSeq += 1;
  fnIds.set(fn, fnIdSeq);
  return fnIdSeq;
}

/**
 * 源的稳定身份，参与缓存键。
 *
 * 注册名带版本号：重新注册或主动失效后，已挂载的实例会换 key 重新取数，
 * 而不是继续用挂载时捕获的旧函数。
 */
export function selectSourceKey(
  source?: string | SelectSource,
  cacheKey?: string,
): string {
  // 注册名本身就是跨实例稳定的身份，版本号也在里面：再传 cacheKey 只会把它盖掉，
  // 连带绕过 invalidate / 重注册的失效机制。cacheKey 只服务内联源。
  if (typeof source === 'string') {
    return nameSourceKey(source, getSelectSourceVersion(source));
  }
  if (cacheKey) return `c:${cacheKey}`;
  if (!source) return '';

  const parts = [source.load, source.search, source.resolve, source.namespace].map((fn) =>
    fn ? fnId(fn) : '-',
  );
  if (parts.every((part) => part === '-')) {
    // 纯数据源没有闭包，按内容识别才安全，且写在 JSX 里也能命中同一份缓存
    return `d:${optionsContentKey(source.options)}`;
  }
  return `f:${parts.join('.')}`;
}

/** 键序稳定的序列化：对象字面量顺序不同不算参数变化 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function paramsKeyOf(params?: SelectParams): string {
  return stableStringify(params ?? null);
}

/** 来源键固定占第二段，清理单个源的缓存时按它匹配 */
export function candidatesCacheKey(scope: string, sourceKey: string, paramsKey: string): string {
  return `${scope}|${sourceKey}|${paramsKey}`;
}

export function resolveCacheKey(
  scope: string,
  sourceKey: string,
  code: SelectCode,
  paramsKey: string,
): string {
  return `${scope}|${sourceKey}|r|${typeof code}:${code}|${paramsKey}`;
}
