import { clearAppSelectCacheOfSource } from './cache';
import type { AppSelectSource } from './types';

const sources = new Map<string, AppSelectSource>();

/** 注册应用级数据源；系统级常见字段优先走这里，低频页面可直接传 dataSource */
export function registerAppSelectSource(name: string, source: AppSelectSource): void {
  sources.set(name, source);
  // 同名重新注册（HMR / 动态切换）时旧缓存不再代表当前实现
  clearAppSelectCacheOfSource(name);
}

export function unregisterAppSelectSource(name: string): void {
  sources.delete(name);
  clearAppSelectCacheOfSource(name);
}

export function getAppSelectSource(name?: string): AppSelectSource | undefined {
  return name ? sources.get(name) : undefined;
}

/** source 与 dataSource 二选一，dataSource 优先，不做静默混合 */
export function resolveAppSelectSource(
  name?: string,
  dataSource?: AppSelectSource,
): AppSelectSource | undefined {
  return dataSource ?? getAppSelectSource(name);
}

export function clearAppSelectSources(): void {
  sources.clear();
}

const inlineIds = new WeakMap<object, number>();
let inlineIdSeq = 0;

function nextInlineId(target: object): number {
  let id = inlineIds.get(target);
  if (id === undefined) {
    inlineIdSeq += 1;
    id = inlineIdSeq;
    inlineIds.set(target, id);
  }
  return id;
}

/**
 * 来源的稳定身份，参与解析缓存键。
 *
 * 注册源直接用名字；内联 `dataSource` 没有名字，不能像旧实现那样统一退化成 `'inline'`，
 * 否则两个不同接口遇到相同 id + 相同参数会命中同一缓存，拿到别家的 label。
 *
 * 内联源优先按**函数引用**识别：模块级/页面级的 dataSource 常量函数引用稳定，
 * 表格里同一列的多个单元格因此还能共享一份解析缓存。
 * 只有完全没有函数的纯数据源才退回对象身份。
 */
export function resolveAppSelectSourceKey(
  name?: string,
  dataSource?: AppSelectSource,
): string {
  if (!dataSource) return name ? `source:${name}` : '';

  const functions = [
    dataSource.loadOptions,
    dataSource.search,
    dataSource.resolve,
    dataSource.cacheNamespace,
  ];
  const parts = functions.map((fn) => (fn ? nextInlineId(fn) : '-'));
  if (!parts.some((part) => part !== '-')) {
    return `inline:${dataSource.kind}:data#${nextInlineId(dataSource)}`;
  }
  return `inline:${dataSource.kind}:${parts.join('.')}`;
}
