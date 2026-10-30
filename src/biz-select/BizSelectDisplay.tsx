/**
 * BizSelect 的只读态。
 *
 * 复用同一套名称解析，但不挂载 Select：只读列表里成百上千个单元格
 * 不该为了显示一个名称付出一个交互组件的代价。
 */
import { useEffect } from 'react';

import { EMPTY, defaultSearchFields, formatLabel, readCode, readObjectName } from './format';
import { normalizeSource } from './normalize';
import { resolveSelectSource } from './registry';
import { useCandidates } from './useCandidates';
import { useSelectedLabel } from './useSelectedLabel';
import type { SelectedStatus } from './useSelectedLabel';
import type { BizSelectDisplayProps } from './types';

/** 状态说明挂在 title 上：用户不能把「没查到」误认为「业务值为空」 */
const STATUS_TITLE: Partial<Record<SelectedStatus, string>> = {
  loading: '正在解析名称',
  missing: '未找到对应名称，显示原始编码',
  blocked: '缺少必需参数，未解析名称',
  error: '名称解析失败，显示原始编码',
};

export function BizSelectDisplay(props: BizSelectDisplayProps) {
  const {
    source,
    params,
    displayMode = 'L',
    seedOptions,
    cacheKey,
    emptyText = EMPTY,
    valueMode = 'primitive',
    valueFields,
    value,
  } = props;

  const sourceObj = resolveSelectSource(source);
  const code = readCode(value, valueMode, valueFields);
  const valueName = readObjectName(value, valueMode, valueFields);

  // 只有 load 型需要为回显拉一次全集：它没有 resolve，名称只能从全集里找
  const candidates = useCandidates({
    source,
    cacheKey,
    params,
    searchFields: defaultSearchFields(displayMode),
  });
  const { sourceKey } = candidates;
  // 对象值自带名称、seed 已命中时不用为了回显拉全集
  const hasKnownName =
    Boolean(valueName) || Boolean(seedOptions?.some((item) => item.code === code));
  const needEchoLoad =
    code !== undefined && !hasKnownName && normalizeSource(sourceObj).candidateMode === 'load';
  useEffect(() => {
    if (needEchoLoad) candidates.open();
  }, [needEchoLoad, sourceKey, candidates.open]);

  const { option, status } = useSelectedLabel({
    source: sourceObj,
    sourceKey,
    code,
    valueName,
    seedOptions,
    candidates: candidates.echoOptions,
    params,
  });

  if (status === 'empty' || !option) return <>{emptyText}</>;

  // 只返回内容本身：外层 schema-field-read 由 SchemaField 统一包，
  // 这里再套一层会得到双层 span。title 只在解析异常时挂，正常态不产生额外节点。
  const text = formatLabel(option, displayMode);
  const title = STATUS_TITLE[status];
  return title ? <span title={title}>{text}</span> : <>{text}</>;
}
