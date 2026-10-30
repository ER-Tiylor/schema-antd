/**
 * 已选编码 → 名称的解析。
 *
 * 与关键词搜索是两条独立逻辑：搜索是模糊的，回显必须精确。
 * 优先级（设计文档 §5.6）：对象值自带的名称 → seedOptions → 已加载候选
 * → resolve(code) → 原样显示编码并暴露状态。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { resolveCodeWithCache } from './cache';
import { paramsKeyOf, resolveCacheKey } from './key';
import { hasRequiredParams, normalizeSource } from './normalize';
import type { BizOption, SelectCode, SelectParams, SelectSource } from './types';

export type SelectedStatus = 'empty' | 'loading' | 'resolved' | 'missing' | 'blocked' | 'error';

export interface UseSelectedLabelOptions {
  source?: SelectSource;
  sourceKey: string;
  code?: SelectCode;
  /** 对象值里自带的名称 */
  valueName?: string;
  seedOptions?: BizOption[];
  candidates?: BizOption[];
  params?: SelectParams;
}

export interface UseSelectedLabelResult {
  option: BizOption | null;
  status: SelectedStatus;
}

interface AsyncResult {
  sourceKey: string;
  /** 租户/权限隔离作用域：只进缓存键不够，切换后旧结果仍会被当成当前值 */
  scope: string;
  paramsKey: string;
  codeKey: string;
  option: BizOption | null;
  failed: boolean;
}

/** 编码比对统一走字符串：后端可能把 1 和 '1' 当同一个值 */
function sameCode(a: SelectCode | undefined, b: SelectCode | undefined): boolean {
  return a !== undefined && b !== undefined && String(a) === String(b);
}

function codeKeyOf(code?: SelectCode): string {
  return code === undefined || code === null ? '' : `${typeof code}:${code}`;
}

function findOption(list: BizOption[] | undefined, code: SelectCode): BizOption | undefined {
  return list?.find((item) => item.code === code);
}

export function useSelectedLabel({
  source,
  sourceKey,
  code,
  valueName,
  seedOptions,
  candidates,
  params,
}: UseSelectedLabelOptions): UseSelectedLabelResult {
  const capability = normalizeSource(source);
  const { canResolve, requiredParams } = capability;
  const paramsKey = paramsKeyOf(params);
  const codeKey = codeKeyOf(code);
  const scope = source?.namespace?.() ?? '';
  const blocked = !hasRequiredParams(requiredParams, params);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const codeRef = useRef(code);
  codeRef.current = code;

  const [asyncResult, setAsyncResult] = useState<AsyncResult | null>(null);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  /**
   * 已选项的兜底记忆。
   *
   * 搜索型源的候选会随关键词整批换掉，重新展开拿到的也只是默认第一页，
   * 已选项常常不在里面；没有 resolve 就只能退回编码。按
   * 「来源 + 租户 + 条件 + 编码」记住最近一次命中的选项，条件一变自然失效。
   */
  const memoryRef = useRef<{ key: string; option: BizOption } | null>(null);
  const memoryKey = `${sourceKey}|${scope}|${paramsKey}|${codeKey}`;

  // 本地能查到就不发请求；命中结果是对象，这里只取布尔作为 effect 依赖
  const seedHit = useMemo(
    () => (code === undefined ? undefined : findOption(seedOptions, code)),
    [seedOptions, code],
  );
  const candidateHit = useMemo(
    () => (code === undefined ? undefined : findOption(candidates, code)),
    [candidates, code],
  );
  const localHit = seedHit ?? candidateHit;
  const hasLocal = Boolean(localHit);
  // 对象值已经自带名称：展示层直接用，没有理由再发一次 resolve
  const hasValueName = Boolean(valueName);

  useEffect(() => {
    if (code === undefined || hasLocal || hasValueName || !canResolve || blocked) return;

    const resolve = sourceRef.current?.resolve;
    if (!resolve) return;

    const requested = codeRef.current as SelectCode;
    const key = resolveCacheKey(scope, sourceKey, requested, paramsKey);

    const seq = seqRef.current + 1;
    seqRef.current = seq;
    let cancelled = false;
    setLoading(true);

    // 不传 AbortSignal：这个 promise 是多个实例共享的，
    // 单个实例卸载不能把别人的请求掐掉，只放弃自己的状态更新即可
    resolveCodeWithCache(key, () => resolve(requested, paramsRef.current ?? {}))
      .then((option) => {
        if (cancelled || seq !== seqRef.current) return;
        // 接口返回了别的编码就别认：认错比认不出更糟，展示层会显示陌生名称。
        // 数字/字符串同一编码（后端序列化常见）认下，但编码归一到值的类型：
        // 否则选项 value 与 Select 的 value 对不上，标签等于白解析
        const matched =
          option && sameCode(option.code, requested) ? { ...option, code: requested } : null;
        setAsyncResult({ sourceKey, scope, paramsKey, codeKey, option: matched, failed: false });
      })
      .catch(() => {
        if (cancelled || seq !== seqRef.current) return;
        setAsyncResult({
          sourceKey,
          scope,
          paramsKey,
          codeKey,
          option: null,
          failed: true,
        });
      })
      .finally(() => {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // sourceKey / paramsKey / codeKey 都是字符串，源从 ref 取，函数引用不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, scope, paramsKey, codeKey, hasLocal, hasValueName, canResolve, blocked]);

  return useMemo((): UseSelectedLabelResult => {
    if (code === undefined) return { option: null, status: 'empty' };

    // 命中即记账：下次候选被换掉时还能拿它兜底
    const remember = (option: BizOption): BizOption => {
      memoryRef.current = { key: memoryKey, option };
      return option;
    };
    const remembered = memoryRef.current;
    const fallback = remembered?.key === memoryKey ? remembered.option : undefined;

    // 1) 对象值自带的名称：详情已经给了，不必再查
    if (valueName) return { option: remember({ code, name: valueName }), status: 'resolved' };
    // 2) 页面预置的候选
    if (seedHit) return { option: remember(seedHit), status: 'resolved' };
    // 3) 已加载的候选
    if (candidateHit) return { option: remember(candidateHit), status: 'resolved' };

    const asyncMatched =
      asyncResult &&
      asyncResult.sourceKey === sourceKey &&
      asyncResult.scope === scope &&
      asyncResult.paramsKey === paramsKey &&
      asyncResult.codeKey === codeKey;

    if (asyncMatched && asyncResult) {
      if (asyncResult.option) return { option: remember(asyncResult.option), status: 'resolved' };
      // 解析不到但之前见过这个编码：搜索型源的候选已被关键词换掉，别退回编码
      if (fallback) return { option: fallback, status: 'resolved' };
      return { option: { code }, status: asyncResult.failed ? 'error' : 'missing' };
    }

    if (fallback) return { option: fallback, status: 'resolved' };
    if (!canResolve) return { option: { code }, status: 'missing' };
    // 用空条件查可能拿到别家数据，宁可不查
    if (blocked) return { option: { code }, status: 'blocked' };
    if (loading) return { option: { code }, status: 'loading' };
    return { option: { code }, status: 'missing' };
  }, [
    code,
    valueName,
    seedHit,
    candidateHit,
    asyncResult,
    memoryKey,
    sourceKey,
    scope,
    paramsKey,
    codeKey,
    canResolve,
    blocked,
    loading,
  ]);
}
