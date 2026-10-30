# BizSelect 业务下拉

antd `Select` 只认 `options`。真实的业务下拉还要回答三个问题：候选从哪来、
只有一个编码时名称怎么还原、切换上级后旧候选怎么办。BizSelect 把这三件事收进
一个组件，并让它们在 schema 里能一行配完。

定位是**业务表单里的单选**：统一候选数据、名称回显和级联接入。它不是 `Select` /
`SearchInput` 的完整替代——多选、标签、自定义下拉节点这些不在范围内，那些场景继续用
antd 原生组件。

设计文档见 `docs/2026-10-29-biz-select-implementation-design.md`（本文档讲怎么用，它讲怎么实现）。

---

## 1. 三个概念

| 概念 | 说明 |
| --- | --- |
| 源（`source`） | 候选从哪来、名称怎么解析。写成注册名或内联对象 |
| 值（`valueMode`） | 存编码（推荐）还是存对象 |
| 展示（`displayMode`） | 显示编码 / 编码-名称 / 名称 |

源只声明**能力**，不声明类型：

```ts
interface SelectSource {
  options?: BizOption[];                 // 同步全集
  load?: (params, signal) => Promise<BizOption[]>;   // 一次拉全量
  search?: (keyword, params, signal) => Promise<BizOption[]>; // 关键词搜索
  resolve?: (code, params, signal) => Promise<BizOption | null>; // 按编码回显
  requiredParams?: string[];             // 缺参数就不查
  namespace?: () => string;              // 租户隔离，参与缓存键
}
```

行为由能力推导：只有 `load` 就在前端过滤，有 `search` 就交给后端。
三种来源（前端静态 / 后端有限枚举 / 后端无限表）只是三种能力组合。

---

## 2. 注册（推荐）

```ts
// 应用启动时一次
import { defineSelectSources, loaded, remote, staticList } from '@tianyr/schema-antd';

defineSelectSources({
  province: staticList(PROVINCES),
  currency: loaded(api.listCurrency),          // 传导入的函数，不要写内联箭头
  product: remote({
    search: (keyword, params) => api.pageProduct({ keyword, ...params }),
    resolve: (code, params) => api.getProduct(code, params),
    requiredParams: ['provinceCode'],
  }),
});
```

```tsx
<BizSelect source="product" params={{ provinceCode }} value={code} onChange={setCode} />
```

## 3. 内联（简单场景）

```tsx
<BizSelect source={{ options: PROVINCES }} />
<BizSelect source={{ load: api.listCurrency }} />
```

内联的性能下限（详见 §7）：纯数据源和「传导入函数」的源能跨实例共享缓存；
**内联箭头函数**（`load: () => api.listCurrency()`）每次渲染都是新引用，缓存会失效。

---

## 4. Props

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `source` | `string \| SelectSource` | — | 注册名或内联源 |
| `params` | `Record<string, unknown>` | — | 传给源，参与缓存键 |
| `valueMode` | `'primitive' \| 'object'` | `'primitive'` | 值形态 |
| `valueFields` | `{ code?, name? }` | `{ code: 'value', name: 'label' }` | 对象值里哪个键装编码/名称 |
| `displayMode` | `'V' \| 'V-L' \| 'L'` | `'L'` | 展示模式 |
| `searchFields` | `'code' \| 'name' \| 'both'` | 随 `displayMode` | 前端过滤匹配字段 |
| `seedOptions` | `BizOption[]` | — | 详情已带回的名称，省一次 `resolve` |
| `debounceMs` | `number` | `300` | 远程搜索防抖 |
| `cacheKey` | `string` | — | 内联源显式共享缓存；注册名自带稳定键，同时传 `cacheKey` 不生效 |
| `blockedText` | `ReactNode` | `'请先选择上级'` | 门禁提示 |
| 其余 | `SelectProps` | — | `allowClear` / `disabled` / `style` 等透传 |

**组件是受控的**：`value` 恒由外部决定，没有 `defaultValue`。独立使用必须配
`value` + `onChange`；放进 `Form.Item` 则由表单托管（注入的 `value` / `onChange` 直接生效）。
受控通道和搜索协议由组件接管，`value` / `defaultValue` / `onChange` / `options` /
`onSearch` / `showSearch` / `filterOption` / `searchValue` / `optionLabelProp` 传了不会生效。

`onChange(value, option?)`：`option` 是契约选项 `{ code, name, raw }`，`raw` 是源给的原始记录。
对象值形态只回写 `valueFields` 指定的两个键，需要的其他字段从 `option.raw` 取。

---

## 5. 在 schema 里用

```ts
import { registerBizSelectField } from '@tianyr/schema-antd';

registerBizSelectField();   // 使用方显式注册，包默认不注册
```

```ts
const schema: (FormFieldSchema & BizSelectSchemaProps)[] = [
  { type: 'BizSelect', name: 'warehouseCode', label: '仓库', source: 'warehouse' },
  {
    type: 'BizSelect',
    name: 'materialCode',
    label: '物料',
    source: 'material',
    paramsFrom: { warehouseCode: 'warehouseCode' },  // 参数名 ← 字段名
    blockedText: '请先选择仓库',
  },
];
```

`paramsFrom` 会在渲染前编译成 `dynamic` + `linkage`：

- 父字段值映射成 `params` 传给组件
- 映射结果与已有参数**合并**而非替换，优先级：静态 `props.params` < `dynamic.props().params` < `paramsFrom` 映射
- 父值变化时清空本字段（`clearOnParent: false` 可关闭，用于快照语义）

注意清空**只沿用户交互这一跳**传递：`paramsFrom` 编译出的是非 immediate 规则，
只在用户直接改父字段时派发。A→B 会清 B，但 B 被清空是程序化写入，不会再派发 B→C，
所以三级以上链条里孙子字段要么把祖先也写进 `paramsFrom`，要么自己补一条
`immediate: true` 的 linkage。只依赖「父字段」的话，孙子字段只会变成禁用态，
残留的旧值不会被清掉。

表格行内用的是每行独立 Form，`ctx.get` 在本行解析，所以配置完全一样。

---

## 6. 回显与状态

优先级：对象值自带的名称 → `seedOptions` → 已加载候选 → `resolve(code)`
→ 最近一次命中过的选项 → 原样显示编码。

最后一档是给搜索型源兜底的：候选会随关键词整批换掉，重新展开拿到的也只是默认
第一页，已选项常常不在里面。命中的选项按「来源 + 租户 + 条件 + 编码」记一份，
条件一变自然失效——不靠 antd Select 内部缓存来保证业务行为。

状态机：`empty / loading / resolved / missing / blocked / error`。
只读态会在 `title` 上说明原因，避免把「没查到」误认为「值为空」。

`requiredParams` 缺参数时进入 `blocked`：**不发请求**，`load` / `search` 两条通道
都在发请求的那一处守着（`open()` / `reload()` 也挡得住）。用空条件查可能拿到
别家数据，比不显示更糟。

---

## 7. 缓存与 Key

| 缓存 | 键 | TTL |
| --- | --- | --- |
| 候选集 | `scope｜来源键｜参数键` | 命中 5min / 空结果 30s |
| 单条解析 | `scope｜来源键｜编码｜参数键` | 同上 |
| 在途请求 | 同上 | 同键共享一次，失败不缓存 |

来源键分四档：

| 写法 | 键 | 跨实例共享 |
| --- | --- | --- |
| `source="city"` | 注册名 + 版本号 | ✅ |
| `source={{ options: [...] }}` | 内容哈希 | ✅ |
| `source={{ load: api.list }}` | 函数引用 | ✅ |
| `source={{ load: () => api.list() }}` | 函数引用（每渲染都变） | ❌ |

最后一档的请求数 = 实例数。表格里 100 行就是 100 次，开发态会告警。
需要共享就提到组件外、传导入的函数，或者给内联源显式指定 `cacheKey`（注册名自带稳定键，
再传 `cacheKey` 不生效）。

`invalidateSelectSource(name)` 把版本号 +1 并通过订阅推给已挂载的实例，它们随之换 key：
带 `load` 的已经取过数就重新取一次，纯搜索型和还没展开过的等下次展开再取。

---

## 8. 复用候选（`useCandidates`）

下拉以外的 UI（树、弹窗、自定义列表）要拿同一份候选时用它，不要自己再取一遍：

```tsx
const { sourceKey, options, loading, error, open, reload } = useCandidates({
  source: 'city',                 // 和组件一样：注册名或内联源
  params: { provinceCode },
  searchFields: 'both',
});
```

- `source` 的写法和组件完全一致：来源解析、来源键、版本订阅都在 Hook 里，
  两边用的是同一个缓存身份。自己拼 `sourceKey` 会绕开注册名的版本号。
- 下拉之外的场景没有「展开」这个动作，`load` 型需要自己调一次 `open()` 才取数。
- `reload()` 绕开缓存重取；`blocked` 为真时（缺 `requiredParams`）`open` / `reload` 都不会发请求。

---

## 9. 常见坑

- **别把内联箭头函数放进 `source`**，理由见 §7。
- **`search` 型的源不在挂载时取数**，只有展开下拉或输入关键词才请求，所以表格首屏不会打一轮接口。
- **非搜索态下会把已选项补回候选**，否则选中的值在下拉里显示为空；搜索中不补（免得混进一条不匹配的记录），取数失败时也不补（让 antd 正常渲染重试入口）。
- **`search` 型不做前端二次过滤**：候选范围由后端决定，再过滤一次会把匹配结果砍掉。
- **编码 `0` 是合法值**，判空用的是 `undefined / null / ''`，不看真值。

---

## 10. 当前不支持

| 不支持 | 说明 |
| --- | --- |
| 多选 | `mode` 已从 Props 排除 |
| 分组选项 | 契约选项是扁平结构 |
| `onSearch` 回传关键词 | 已被数据源占用 |
| `V-L` 自定义分隔符 | 固定 `-`；要换成别的格式就在渲染层自己拼（只读走 `renderRead`，或注册自定义字段类型） |
