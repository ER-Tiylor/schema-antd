/**
 * 三个工厂：只做形状收敛，不注册、不缓存、不发请求。
 *
 * 之所以保留工厂而不是让调用方直接写 `{ load, search }`：
 * 工厂承载了「这个源属于哪种能力组合」的语义，写法越短，越不容易写出
 * `resolve` 用模糊搜索冒充精确查这类错误。
 */
import type { BizOption, SelectCode, SelectSource, SelectParams } from './types';

/** ① 纯前端常量：同步可用，没有请求也没有 loading */
export function staticList<T = unknown>(list: ReadonlyArray<BizOption<T>>): SelectSource {
  return { options: [...list] };
}

/**
 * ② 有限远程枚举：一次拉全量，之后由前端过滤。
 * 传导入的函数（如 `api.listCurrency`）而不是内联箭头，才能跨实例共享缓存。
 */
export function loaded<P extends SelectParams = SelectParams>(
  load: (params: P, signal?: AbortSignal) => Promise<BizOption[]>,
  extra?: Pick<SelectSource<P>, 'requiredParams' | 'namespace'>,
): SelectSource<P> {
  return { load, ...extra };
}

/** ③ 无限远程：关键词搜索 + 按编码回显 */
export function remote<P extends SelectParams = SelectParams>(config: {
  search: (keyword: string, params: P, signal?: AbortSignal) => Promise<BizOption[]>;
  resolve?: (code: SelectCode, params: P, signal?: AbortSignal) => Promise<BizOption | null>;
  requiredParams?: string[];
  namespace?: () => string;
}): SelectSource<P> {
  const { search, resolve, requiredParams, namespace } = config;
  return { search, resolve, requiredParams, namespace };
}
