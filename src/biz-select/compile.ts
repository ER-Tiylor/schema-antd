/**
 * schema 侧的纯逻辑：专有属性下沉 + `paramsFrom` 编译。
 *
 * 与 `schema.tsx`（负责注册、需要 antd/React）分开，是为了让这部分能被单测直接加载。
 */
import { dedupeNamePaths } from '../form/namePath';
import type {
  AnyFormFieldSchema,
  DynamicConfig,
  FormFieldSchema,
  LinkageRule,
  NamePath,
  ReadContext,
} from '../types';
import type {
  BizOption,
  DisplayMode,
  SearchFields,
  SelectParams,
  ValueFieldMap,
  ValueMode,
} from './types';

/** BizSelect 在 schema 里额外认的专有属性 */
export interface BizSelectSchemaProps {
  /** 数据源注册名；schema 里不允许写函数 */
  source?: string;
  /** 参数名 ← 表单字段名：`{ provinceCode: 'provinceCode' }` */
  paramsFrom?: Record<string, NamePath>;
  valueMode?: ValueMode;
  valueFields?: ValueFieldMap;
  displayMode?: DisplayMode;
  searchFields?: SearchFields;
  seedOptions?: BizOption[];
  /** 默认 true：父值变化时清空本字段 */
  clearOnParent?: boolean;
  blockedText?: unknown;
  debounceMs?: number;
}

/** 需要下沉到 props 的专有属性：组件只认 props */
const SUNK_KEYS = [
  'source',
  'valueMode',
  'valueFields',
  'displayMode',
  'searchFields',
  'seedOptions',
  'blockedText',
  'debounceMs',
] as const;

/**
 * 把 `paramsFrom` 编译成已有的两套机制：
 * - `dynamic`：订阅父字段，把值映射成 `params` 传给组件
 * - `linkage`：父值变化时清空本字段
 */
function compileParamsFrom(
  schema: FormFieldSchema & BizSelectSchemaProps,
  entries: [string, NamePath][],
): { dynamic: DynamicConfig; linkage?: LinkageRule[] } {
  const deps = dedupeNamePaths(entries.map(([, path]) => path));
  const base = schema.dynamic;
  const inheritedProps = base?.props;
  // 静态固定条件（如 props.params: { enabled: true }）必须保留，否则查询会放宽
  const staticParams = (schema.props?.params ?? undefined) as SelectParams | undefined;

  const dynamic: DynamicConfig = {
    ...base,
    // 与调用方自己声明的依赖取并集去重
    dependencies: dedupeNamePaths([...(base?.dependencies ?? []), ...deps]),
    props: (ctx: ReadContext) => {
      const inherited =
        typeof inheritedProps === 'function' ? inheritedProps(ctx) : (inheritedProps ?? {});
      const inheritedParams = (inherited as { params?: SelectParams }).params;
      const mapped = Object.fromEntries(entries.map(([param, path]) => [param, ctx.get(path)]));
      // 合并顺序：静态 props.params < dynamic.props().params < paramsFrom 映射。
      // 越靠后的越"当前"，同名时覆盖前面的
      return {
        ...inherited,
        params: { ...staticParams, ...inheritedParams, ...mapped },
      };
    },
  };

  // clearOnParent=false 是「快照语义」：父变不清空，也不额外下发联动规则
  const linkage: LinkageRule[] | undefined =
    schema.clearOnParent === false
      ? schema.linkage
      : [...(schema.linkage ?? []), { dependencies: deps, handler: (ctx) => ctx.clear(schema.name) }];

  return { dynamic, linkage };
}

/**
 * 归一化：专有属性下沉 + 级联编译。
 *
 * 必须是纯函数——调用方按 schema 对象缓存结果，每次新建对象会让下游 memo 与 effect 全部失效。
 */
export function normalizeBizSelectSchema<T extends AnyFormFieldSchema>(schema: T): T {
  const ext = schema as unknown as FormFieldSchema & BizSelectSchemaProps;
  if (ext.type !== 'BizSelect') return schema;

  const sunk: Record<string, unknown> = {};
  for (const key of SUNK_KEYS) {
    if (ext[key] !== undefined) sunk[key] = ext[key];
  }

  const entries = Object.entries(ext.paramsFrom ?? {}) as [string, NamePath][];
  // 没有可下沉的属性和可编译的级联时保持同一引用，避免无意义的新对象
  if (!entries.length && !Object.keys(sunk).length) return schema;

  const next = { ...schema, props: { ...schema.props, ...sunk } } as Record<string, unknown>;

  if (entries.length) {
    const { dynamic, linkage } = compileParamsFrom(ext, entries);
    next.dynamic = dynamic;
    if (linkage) next.linkage = linkage;
  }

  // 已经编译进 props / dynamic / linkage 的属性从顶层摘掉，保证归一化幂等
  for (const key of [...SUNK_KEYS, 'paramsFrom', 'clearOnParent']) {
    delete next[key];
  }
  return next as T;
}
