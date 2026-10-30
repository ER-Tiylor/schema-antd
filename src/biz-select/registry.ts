/**
 * 业务下拉数据源注册表。
 *
 * 注册表存在的两个理由：给缓存一个稳定标识，给 schema 一个可序列化的引用
 * （schema 是数据，装不下函数）。
 */
import { clearSelectCache, clearSelectCacheOfSource } from './cache';
import { nameSourceKey } from './source-id';
import type { SelectSource } from './types';

const sources = new Map<string, SelectSource>();
/** 每次注册/失效都递增，进入来源键：已挂载实例因此能感知到源被换掉 */
const versions = new Map<string, number>();

/**
 * 版本订阅。版本号只存在 Map 里，单单改值不会让任何组件重渲染，
 * 所以「失效后已挂载实例重新取数」必须靠订阅把变化推给组件。
 */
const versionListeners = new Map<string, Set<() => void>>();

export function subscribeSelectSourceVersion(name: string, listener: () => void): () => void {
  const listeners = versionListeners.get(name) ?? new Set<() => void>();
  listeners.add(listener);
  versionListeners.set(name, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) versionListeners.delete(name);
  };
}

function bumpVersion(name: string): void {
  versions.set(name, (versions.get(name) ?? 0) + 1);
  versionListeners.get(name)?.forEach((listener) => listener());
}

/** 换实现时清掉上一版的缓存，否则旧结果会留到 TTL 结束 */
function clearPrevious(name: string, previousVersion: number): void {
  clearSelectCacheOfSource(nameSourceKey(name, previousVersion));
}

export function registerSelectSource(name: string, source: SelectSource): void {
  const previous = versions.get(name) ?? 0;
  sources.set(name, source);
  bumpVersion(name);
  // 同名重注册（HMR / 动态切换）后旧缓存不再代表当前实现
  clearPrevious(name, previous);
}

/** 批量注册：应用启动时一次写完 */
export function defineSelectSources(map: Record<string, SelectSource>): void {
  for (const [name, source] of Object.entries(map)) registerSelectSource(name, source);
}

export function unregisterSelectSource(name: string): void {
  const previous = versions.get(name) ?? 0;
  sources.delete(name);
  bumpVersion(name);
  clearPrevious(name, previous);
}

/** 让已挂载的实例重新取数：版本 +1 换 key，同时清掉旧结果 */
export function invalidateSelectSource(name: string): void {
  const previous = versions.get(name) ?? 0;
  bumpVersion(name);
  clearPrevious(name, previous);
}

export function getSelectSource(name?: string): SelectSource | undefined {
  return name ? sources.get(name) : undefined;
}

export function getSelectSourceVersion(name: string): number {
  return versions.get(name) ?? 0;
}

/** 注册名或内联源统一解析；传对象时直接用，不看名字 */
export function resolveSelectSource(
  source?: string | SelectSource,
): SelectSource | undefined {
  if (!source) return undefined;
  return typeof source === 'string' ? sources.get(source) : source;
}

export function getRegisteredSelectSourceNames(): string[] {
  return [...sources.keys()];
}

export function clearSelectSources(): void {
  sources.clear();
  versions.clear();
  // 版本 Map 一起清掉了，不主动通知的话订阅方永远等不到变化
  versionListeners.forEach((listeners) => listeners.forEach((listener) => listener()));
  clearSelectCache();
}
