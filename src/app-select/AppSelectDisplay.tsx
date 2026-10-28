/**
 * AppSelect 的轻量只读展示：复用同一套 label 解析，
 * 不为了显示一个名称去挂载完整的可交互 Select。
 */
import { EMPTY_TEXT } from '../read';
import { useResolvedSource, useSelectedOption } from './hooks';
import type { SelectedOptionStatus } from './hooks';
import type { AppSelectDisplayProps, LegacyValue, SelectId } from './types';
import { isEmptyId } from './utils';

/**
 * 解析不到名称时仍显示原始 ID（绝不把 ID 伪装成名称），
 * 但用 title 区分「正在查」「查不到」「请求失败」，避免回显失败被误认为业务值为空。
 */
const UNRESOLVED_TITLE: Partial<Record<SelectedOptionStatus, string>> = {
  loading: '正在解析名称…',
  missing: '未解析到名称，显示原始值',
  blocked: '缺少必需的查询条件，暂无法解析名称',
  error: '名称解析失败，显示原始值',
};

export function AppSelectDisplay({
  source,
  dataSource,
  value,
  valueMode = 'primitive',
  queryParams,
  selectedOptions,
  emptyText = EMPTY_TEXT,
}: AppSelectDisplayProps) {
  const legacyValue = valueMode === 'object' ? (value as LegacyValue | null | undefined) : undefined;
  const rawValue = valueMode === 'object' ? legacyValue?.value : (value as SelectId | null | undefined);
  const internalValue = isEmptyId(rawValue) ? undefined : rawValue;

  const { sourceObj, sourceKey } = useResolvedSource(source, dataSource);

  const { option, status } = useSelectedOption({
    sourceObj,
    sourceKey,
    value: internalValue,
    legacyLabel: legacyValue?.label,
    selectedOptions,
    queryParams,
  });

  if (internalValue === undefined) return <>{emptyText}</>;
  if (option) return <>{option.label}</>;
  const title = UNRESOLVED_TITLE[status];
  return title ? <span title={title}>{String(internalValue)}</span> : <>{String(internalValue)}</>;
}
