/**
 * BizSelect 的类型契约。
 *
 * 对外只有一个「数据源」概念：能给出候选、能按编码解析名称。
 * 具体是前端常量、一次拉全量还是关键词翻页，由源**提供了哪些能力**决定，
 * 不再用 kind 之类的标签分类。
 */
import type { ReactNode } from 'react';
import type { SelectProps } from 'antd';

export type SelectCode = string | number;

/** 契约层的标准选项；后端字段换名在 adapter 层做，不污染组件 */
export interface BizOption<T = unknown> {
  code: SelectCode;
  name?: string;
  disabled?: boolean;
  /** 原始接口记录，原样带回给业务回调 */
  raw?: T;
}

/** 展示模式：编码 / 编码-名称 / 名称 */
export type DisplayMode = 'V' | 'V-L' | 'L';

/** 前端过滤时匹配哪些字段 */
export type SearchFields = 'code' | 'name' | 'both';

/** 值形态：标量编码，或自带名称的对象 */
export type ValueMode = 'primitive' | 'object';

/**
 * 对象值里哪个键装编码、哪个装名称。
 * 默认 `{ code: 'value', name: 'label' }`，兼容存量 `{ value, label }` 协议。
 */
export interface ValueFieldMap {
  code?: string;
  name?: string;
}

export type SelectParams = Record<string, unknown>;

/** 对象形态的值；具体键名由 valueFields 决定，所以只能约束到 Record */
export type BizObjectValue = Record<string, unknown>;

/**
 * 数据源契约。只有能力声明，不认识 URL、method、低代码控件配置。
 *
 * 行为推导：
 * - 只有 `options` → 同步全集，前端过滤
 * - 只有 `load` → 需要时加载一次，前端过滤
 * - 只有 `search` → 后端过滤
 * - `load` + `search` → 空关键词走 load 缓存，有关键词走后端
 */
export interface SelectSource<P extends SelectParams = SelectParams> {
  /** 同步全集：纯前端常量，没有请求也没有 loading */
  options?: BizOption[];
  /** 异步全集：一次拉完，之后前端过滤 */
  load?: (params: P, signal?: AbortSignal) => Promise<BizOption[]>;
  /** 关键词搜索：分页接口固定取第一页 */
  search?: (keyword: string, params: P, signal?: AbortSignal) => Promise<BizOption[]>;
  /** 按编码精确查：远程回显，不能用模糊搜索冒充 */
  resolve?: (code: SelectCode, params: P, signal?: AbortSignal) => Promise<BizOption | null>;
  /** 缺任一参数就不发请求：用空条件查可能拿到别家数据 */
  requiredParams?: string[];
  /** 租户/权限隔离，参与缓存键 */
  namespace?: () => string;
}

/**
 * 受控通道与搜索协议由组件接管，这些属性传进来要么被静默忽略、要么直接把控件弄坏：
 * - `searchValue`：antd 的受控搜索框，传了会锁死用户输入（组件自己维护 keyword）
 * - `showSearch` / `filterOption` / `optionFilterProp` / `onSearch`：搜索行为由源的能力决定
 * - `optionLabelProp`：标签取哪个字段由 displayMode 决定
 */
type BaseAntProps = Omit<
  SelectProps,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'options'
  | 'labelInValue'
  | 'mode'
  | 'onSearch'
  | 'searchValue'
  | 'showSearch'
  | 'filterOption'
  | 'optionFilterProp'
  | 'optionLabelProp'
>;

/** 与 antd 无关的公共属性：可编辑与只读都吃这一份 */
interface CoreProps {
  /** 注册名或内联源；schema 里只能是字符串 */
  source?: string | SelectSource;
  /** 传给 load/search/resolve，参与缓存键 */
  params?: SelectParams;
  /** 下拉与回显文本，默认 L */
  displayMode?: DisplayMode;
  /** 前端过滤匹配的字段，缺省随 displayMode 推导 */
  searchFields?: SearchFields;
  /** 详情已带回的名称，省掉一次 resolve */
  seedOptions?: BizOption[];
  /** 远程搜索防抖，默认 300ms */
  debounceMs?: number;
  /** 内联源需要跨实例共享缓存时显式指定 */
  cacheKey?: string;
  /** 门禁提示文案 */
  blockedText?: ReactNode;
  valueMode?: ValueMode;
  valueFields?: ValueFieldMap;
}

interface PrimitiveModeProps {
  valueMode?: 'primitive';
  value?: SelectCode | null;
  onChange?: (value: SelectCode | undefined, option?: BizOption) => void;
}

interface ObjectModeProps {
  valueMode: 'object';
  value?: BizObjectValue | null;
  onChange?: (value: BizObjectValue | undefined, option?: BizOption) => void;
}

export type BizSelectProps = CoreProps & BaseAntProps & (PrimitiveModeProps | ObjectModeProps);

export interface BizSelectDisplayProps extends CoreProps {
  value?: SelectCode | BizObjectValue | null;
  /** 只读占位 */
  emptyText?: ReactNode;
}
