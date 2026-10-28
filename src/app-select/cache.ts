/**
 * 已选 ID 的解析缓存。
 *
 * FullEditableTable V1 的硬前置：同源 in-flight 去重 + 轻量缓存。
 * 只能减少重复 ID 的请求，不同 ID 仍是不同请求。
 */
import type { AppOption } from './types';

const DEFAULT_TTL = 5 * 60 * 1000;
/** 解析不到时只短暂记住，避免把“暂时查不到”永久当成不存在 */
const MISS_TTL = 30 * 1000;

interface CacheEntry {
  promise: Promise<AppOption | null>;
  expiresAt: number;
}

const resolveCache = new Map<string, CacheEntry>();

/**
 * 同一个 key 的并发调用共享一次请求；失败不缓存，下次可重试。
 * 调用方各自的取消只影响自己的状态更新，不打断共享请求。
 */
export function resolveOptionWithCache(
  key: string,
  loader: () => Promise<AppOption | null>,
  ttl = DEFAULT_TTL,
): Promise<AppOption | null> {
  const now = Date.now();
  const cached = resolveCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = loader()
    .then((option) => {
      resolveCache.set(key, {
        promise: Promise.resolve(option),
        expiresAt: Date.now() + (option ? ttl : MISS_TTL),
      });
      return option;
    })
    .catch((error: unknown) => {
      resolveCache.delete(key);
      throw error;
    });

  resolveCache.set(key, { promise, expiresAt: now + ttl });
  return promise;
}

interface LoadEntry {
  promise: Promise<AppOption[]>;
  expiresAt: number;
}

/** 静态 / 有限字典集合的共享缓存：同一来源在同一窗口内只加载一次 */
const loadCache = new Map<string, LoadEntry>();

/**
 * 静态 / 字典集合的加载缓存。
 * 每个 AppSelect 单元格各自 loadOptions 会在表格里重复打同一批字典请求，
 * 因此按来源键共享；失败不缓存，下一次可重试。
 */
export function loadOptionsWithCache(
  key: string,
  loader: () => AppOption[] | Promise<AppOption[]>,
  ttl = DEFAULT_TTL,
): Promise<AppOption[]> {
  const now = Date.now();
  const cached = loadCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((list) => {
      const options = list ?? [];
      loadCache.set(key, { promise: Promise.resolve(options), expiresAt: Date.now() + ttl });
      return options;
    })
    .catch((error: unknown) => {
      loadCache.delete(key);
      throw error;
    });

  loadCache.set(key, { promise, expiresAt: now + ttl });
  return promise;
}

/**
 * 清掉某个注册源名下的缓存。
 * 重新注册同名源（常见于开发态 HMR）时必须调用，否则会继续读到旧实现的结果。
 */
export function clearAppSelectCacheOfSource(name: string): void {
  const sourceKey = `source:${name}`;
  const marker = `|${sourceKey}|`;
  // 集合缓存直接用来源键当 key；解析缓存的键是 scope|source|类型|值|参数
  const matches = (key: string) => key === sourceKey || key.includes(marker);
  for (const key of resolveCache.keys()) {
    if (matches(key)) resolveCache.delete(key);
  }
  for (const key of loadCache.keys()) {
    if (matches(key)) loadCache.delete(key);
  }
}

export function clearAppSelectCache(): void {
  resolveCache.clear();
  loadCache.clear();
}

export function getAppSelectCacheSize(): number {
  return resolveCache.size + loadCache.size;
}
