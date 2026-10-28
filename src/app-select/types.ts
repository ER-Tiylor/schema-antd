import type { ReactNode } from 'react';
import type { SelectProps } from 'antd';

export type SelectId = string | number;

export interface AppOption<T = unknown> {
  value: SelectId;
  label: string;
  disabled?: boolean;
  /** 原始接口记录，供业务回调使用；不会被写进历史对象协议 */
  raw?: T;
}

/** 历史服务端协议：{ value, label } */
export type LegacyValue = { value: SelectId; label: string };

export type AppValueMode = 'primitive' | 'object';

export interface AppSelectSource {
  kind: 'static' | 'dict' | 'remote';
  /** static/dict：有限集合，直接给或异步加载一次 */
  loadOptions?: () => AppOption[] | Promise<AppOption[]>;
  /** remote：关键词搜索，允许空关键词返回默认候选 */
  search?: (
    keyword: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AppOption[]>;
  /** remote：按 ID 精确解析，不能用模糊搜索冒充 */
  resolve?: (
    id: SelectId,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AppOption | null>;
  /** 租户/权限命名空间：参与解析缓存键，缺省视为同一命名空间 */
  cacheNamespace?: () => string;
  /**
   * 必须齐备的查询参数（按 queryParams 的键声明）。
   * 缺少任何一个都不发请求：用空条件去查，轻则查不到，重则拿到别的租户/省份的记录。
   */
  requiredParams?: string[];
}

/** 应用级数据源注册表；page 局部接口可直接传 dataSource，不必注册 */
export type AppSelectSourceRegistry = Map<string, AppSelectSource>;

type BaseProps = Omit<
  SelectProps,
  'value' | 'defaultValue' | 'onChange' | 'options' | 'labelInValue' | 'mode' | 'onSearch'
> & {
  source?: string;
  dataSource?: AppSelectSource;
  options?: AppOption[];
  queryParams?: Record<string, unknown>;
  /** remote 默认 300ms */
  debounceMs?: number;
  /** 详情已经带回名称时用它省掉一次 resolve */
  selectedOptions?: AppOption[];
  /** 只读展示时的占位符 */
  emptyText?: ReactNode;
};

type PrimitiveModeProps = {
  valueMode?: 'primitive';
  value?: SelectId | null;
  onChange?: (value: SelectId | undefined, option?: AppOption) => void;
};

type ObjectModeProps = {
  valueMode: 'object';
  value?: LegacyValue | null;
  onChange?: (value: LegacyValue | undefined, option?: AppOption) => void;
};

export type AppSelectProps = BaseProps & (PrimitiveModeProps | ObjectModeProps);

export interface AppSelectDisplayProps {
  source?: string;
  dataSource?: AppSelectSource;
  value?: SelectId | LegacyValue | null;
  valueMode?: AppValueMode;
  queryParams?: Record<string, unknown>;
  selectedOptions?: AppOption[];
  emptyText?: ReactNode;
}
