/**
 * 能力推导：从源「提供了什么」推「该怎么做」，不看类型标签。
 *
 * 这张推导表同时解释了三种来源（静态 / 有限枚举 / 无限表）——
 * 它们不是三种类型，是三种能力组合。
 */
import type { SelectParams, SelectSource } from './types';

export type CandidateMode =
  /** 同步全集，无需请求 */
  | 'sync'
  /** 异步全集，一次拉完前端过滤 */
  | 'load'
  /** 只有关键词搜索，过滤在后端 */
  | 'search'
  /** 空关键词走全集，有关键词走后端 */
  | 'hybrid'
  /** 没有候选能力，只能按编码解析（只读展示可用） */
  | 'none'
  /** 什么能力都没有，配置非法 */
  | 'invalid';

export interface SourceCapability {
  source?: SelectSource;
  candidateMode: CandidateMode;
  /** 候选是否需要发请求 */
  needsFetch: boolean;
  /** 是否在前端做关键词过滤 */
  canLocalFilter: boolean;
  /** 搜索交给后端 */
  canSearch: boolean;
  canResolve: boolean;
  requiredParams: string[];
  namespace?: () => string;
}

export function normalizeSource(source?: SelectSource): SourceCapability {
  const hasOptions = Array.isArray(source?.options);
  const canLoad = typeof source?.load === 'function';
  const canSearch = typeof source?.search === 'function';
  const canResolve = typeof source?.resolve === 'function';

  let candidateMode: CandidateMode;
  if (hasOptions) candidateMode = 'sync';
  else if (canLoad && canSearch) candidateMode = 'hybrid';
  else if (canLoad) candidateMode = 'load';
  else if (canSearch) candidateMode = 'search';
  else if (canResolve) candidateMode = 'none';
  else candidateMode = 'invalid';

  return {
    source,
    candidateMode,
    needsFetch: candidateMode === 'load' || candidateMode === 'search' || candidateMode === 'hybrid',
    canLocalFilter: hasOptions || canLoad,
    canSearch,
    canResolve,
    requiredParams: source?.requiredParams ?? [],
    namespace: source?.namespace,
  };
}

/**
 * 必需的查询参数是否齐备。
 * 缺任何一个都不该发请求——用空条件查，可能拿到别的租户/省份的记录。
 */
export function hasRequiredParams(
  required: string[] | undefined,
  params: SelectParams | undefined,
): boolean {
  if (!required || !required.length) return true;
  return required.every((key) => {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}
