/**
 * BizSelect 对外出口。
 *
 * 刻意不在这里 import './schema'：字段类型由使用方显式注册，
 * 包默认只提供标准 antd 控件，避免导入即产生副作用。
 *
 * 公开面刻意收窄：只导出发出去就形成兼容责任的东西。
 * 键推导、能力归一化、AntD 选项转换、格式化这些都留在内部模块，
 * 需要时直接从对应文件引用，不要经由本文件对外承诺。
 */
export { BizSelect } from './BizSelect';
export { BizSelectDisplay } from './BizSelectDisplay';
export { registerBizSelectField } from './schema';
export type { BizSelectSchemaProps } from './schema';

/** 候选取数：给下拉以外的 UI（树 / 弹窗列表）复用同一份数据 */
export { useCandidates } from './useCandidates';
export type { UseCandidatesOptions, UseCandidatesResult } from './useCandidates';

/** 源工厂：三种能力组合，别处不再分类 */
export { staticList, loaded, remote } from './factories';

export {
  registerSelectSource,
  defineSelectSources,
  unregisterSelectSource,
  invalidateSelectSource,
  getSelectSource,
  getRegisteredSelectSourceNames,
  clearSelectSources,
} from './registry';

// 源解析与来源键不对外：useCandidates 内部已经做好，放出去只会让调用方自己拼身份、
// 绕开注册名的版本订阅。确实需要读源的话用 getSelectSource。
export { clearSelectCache } from './cache';

export type {
  BizObjectValue,
  BizOption,
  BizSelectDisplayProps,
  BizSelectProps,
  DisplayMode,
  SearchFields,
  SelectCode,
  SelectParams,
  SelectSource,
  ValueFieldMap,
  ValueMode,
} from './types';
