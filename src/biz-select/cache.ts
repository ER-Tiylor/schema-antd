/**
 * 候选与解析的共享缓存。
 *
 * 表格式页面里同一列的几十个单元格会各调一次源，因此在**来源键**这一层共享：
 * 同键并发只发一次请求，失败不缓存。
 * 调用方各自的取消只影响自己的状态更新，不打断共享中的请求。
 */
import type { BizOption } from './types';

/** 命中后的存活时间 */
const HIT_TTL = 5 * 60 * 1000;
/** 空结果的存活时间：别把「暂时查不到」当成长久不存在 */
const MISS_TTL = 30 * 1000;
/**
 * 条目上限。过期只在读到同一个 key 时才清理，没有上限的话，
 * 大量编码 × 参数组合会一直堆着。这里按插入顺序淘汰（FIFO），够用即可。
 */
const MAX_ENTRIES = 500;

/**
 * 缓存代次：clear 只清 Map，已经在途的请求稍后回来照样会写回旧数据。
 * 每次 clear 递增一代，写回时比对代次就能丢掉上一代的结果。
 */
let generation = 0;

interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

const candidateCache = new Map<string, CacheEntry<BizOption[]>>();
const resolveCache = new Map<string, CacheEntry<BizOption | null>>();

function take<T>(store: Map<string, CacheEntry<T>>, key: string): Promise<T> | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.promise;
}

function evict<T>(store: Map<string, CacheEntry<T>>): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
}

/** 请求发出后缓存被清过：这份结果属于上一代 */
function staleGeneration(startedGeneration: number): boolean {
  return startedGeneration !== generation;
}

/** 首次登记：只占位，不覆盖同键已有的请求（并发调用共享同一份 promise） */
function register<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  promise: Promise<T>,
  ttl: number,
  startedGeneration: number,
): void {
  if (staleGeneration(startedGeneration) || store.has(key)) return;
  store.set(key, { promise, expiresAt: Date.now() + ttl });
  evict(store);
}

/**
 * 结果写回：条目必须仍属于这次请求。
 *
 * 「条目不存在」也算失效——reload 换过一轮、新请求又失败了，此时写回去
 * 就是让旧数据复活。所以不能只看 `current && current.promise !== owner`。
 */
function settle<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  owner: Promise<unknown>,
  value: T,
  ttl: number,
  startedGeneration: number,
): void {
  if (staleGeneration(startedGeneration)) return;
  const current = store.get(key);
  if (!current || current.promise !== owner) return;
  store.set(key, { promise: Promise.resolve(value), expiresAt: Date.now() + ttl });
}

/** 失败清场：只删自己那一条，别误删已经接手的新请求 */
function dropOwn<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  owner: Promise<unknown>,
): void {
  if (store.get(key)?.promise === owner) store.delete(key);
}

export function loadCandidatesWithCache(
  key: string,
  loader: () => Promise<BizOption[]>,
): Promise<BizOption[]> {
  const cached = take(candidateCache, key);
  if (cached) return cached;

  const startedGeneration = generation;
  const promise = Promise.resolve()
    .then(loader)
    .then((list) => {
      const options = list ?? [];
      // 空结果只短暂记住
      settle(
        candidateCache,
        key,
        promise,
        options,
        options.length ? HIT_TTL : MISS_TTL,
        startedGeneration,
      );
      return options;
    })
    .catch((error) => {
      // 失败不缓存，下一次仍可重试
      dropOwn(candidateCache, key, promise);
      throw error;
    });
  register(candidateCache, key, promise, HIT_TTL, startedGeneration);
  return promise;
}

/** 丢掉单条候选缓存：reload() 要真正重取，不能又命中同一份 */
export function dropCandidateCache(key: string): void {
  candidateCache.delete(key);
}

export function resolveCodeWithCache(
  key: string,
  loader: () => Promise<BizOption | null>,
): Promise<BizOption | null> {
  const cached = take(resolveCache, key);
  if (cached) return cached;

  const startedGeneration = generation;
  const promise = loader()
    .then((option) => {
      settle(resolveCache, key, promise, option, option ? HIT_TTL : MISS_TTL, startedGeneration);
      return option;
    })
    .catch((error) => {
      dropOwn(resolveCache, key, promise);
      throw error;
    });
  register(resolveCache, key, promise, HIT_TTL, startedGeneration);
  return promise;
}

/** 来源键在缓存键里固定占第二段，因此用两侧分隔符即可精确匹配 */
function matchesSource(key: string, sourceKey: string): boolean {
  return key.startsWith(`${sourceKey}|`) || key.includes(`|${sourceKey}|`);
}

export function clearSelectCacheOfSource(sourceKey: string): void {
  generation += 1;
  for (const key of candidateCache.keys()) {
    if (matchesSource(key, sourceKey)) candidateCache.delete(key);
  }
  for (const key of resolveCache.keys()) {
    if (matchesSource(key, sourceKey)) resolveCache.delete(key);
  }
}

export function clearSelectCache(): void {
  generation += 1;
  candidateCache.clear();
  resolveCache.clear();
}

export function getSelectCacheSize(): number {
  return candidateCache.size + resolveCache.size;
}
