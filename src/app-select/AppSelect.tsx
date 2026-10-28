/**
 * AppSelect：AntD Select 之上的一层业务选择组件。
 *
 * 原则：内部始终用标量 ID 驱动 Select，绝不使用 labelInValue；
 * 已选 ID 的解析与关键词搜索是两条独立逻辑。
 */
import { useMemo } from 'react';
import { Select } from 'antd';

import { useCandidateOptions, useResolvedSource, useSelectedOption } from './hooks';
import type { AppOption, AppSelectProps, AppValueMode, LegacyValue, SelectId } from './types';
import { isEmptyId, mergeOptions, normalizeOption } from './utils';

export function AppSelect(props: AppSelectProps) {
  const {
    source,
    dataSource,
    options,
    queryParams,
    debounceMs,
    selectedOptions,
    value,
    onChange,
    valueMode = 'primitive',
    ...rest
  } = props as AppSelectProps & { valueMode?: AppValueMode };

  const legacyValue = valueMode === 'object' ? (value as LegacyValue | null | undefined) : undefined;
  const rawValue = valueMode === 'object' ? legacyValue?.value : (value as SelectId | null | undefined);
  // 空串与 null / undefined 等价，避免把 '' 当成一个有效 ID 传给 Select 或触发 resolve('')
  const internalValue = isEmptyId(rawValue) ? undefined : rawValue;

  const { sourceObj, sourceKey } = useResolvedSource(source, dataSource);

  const { candidates, loading, search } = useCandidateOptions({
    sourceObj,
    sourceKey,
    queryParams,
    debounceMs,
  });

  const { option: selected, status } = useSelectedOption({
    sourceObj,
    sourceKey,
    value: internalValue,
    legacyLabel: legacyValue?.label,
    selectedOptions,
    candidates,
    queryParams,
  });

  const mergedOptions = useMemo(
    () => mergeOptions(selected, options, candidates),
    [selected, options, candidates],
  );

  const isRemote = sourceObj?.kind === 'remote';

  const handleChange = (next: SelectId | undefined, antOption: unknown) => {
    const option =
      normalizeOption(antOption) ?? mergedOptions.find((item) => item.value === next);
    const emit = onChange as ((nextValue: unknown, option?: AppOption) => void) | undefined;

    if (valueMode === 'object') {
      emit?.(
        next === undefined || next === null ? undefined : { value: next, label: option?.label ?? '' },
        option,
      );
      return;
    }
    emit?.(next ?? undefined, option);
  };

  return (
    <Select
      {...rest}
      labelInValue={false}
      showSearch={isRemote ? true : rest.showSearch}
      optionFilterProp={rest.optionFilterProp ?? 'label'}
      // 远程搜索由 dataSource 决定候选，不能让 AntD 在前端二次过滤
      filterOption={isRemote ? false : rest.filterOption}
      options={mergedOptions}
      value={internalValue}
      // 已选 ID 还在解析时也转圈，别让用户以为这个值没有名称
      loading={loading || status === 'loading' || rest.loading}
      onChange={handleChange}
      onSearch={isRemote ? search : undefined}
      onDropdownVisibleChange={(open) => {
        // 只有展开时才请求默认候选，避免挂载即发请求
        if (open && isRemote && candidates.length === 0) search('');
        rest.onDropdownVisibleChange?.(open);
      }}
    />
  );
}
