import { useCallback, useEffect, useRef, useState } from 'react';

import { IS_DEV } from '../env';
import { loadOptionsWithCache, resolveOptionWithCache } from './cache';
import { resolveAppSelectSource, resolveAppSelectSourceKey } from './sources';
import type { AppOption, AppSelectSource, SelectId } from './types';
import {
  buildResolveKey,
  hasRequiredParams,
  isEmptyId,
  optionsContentKey,
  stableStringify,
} from './utils';

/**
 * 已选 ID 的解析状态。
 * 设计文档 §6.4 要求区分 loading / empty / not-found / error，
 * 用户不能把「还在查」或「查不到」误认为业务值为空。
 * `blocked` 是「缺少必需查询参数」：为了不查出别家范围的数据，宁可不解析。
 */
export type SelectedOptionStatus =
  | 'empty'
  | 'loading'
  | 'resolved'
  | 'missing'
  | 'blocked'
  | 'error';

export interface SelectedOptionState {
  option: AppOption | null;
  status: SelectedOptionStatus;
}

export interface ResolvedSource {
  sourceObj?: AppSelectSource;
  /** 稳定来源键：只用于缓存与告警，不进入 effect 依赖 */
  sourceKey: string;
}

/** 内联源的「形状」：kind + 提供了哪几个能力，用来识别「同一份配置每次渲染新建」 */
function sourceShape(source?: AppSelectSource): string {
  if (!source) return '';
  return [
    source.kind,
    source.loadOptions ? 1 : 0,
    source.search ? 1 : 0,
    source.resolve ? 1 : 0,
    source.cacheNamespace ? 1 : 0,
  ].join(':');
}

/**
 * 每次渲染解析一次数据源，供候选与回显两条链路共用。
 * 缓存键必须与「实际生效的源」一致，所以统一在这里算，不在各 hook 里各算一遍。
 */
export function useResolvedSource(source?: string, dataSource?: AppSelectSource): ResolvedSource {
  const sourceObj = resolveAppSelectSource(source, dataSource);
  const sourceKey = resolveAppSelectSourceKey(source, dataSource);

  const previousRef = useRef({ key: sourceKey, shape: sourceShape(sourceObj) });
  const warnedMixedRef = useRef(false);
  const warnedChurnRef = useRef(false);

  if (IS_DEV) {
    if (source && dataSource && !warnedMixedRef.current) {
      warnedMixedRef.current = true;
      console.warn('[schema] AppSelect 同时传了 source 与 dataSource，以 dataSource 为准');
    }

    // 形状没变、键却变了：几乎可以确定是页面每次渲染都新建了 dataSource / 内联函数，
    // 缓存键会跟着失效（等同于不缓存），提示提到组件外或改用注册源。
    const previous = previousRef.current;
    if (
      !warnedChurnRef.current &&
      previous.key !== sourceKey &&
      previous.key.startsWith('inline:') &&
      sourceKey.startsWith('inline:') &&
      previous.shape === sourceShape(sourceObj)
    ) {
      warnedChurnRef.current = true;
      console.warn(
        '[schema] AppSelect 的 dataSource 每次渲染都产生新的函数引用，解析缓存会失效；' +
          '请把 dataSource 提到组件外，或改用 registerAppSelectSource 注册',
      );
    }
  }

  previousRef.current = { key: sourceKey, shape: sourceShape(sourceObj) };

  return { sourceObj, sourceKey };
}

interface CandidateOptionsParams extends ResolvedSource {
  queryParams?: Record<string, unknown>;
  debounceMs?: number;
}

/** 一批候选以及它所属的级联参数作用域（null = 与参数无关） */
interface CandidateState {
  paramsKey: string | null;
  list: AppOption[];
}

// 空数组用常量，避免每次渲染新建引用导致下游 memo 失效
const EMPTY_CANDIDATES: AppOption[] = [];
const NO_CANDIDATES: CandidateState = { paramsKey: null, list: EMPTY_CANDIDATES };

/**
 * 候选选项：静态/字典挂载时加载一次；remote 只在打开下拉或输入关键词后请求，
 * 避免表格首屏为每个单元格发默认候选请求。
 */
export function useCandidateOptions({
  sourceObj,
  sourceKey,
  queryParams,
  debounceMs = 300,
}: CandidateOptionsParams) {
  // 搜索回调需要读最新的 requiredParams，避免用旧配置判断范围参数
  const sourceRef = useRef(sourceObj);
  sourceRef.current = sourceObj;

  const paramsKey = stableStringify(queryParams ?? null);
  const paramsRef = useRef(queryParams);
  paramsRef.current = queryParams;

  // 候选必须带着「取回时的级联参数」一起存：参数一变旧候选立刻失效，
  // 否则切换省份后回显会先闪出一个别的省份的同 ID 名称。
  // paramsKey 为 null 表示与参数无关（静态 / 字典）。
  const [candidateState, setCandidateState] = useState<CandidateState>(NO_CANDIDATES);
  const candidates =
    candidateState.paramsKey === null || candidateState.paramsKey === paramsKey
      ? candidateState.list
      : EMPTY_CANDIDATES;
  const [loading, setLoading] = useState(false);

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
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const isRemote = sourceObj?.kind === 'remote';
  const searchFn = isRemote ? sourceObj?.search : undefined;
  const loadFn = !isRemote ? sourceObj?.loadOptions : undefined;

  // 静态 / 有限字典：加载一次即可，失败不抛给调用方
  useEffect(() => {
    if (!loadFn) {
      // 切到 remote 源时旧 effect 已被取消，这里要负责把 loading 和旧候选收掉
      setCandidateState(NO_CANDIDATES);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadOptionsWithCache(sourceKey, () => loadFn())
      .then((list) => {
        // 静态源的候选与级联参数无关，标记为 paramsKey: null
        if (!cancelled) setCandidateState({ paramsKey: null, list });
      })
      .catch(() => {
        if (!cancelled) setCandidateState(NO_CANDIDATES);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFn, sourceKey]);

  // 级联参数变化：取消在途请求；旧候选由上面的 paramsKey 比对挡住，不必清空
  useEffect(() => {
    cancelPending();
  }, [paramsKey, cancelPending]);

  const search = useCallback(
    (keyword: string) => {
      if (!searchFn) return;
      // 范围参数不全就不发搜索：否则用户会看到别的租户/省份的候选
      if (!hasRequiredParams(sourceRef.current?.requiredParams, paramsRef.current)) {
        cancelPending();
        setCandidateState({ paramsKey, list: EMPTY_CANDIDATES });
        setLoading(false);
        return;
      }
      cancelPending();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const seq = seqRef.current + 1;
        seqRef.current = seq;
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        searchFn(keyword, paramsRef.current, controller.signal)
          .then((list) => {
            // 记下请求发出时的 paramsKey：返回时参数已变，这批候选会被挡住
            if (seq === seqRef.current) setCandidateState({ paramsKey, list });
          })
          .catch(() => {
            if (seq === seqRef.current) setCandidateState({ paramsKey, list: EMPTY_CANDIDATES });
          })
          .finally(() => {
            if (seq === seqRef.current) setLoading(false);
          });
      }, debounceMs);
    },
    [searchFn, paramsKey, debounceMs, cancelPending],
  );

  return { sourceObj, candidates, loading, search, cancelPending };
}

interface SelectedOptionParams extends ResolvedSource {
  value?: SelectId | null;
  /** 对象模式自带的 label，可直接回显 */
  legacyLabel?: string;
  selectedOptions?: AppOption[];
  /** 当前已加载候选：解析顺序第 3 位，命中就不用再发 resolve */
  candidates?: AppOption[];
  queryParams?: Record<string, unknown>;
}

interface AsyncSelected {
  value: SelectId | undefined;
  sourceKey: string;
  paramsKey: string;
  option: AppOption | null;
  status: 'empty' | 'loading' | 'resolved' | 'missing' | 'blocked' | 'error';
}

const EMPTY_SELECTED: AsyncSelected = {
  value: undefined,
  sourceKey: '',
  paramsKey: '',
  option: null,
  status: 'empty',
};

/**
 * 已选 ID 的标签解析：与关键词搜索完全独立。
 *
 * 解析顺序见设计文档 §6.1：
 * 1. 匹配的 `selectedOptions`；2. 对象模式的 `value.label`；3. 已加载候选；
 * 4. `resolve(id, queryParams)`；5. 未命中就保持 ID，并暴露状态。
 */
export function useSelectedOption({
  sourceObj,
  sourceKey,
  value,
  legacyLabel,
  selectedOptions,
  candidates,
  queryParams,
}: SelectedOptionParams): SelectedOptionState {
  const sourceRef = useRef(sourceObj);
  sourceRef.current = sourceObj;
  const paramsRef = useRef(queryParams);
  paramsRef.current = queryParams;
  const paramsKey = stableStringify(queryParams ?? null);

  const empty = isEmptyId(value);
  const hint = empty ? undefined : selectedOptions?.find((item) => item.value === value);
  const candidate = empty ? undefined : candidates?.find((item) => item.value === value);

  // 前三级可以同步拿到结果。用内容键判断，父组件每次渲染新建数组不会触发重新解析。
  const syncKey = [
    empty ? 'empty' : `${typeof value}:${String(value)}`,
    legacyLabel ?? '',
    optionsContentKey(hint ? [hint] : undefined),
    optionsContentKey(candidate ? [candidate] : undefined),
  ].join('|');
  const syncRef = useRef<{ key: string; option: AppOption | null }>({ key: '', option: null });
  if (syncRef.current.key !== syncKey) {
    let option: AppOption | null = null;
    if (!empty) {
      const id = value as SelectId;
      if (hint) option = hint;
      else if (legacyLabel) option = { value: id, label: legacyLabel };
      else if (candidate) option = candidate;
    }
    syncRef.current = { key: syncKey, option };
  }
  const syncOption = syncRef.current.option;

  // 已经展示过的标签：用户继续输入关键词、候选被换掉时，已选项不该短暂退回原始 ID
  const knownRef = useRef<{
    value: SelectId;
    sourceKey: string;
    paramsKey: string;
    option: AppOption;
  } | null>(null);
  if (!empty && syncOption) {
    knownRef.current = { value: value as SelectId, sourceKey, paramsKey, option: syncOption };
  }

  const [asyncSelected, setAsyncSelected] = useState<AsyncSelected>(EMPTY_SELECTED);

  const isRemote = sourceObj?.kind === 'remote';
  const loadFn = !isRemote ? sourceObj?.loadOptions : undefined;
  const resolveFn = isRemote ? sourceObj?.resolve : undefined;
  // 范围参数不全：宁可不解析，也不能用空条件查出别家范围的数据
  const blocked = !hasRequiredParams(sourceObj?.requiredParams, paramsRef.current);

  useEffect(() => {
    // 前三级已经给出结果，不需要请求
    if (syncOption) return;
    if (empty) {
      setAsyncSelected(EMPTY_SELECTED);
      return;
    }
    if (!loadFn && !resolveFn) {
      setAsyncSelected({
        value: value as SelectId,
        sourceKey,
        paramsKey,
        option: null,
        status: 'missing',
      });
      return;
    }
    if (blocked) {
      setAsyncSelected({
        value: value as SelectId,
        sourceKey,
        paramsKey,
        option: null,
        status: 'blocked',
      });
      return;
    }

    let cancelled = false;
    const settle = (option: AppOption | null) => {
      if (cancelled) return;
      setAsyncSelected({
        value: value as SelectId,
        sourceKey,
        paramsKey,
        option,
        status: option ? 'resolved' : 'missing',
      });
    };
    const fail = () => {
      if (cancelled) return;
      setAsyncSelected({
        value: value as SelectId,
        sourceKey,
        paramsKey,
        option: null,
        status: 'error',
      });
    };

    setAsyncSelected({
      value: value as SelectId,
      sourceKey,
      paramsKey,
      option: null,
      status: 'loading',
    });

    if (loadFn) {
      // 静态 / 字典：本地集合里匹配
      loadOptionsWithCache(sourceKey, () => loadFn())
        .then((list) => settle(list.find((option) => option.value === value) ?? null))
        .catch(fail);
    } else {
      // 远程按 ID 精确解析，走共享缓存
      const key = buildResolveKey({
        scope: sourceRef.current?.cacheNamespace?.(),
        sourceKey,
        value: value as SelectId,
        params: paramsRef.current,
      });
      resolveOptionWithCache(key, () => resolveFn!(value as SelectId, paramsRef.current))
        .then(settle)
        .catch(fail);
    }

    return () => {
      cancelled = true;
    };
  }, [value, empty, syncOption, loadFn, resolveFn, blocked, sourceKey, paramsKey]);

  if (syncOption) return { option: syncOption, status: 'resolved' };
  if (empty) return { option: null, status: 'empty' };
  // 数据源没有解析能力时不必等 effect，直接给出 missing
  if (!loadFn && !resolveFn) return { option: null, status: 'missing' };
  if (blocked) return { option: null, status: 'blocked' };
  // 值 / 来源 / 级联参数变了但 effect 还没跑完：不能拿上一轮的结果顶上
  if (
    asyncSelected.value !== value ||
    asyncSelected.sourceKey !== sourceKey ||
    asyncSelected.paramsKey !== paramsKey
  ) {
    return { option: null, status: 'loading' };
  }
  if (asyncSelected.option) {
    knownRef.current = {
      value: value as SelectId,
      sourceKey,
      paramsKey,
      option: asyncSelected.option,
    };
  }
  // 正在按同一上下文重新解析：先沿用上次拿到的标签，避免一闪而过的原始 ID
  if (asyncSelected.status === 'loading' && knownRef.current) {
    const known = knownRef.current;
    if (known.value === value && known.sourceKey === sourceKey && known.paramsKey === paramsKey) {
      return { option: known.option, status: 'resolved' };
    }
  }
  return { option: asyncSelected.option, status: asyncSelected.status };
}
