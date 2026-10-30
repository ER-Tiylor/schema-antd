/**
 * BizSelect：业务下拉的可编辑态。
 *
 * 渲染层只吃「候选列表 + 已选名称 + 展示模式」，不认识 load / search / resolve。
 * 所有取数与解析都在 hook 里完成。
 */
import { useEffect, useMemo } from 'react';
import { Select } from 'antd';

import { normalizeSource } from './normalize';
import { resolveSelectSource } from './registry';
import { useCandidates } from './useCandidates';
import { useSelectedLabel } from './useSelectedLabel';
import {
  buildObjectValue,
  defaultSearchFields,
  readCode,
  readObjectName,
  toAntOption,
} from './format';
import type { BizOption, BizSelectProps, SelectCode, ValueMode } from './types';

const DEFAULT_BLOCKED_TEXT = '请先选择上级';

export function BizSelect(props: BizSelectProps) {
  const {
    source,
    params,
    displayMode = 'L',
    searchFields,
    seedOptions,
    debounceMs,
    cacheKey,
    blockedText = DEFAULT_BLOCKED_TEXT,
    valueMode = 'primitive',
    valueFields,
    value,
    onChange,
    disabled,
    placeholder,
    ...rest
  } = props as BizSelectProps & { valueMode?: ValueMode };

  const sourceObj = resolveSelectSource(source);
  const fields = searchFields ?? defaultSearchFields(displayMode);

  const code = readCode(value, valueMode, valueFields);
  const valueName = readObjectName(value, valueMode, valueFields);

  // 源直接交给 Hook：解析与来源键（含版本订阅）都在里面，组件不再自己算一份
  const candidates = useCandidates({
    source,
    cacheKey,
    params,
    searchFields: fields,
    debounceMs,
  });
  const { sourceKey } = candidates;

  const selected = useSelectedLabel({
    source: sourceObj,
    sourceKey,
    code,
    valueName,
    seedOptions,
    // 回显查的是未过滤全集，否则输入关键词后已选项会被筛掉、名称退回编码
    candidates: candidates.echoOptions,
    params,
  });

  // 只有 load 型需要为了回显提前拉一次全集：它没有 resolve，名称只能从全集里找。
  // 对象值自带名称、seed 已命中时不用拉。
  const hasKnownName =
    Boolean(valueName) || Boolean(seedOptions?.some((item) => item.code === code));
  const needEchoLoad =
    code !== undefined && !hasKnownName && normalizeSource(sourceObj).candidateMode === 'load';
  useEffect(() => {
    if (needEchoLoad) candidates.open();
  }, [needEchoLoad, sourceKey, candidates.open]);

  // 搜索中不要补回已选项：否则结果里会混进一条不匹配的记录。
  // 关闭下拉后 keyword 归零，已选项会重新补回，闭合态照常显示名称。
  // 取数失败时也不补：补上一条会让列表非空，antd 就不渲染 notFoundContent，
  // 重试入口跟着被藏起来，用户只看到孤零零一条已选项。
  const searching = candidates.keyword.trim().length > 0;
  const antOptions = useMemo(() => {
    const list = candidates.options.map((item) => toAntOption(item, displayMode));
    if (searching || candidates.error) return list;
    const selectedOption = selected.option;
    if (selectedOption && !list.some((item) => item.value === selectedOption.code)) {
      list.unshift(toAntOption(selectedOption, displayMode));
    }
    return list;
  }, [candidates.options, candidates.error, displayMode, selected.option, searching]);

  const handleChange = (next: SelectCode | undefined, antOption: unknown) => {
    const picked =
      (antOption as { raw?: BizOption } | undefined)?.raw ??
      antOptions.find((item) => item.value === next)?.raw;
    const emit = onChange as ((nextValue: unknown, option?: BizOption) => void) | undefined;

    if (valueMode === 'object') {
      emit?.(next === undefined || next === null ? undefined : buildObjectValue(next, picked, valueFields), picked);
      return;
    }
    emit?.(next ?? undefined, picked);
  };

  return (
    <Select
      {...rest}
      // 候选由数据源决定，一律关掉 antd 自带过滤：本地过滤已在 hook 里做
      filterOption={false}
      showSearch
      options={antOptions}
      value={code}
      loading={candidates.loading || selected.status === 'loading' || rest.loading}
      disabled={disabled || candidates.blocked}
      placeholder={candidates.blocked ? blockedText : placeholder}
      notFoundContent={
        candidates.blocked ? (
          blockedText
        ) : candidates.error ? (
          // 失败得能重试：静默给一个空列表等于让用户以为「确实没有」
          <a onClick={() => candidates.reload()}>加载失败，点击重试</a>
        ) : (
          rest.notFoundContent
        )
      }
      onSearch={candidates.search}
      onChange={handleChange}
      onDropdownVisibleChange={(opened) => {
        // 只有展开时才取默认候选，避免挂载即发请求
        if (opened) candidates.open();
        else candidates.resetKeyword();
        rest.onDropdownVisibleChange?.(opened);
      }}
    />
  );
}
