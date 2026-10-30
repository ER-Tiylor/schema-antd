/**
 * 展示与取值：纯函数，不依赖 React，可直接单测。
 *
 * 展示模式统一走「先取首选字段，缺失再降级」，不写三套分支；
 * 编码 0 是合法值，判空一律用 present，不能用真值判断。
 */
import type {
  BizObjectValue,
  BizOption,
  DisplayMode,
  SearchFields,
  SelectCode,
  ValueFieldMap,
  ValueMode,
} from './types';

/** 与 read.tsx 的 EMPTY_TEXT 保持一致；接 BMS 时由覆盖层决定最终观感 */
export const EMPTY = '—';

/** `V-L` 的连接符：场景不多，不做配置 */
export const LABEL_SEPARATOR = '-';

const DEFAULT_VALUE_FIELDS: Required<ValueFieldMap> = { code: 'value', name: 'label' };

export function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function isEmptyCode(value: SelectCode | null | undefined): boolean {
  return value === undefined || value === null || value === '';
}

/** 展示模式 → 默认的搜索字段 */
export function defaultSearchFields(mode: DisplayMode): SearchFields {
  if (mode === 'V') return 'code';
  if (mode === 'V-L') return 'both';
  return 'name';
}

/**
 * 拼接展示文本。
 * 降级规则：`L` 缺名称用编码，`V` 缺编码用名称，`V-L` 缺一侧就只显示另一侧。
 */
export function formatLabel(
  option: Pick<BizOption, 'code' | 'name'>,
  mode: DisplayMode,
  separator = LABEL_SEPARATOR,
): string {
  const { code, name } = option;
  if (mode === 'V-L') {
    // 缺一侧时不留下悬挂的分隔符
    return [code, name].filter(present).join(separator) || EMPTY;
  }
  const preferred = mode === 'V' ? code : name;
  const fallback = mode === 'V' ? name : code;
  const text = present(preferred) ? preferred : present(fallback) ? fallback : EMPTY;
  return String(text);
}

/** 关键字是否命中：空关键字一律命中，前端过滤只管 `options` / `load` 两类源 */
export function matchKeyword(option: BizOption, keyword: string, fields: SearchFields): boolean {
  const word = keyword.trim().toLowerCase();
  if (!word) return true;
  const code = present(option.code) ? String(option.code).toLowerCase() : '';
  const name = present(option.name) ? String(option.name).toLowerCase() : '';
  // 名称缺失时回退编码：展示层是这么降级的，搜索必须同口径，否则「看得见却搜不到」
  if (!name) return code.includes(word);
  if (fields === 'code') return code.includes(word);
  if (fields === 'name') return name.includes(word);
  return code.includes(word) || name.includes(word);
}

/** 本地过滤：候选全集已在前端时用；关键词为空直接返回原数组，避免多余遍历 */
export function filterOptions(
  list: BizOption[],
  keyword: string,
  fields: SearchFields,
): BizOption[] {
  if (!keyword.trim()) return list;
  return list.filter((item) => matchKeyword(item, keyword, fields));
}

/** 按内容判断候选是否真的变了：内联数组每次新建也能对上 */
export function optionsContentKey(list?: BizOption[] | null): string {
  if (!list || !list.length) return '';
  return JSON.stringify(
    list.map((item) => [typeof item.code, item.code, item.name ?? null, item.disabled ?? false]),
  );
}

/** 契约选项 → antd 需要的 `{ value, label }` */
export function toAntOption(option: BizOption, mode: DisplayMode) {
  return {
    value: option.code,
    label: formatLabel(option, mode),
    disabled: option.disabled,
    raw: option,
  };
}

export function resolveValueFields(fields?: ValueFieldMap): Required<ValueFieldMap> {
  return {
    code: fields?.code || DEFAULT_VALUE_FIELDS.code,
    name: fields?.name || DEFAULT_VALUE_FIELDS.name,
  };
}

/** 从值里取出编码，标量与对象两种形态统一到一处 */
export function readCode(
  value: SelectCode | BizObjectValue | null | undefined,
  valueMode: ValueMode,
  fields?: ValueFieldMap,
): SelectCode | undefined {
  if (isEmptyCode(value as SelectCode)) return undefined;
  if (valueMode === 'primitive') return value as SelectCode;
  if (!value || typeof value !== 'object') return undefined;
  const { code } = resolveValueFields(fields);
  const raw = (value as BizObjectValue)[code] as SelectCode | undefined;
  return isEmptyCode(raw) ? undefined : raw;
}

/** 从对象值里取出已带的名称，命中就不必再 resolve */
export function readObjectName(
  value: SelectCode | BizObjectValue | null | undefined,
  valueMode: ValueMode,
  fields?: ValueFieldMap,
): string | undefined {
  if (valueMode !== 'object' || !value || typeof value !== 'object') return undefined;
  const { name } = resolveValueFields(fields);
  const raw = (value as BizObjectValue)[name];
  return present(raw) ? String(raw) : undefined;
}

/**
 * 标量编码 + 选项 → 对象值；名称缺失时留空串，由展示层降级到编码。
 *
 * 只输出 valueFields 指定的两个键。改选是换成另一条记录，旧对象上的 id /
 * 部门等字段属于上一条，跟着搬过去就是串数据；拿不到新名称时也不能沿用旧名称，
 * 那会把「张三」显示成「李四」的编码。需要附加字段的业务从 onChange 的
 * 第二个参数 `option.raw` 里取。
 */
export function buildObjectValue(
  code: SelectCode,
  option: BizOption | undefined,
  fields?: ValueFieldMap,
): BizObjectValue {
  const keys = resolveValueFields(fields);
  return { [keys.code]: code, [keys.name]: option?.name ?? '' };
}
