/**
 * 候选选项：加载、搜索、防抖、取消、参数失效。
 *
 * 关键约束（设计文档 §5.3）：**effect / useCallback 的依赖里不出现源对象和其中的函数**。
 * 源一律从 ref 读，依赖只保留 sourceKey / paramsKey 这类字符串。
 * 违反这条的直接后果是：父组件每渲染一次，列表里每个单元格各发一次请求。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { dropCandidateCache, loadCandidatesWithCache } from './cache';
import { candidatesCacheKey, paramsKeyOf } from './key';
import { hasRequiredParams, normalizeSource } from './normalize';
import { resolveSelectSource } from './registry';
import { useStableSourceKey } from './useStableSourceKey';
import type { BizOption, SearchFields, SelectParams, SelectSource } from './types';
import { filterOptions } from './format';

export interface UseCandidatesOptions {
  /**
   * 注册名或内联源。解析与来源键都在 Hook 内完成：
   * 让调用方自己拼 sourceKey 就会绕开注册名的版本身份，组件和 Hook 表现不一致。
   */
  source?: string | SelectSource;
  /** 内联源需要跨实例共享缓存时显式指定；注册名自带稳定键 */
  cacheKey?: string;
  params?: SelectParams;
  /** 前端过滤匹配哪些字段 */
  searchFields: SearchFields;
  debounceMs?: number;
}

export interface UseCandidatesResult {
  /** 解析后的来源键，和组件用的是同一个身份；要传给别的 Hook 时直接用它 */
  sourceKey: string;
  /** 当前该给下拉看的候选：本地过滤型已按 keyword 过滤 */
  options: BizOption[];
  /**
   * 回显专用候选：优先取未过滤的全集。
   * 已选中的项可能被关键词过滤掉，用它查名称才不会退回编码。
   */
  echoOptions: BizOption[];
  /** 当前关键词：搜索中不要往结果里补回已选项 */
  keyword: string;
  loading: boolean;
  error: boolean;
  /** 缺少必需参数，主动不查 */
  blocked: boolean;
  /** 展开下拉：`load` 型在这里才发第一次请求 */
  open(): void;
  /** 输入关键词：后端搜索型防抖请求；本地过滤型只更新关键字 */
  search(keyword: string): void;
  /** 收起下拉时清掉关键字：不发请求，避免下次打开看到上次的过滤结果 */
  resetKeyword(): void;
  reload(): void;
}

/**
 * 结果归属：sourceKey 认来源、scope 认租户、paramsKey 认条件。
 * 少任何一段，切换来源/租户时就可能把上一份结果当成当前的。
 */
interface LoadState {
  sourceKey: string;
  scope: string;
  paramsKey: string;
  list: BizOption[];
}

interface SearchState {
  sourceKey: string;
  scope: string;
  paramsKey: string;
  keyword: string;
  list: BizOption[];
}

const EMPTY_OPTIONS: BizOption[] = [];

export function useCandidates({
  source: sourceProp,
  cacheKey,
  params,
  searchFields,
  debounceMs = 300,
}: UseCandidatesOptions): UseCandidatesResult {
  const source = resolveSelectSource(sourceProp);
  // 订阅版本在这里：失效 / 重注册后键会变，已挂载的实例才会重新取数
  const sourceKey = useStableSourceKey(sourceProp, cacheKey);
  const capability = normalizeSource(source);
  const { candidateMode, requiredParams, needsFetch } = capability;
  const paramsKey = paramsKeyOf(params);
  const blocked = !hasRequiredParams(requiredParams, params);

  // 源与参数只走 ref：它们可以每帧变化，但绝不能成为 effect 依赖
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const scopeRef = useRef('');
  scopeRef.current = source?.namespace?.() ?? '';
  // 当前作用域参与结果归属判断：只进缓存键不够，租户切换后旧候选仍会显示
  const scope = scopeRef.current;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;

  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [keyword, setKeyword] = useState('');
  // reload 在回调里要读当前关键词，不能进依赖（否则每次输入都换新函数）
  const keywordRef = useRef('');
  keywordRef.current = keyword;
  // load 与 search 各记一份：共用会互相覆盖，一个结束就把另一个的「进行中」抹掉
  const [loadLoading, setLoadLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(false);
  /** 递增表示「需要拉一次候选」：展开下拉或手动重载 */
  const [loadTick, setLoadTick] = useState(0);
  /** 下拉是否展开：纯搜索型只在展开时才跟着源 / 条件变化重查 */
  const openedRef = useRef(false);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    // 作废版本号才是正确性保障：abort 只是优化，源不认 signal 时仍会 resolve，
    // 那时 seq 已经对不上，不会把旧结果写成 error / 空列表
    seqRef.current += 1;
    // 被作废的请求不再回来收尾，loading 得在这里结束：否则关掉下拉后就一直转圈
    setSearchLoading(false);
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  // 加载全集：只在展开下拉之后发生，依赖全是字符串，源从 ref 取
  useEffect(() => {
    const current = sourceRef.current;
    const load = current?.load;
    // 上一次的请求被这次变更作废（cancelled）后不会自己收尾，提前返回时必须补关 loading
    if (!loadTick || blocked || !load) {
      setLoadLoading(false);
      return;
    }

    const key = candidatesCacheKey(scope, sourceKey, paramsKey);
    let cancelled = false;
    setLoadLoading(true);
    setError(false);
    loadCandidatesWithCache(key, () => load(paramsRef.current ?? {}, undefined))
      .then((list) => {
        if (!cancelled) setLoadState({ sourceKey, scope, paramsKey, list });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState({ sourceKey, scope, paramsKey, list: EMPTY_OPTIONS });
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadTick, sourceKey, scope, paramsKey, blocked, candidateMode]);

  // 身份变化（条件 / 来源 / 租户）：取消在途请求，旧结果靠三元比对自动失效。
  // scope 必须在这里：租户切了但 sourceKey、paramsKey 没变，在途请求照样得作废
  useEffect(() => {
    cancelPending();
    setKeyword('');
  }, [paramsKey, sourceKey, scope, cancelPending]);

  const runSearch = useCallback(
    (keywordValue: string, key: string) => {
      // 缺必需参数一律不查。open / reload 是公开入口（树、弹窗也会调），
      // 光靠组件上的 disabled 挡不住，守卫必须收在真正发请求的这一处
      if (blocked) return;
      const current = sourceRef.current;
      const search = current?.search;
      if (!search) return;

      const seq = seqRef.current + 1;
      seqRef.current = seq;
      const controller = new AbortController();
      abortRef.current = controller;
      // 归属信息在发请求时定格：结果回来后要能证明它属于哪个源、哪个租户
      const sourceKeyAtRequest = sourceKeyRef.current;
      const scopeAtRequest = scopeRef.current;
      setSearchLoading(true);
      setError(false);

      search(keywordValue, paramsRef.current ?? {}, controller.signal)
        .then((list) => {
          if (seq !== seqRef.current) return;
          setSearchState({
            sourceKey: sourceKeyAtRequest,
            scope: scopeAtRequest,
            paramsKey: key,
            keyword: keywordValue,
            list,
          });
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setSearchState({
            sourceKey: sourceKeyAtRequest,
            scope: scopeAtRequest,
            paramsKey: key,
            keyword: keywordValue,
            list: EMPTY_OPTIONS,
          });
          setError(true);
        })
        .finally(() => {
          if (seq === seqRef.current) setSearchLoading(false);
        });
    },
    [blocked],
  );

  const search = useCallback(
    (keywordValue: string) => {
      setKeyword(keywordValue);
      if (blocked || !needsFetch || candidateMode === 'load') return;
      if (candidateMode !== 'search' && candidateMode !== 'hybrid') return;

      cancelPending();
      const key = paramsKeyOf(paramsRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        runSearch(keywordValue, key);
      }, debounceMs);
    },
    [blocked, needsFetch, candidateMode, debounceMs, cancelPending, runSearch],
  );

  const searchStateRef = useRef<SearchState | null>(null);
  searchStateRef.current = searchState;

  const open = useCallback(() => {
    openedRef.current = true;
    setLoadTick((tick) => tick + 1);
    // 纯搜索型没有全集，展开时先取一次默认候选；已经取过就不重复请求
    const current = sourceRef.current;
    if (!current?.search || current.load) return;
    const key = paramsKeyOf(paramsRef.current);
    const state = searchStateRef.current;
    // 换了源或租户，旧结果不再代表当前范围，必须重查
    if (
      !state ||
      state.sourceKey !== sourceKeyRef.current ||
      state.scope !== scopeRef.current ||
      state.paramsKey !== key ||
      state.keyword !== ''
    ) {
      runSearch('', key);
    }
  }, [runSearch]);

  /** 收起下拉：清关键字并作废在途搜索，避免关掉之后才回来的结果写进状态 */
  const resetKeyword = useCallback(() => {
    openedRef.current = false;
    cancelPending();
    setKeyword('');
  }, [cancelPending]);

  /** 手动重取：绕开缓存。有关键词就重跑搜索，否则重拉全集 */
  const reload = useCallback(() => {
    cancelPending();
    const key = paramsKeyOf(paramsRef.current);
    const current = sourceRef.current;
    if (keywordRef.current && current?.search) {
      runSearch(keywordRef.current, key);
      return;
    }
    if (current?.load) {
      // 先删缓存再 bump，否则 effect 跑起来又会命中同一份
      dropCandidateCache(candidatesCacheKey(scopeRef.current, sourceKeyRef.current, key));
      setLoadTick((tick) => tick + 1);
      return;
    }
    if (current?.search) runSearch('', key);
  }, [cancelPending, runSearch]);

  /**
   * 纯搜索型没有 load effect 兜底：源失效、或父字段改了条件，而下拉还开着时，
   * 旧候选会一直挂在列表里（可能是别的仓库的记录）。这里补一次重查。
   * 带 load 的源由加载 effect 负责，不重复发请求。
   */
  const identityRef = useRef({ sourceKey, paramsKey, scope });
  useEffect(() => {
    const previous = identityRef.current;
    identityRef.current = { sourceKey, paramsKey, scope };
    if (!openedRef.current) return;
    if (
      previous.sourceKey === sourceKey &&
      previous.paramsKey === paramsKey &&
      previous.scope === scope
    ) {
      return;
    }
    const current = sourceRef.current;
    if (!current?.search || current.load) return;
    runSearch('', paramsKeyOf(paramsRef.current));
  }, [sourceKey, paramsKey, scope, runSearch]);

  const loadValid = Boolean(
    loadState &&
      loadState.sourceKey === sourceKey &&
      loadState.scope === scope &&
      loadState.paramsKey === paramsKey,
  );
  const searchValid = Boolean(
    searchState &&
      searchState.sourceKey === sourceKey &&
      searchState.scope === scope &&
      searchState.paramsKey === paramsKey &&
      searchState.keyword === keyword,
  );

  const options = useMemo(() => {
    if (blocked || candidateMode === 'invalid' || candidateMode === 'none') return EMPTY_OPTIONS;

    // 同步全集也要过本地过滤：filterOption=false 已关掉 antd 自带过滤，
    // 这里不处理的话静态源在输入框里根本筛不动
    if (candidateMode === 'sync') {
      return filterOptions(source?.options ?? EMPTY_OPTIONS, keyword, searchFields);
    }

    if (candidateMode === 'load') {
      if (!loadValid || !loadState) return EMPTY_OPTIONS;
      // 全集已在前端，关键字只做本地过滤
      return filterOptions(loadState.list, keyword, searchFields);
    }

    if (candidateMode === 'hybrid') {
      if (keyword) return searchValid && searchState ? searchState.list : EMPTY_OPTIONS;
      return loadValid && loadState ? loadState.list : EMPTY_OPTIONS;
    }

    return searchValid && searchState ? searchState.list : EMPTY_OPTIONS;
  }, [
    blocked,
    candidateMode,
    source,
    loadValid,
    loadState,
    searchValid,
    searchState,
    keyword,
    searchFields,
  ]);

  // 回显要用未过滤的候选：已选项可能正好被关键词筛掉
  const echoOptions = useMemo(() => {
    if (candidateMode === 'sync') return source?.options ?? EMPTY_OPTIONS;
    if (loadValid && loadState) return loadState.list;
    // 纯搜索型没有全集，只能用手上这批
    return options;
  }, [candidateMode, source, loadValid, loadState, options]);

  return {
    sourceKey,
    options,
    echoOptions,
    keyword,
    loading: loadLoading || searchLoading,
    error,
    blocked,
    open,
    search,
    resetKeyword,
    reload,
  };
}
