# schema-antd

基于 antd v5 的 Schema 驱动表单、可编辑表格与业务下拉。一份扁平的字段配置，同时用于普通表单、
单活动行编辑表格和全行常驻编辑表格，字段的显隐、禁用、校验、选项和联动都由配置描述。

- **不内置 antd**：`antd` / `react` 全部是 peer 依赖，产物只有 ESM 与类型声明
- **一份绑定层**：普通表单和两种表格的行复用同一个字段绑定，联动语义完全一致
- **可编辑列三态**：`true` 编辑、`'read'` 只读但跟随本行 Form（能看到联动带出的值）、`false` 直接读行记录
- **业务下拉**：`BizSelect` 把候选来源、编码回显、级联接入收进一个组件，值默认存编码

## 安装

```bash
npm i @tianyr/schema-antd

# 以下由你自己安装，本包不打包它们
npm i react react-dom antd dayjs @ant-design/icons
```

要求：React 18.2+、antd 5.20+、Node 18+（仅构建期）。只提供 ESM。

## 表单

```tsx
import { SchemaForm } from '@tianyr/schema-antd'
import type { FormFieldSchema } from '@tianyr/schema-antd'

const schema: FormFieldSchema[] = [
  { type: 'InputNumber', name: 'qty', label: '数量', rules: [{ required: true, message: '请填写数量' }] },
  { type: 'InputNumber', name: 'price', label: '单价' },
  {
    type: 'InputNumber',
    name: 'amount',
    label: '金额',
    // immediate: 不区分变更来源，初始化、回填、setData 都会重算（默认只在用户交互时执行）
    linkage: [{
      dependencies: ['qty', 'price'],
      immediate: true,
      handler: (ctx) => ctx.set('amount', Number(ctx.get('qty') ?? 0) * Number(ctx.get('price') ?? 0)),
    }],
  },
]

export function OrderForm() {
  return <SchemaForm schema={schema} columns={2} onFinish={(values) => console.log(values)} />
}
```

`dynamic.dependencies` 必须显式列出影响派生结果的所有字段，不做自动依赖收集：

```tsx
{
  type: 'Select',
  name: 'city',
  label: '城市',
  dynamic: {
    dependencies: ['province'],
    disabled: (ctx) => !ctx.get('province'),
    props: (ctx) => ({ options: CITIES[ctx.get('province') as string] ?? [] }),
  },
  linkage: [{
    dependencies: ['province'],
    handler: (ctx) => ctx.set('city', undefined),
  }],
}
```

## 可编辑表格

两种形态，按数据量选：

| | `FullEditableTable` | `EditableTable` |
| --- | --- | --- |
| 状态 | 每行一个 `FormInstance`，全行常驻 | 单个 `FormInstance`，只挂活动行 |
| 适用 | 需要全行同时可编辑、逐行校验 | 行数大，单行编辑 + 行级保存 |
| 成本 | 约 **2.5ms / 单元格** | 约 **0.24ms / 单元格** |

实测（生产构建，100 行 × 10 列 = 1000 单元格，混合控件）：全行常驻挂载约 2.5s，
单活动行约 0.24s。**超过约 1000 个可编辑单元格建议改用 `EditableTable`**，
150 行 × 15 列以上的场景没有实测数据。

```tsx
import { FullEditableTable } from '@tianyr/schema-antd'
import type { EditableColumn } from '@tianyr/schema-antd'

const columns: EditableColumn<OrderRow>[] = [
  {
    title: '品名',
    dataIndex: 'name',
    editable: true,
    field: { type: 'Input', name: 'name', rules: [{ required: true, message: '请填写品名' }] },
  },
  { title: '数量', dataIndex: 'qty', editable: true, field: { type: 'InputNumber', name: 'qty' } },
  // 'read'：不参与校验，但跟随本行 Form，能显示 linkage 写进来的值
  { title: '金额', dataIndex: 'amount', editable: 'read', field: { type: 'InputNumber', name: 'amount' } },
]

<FullEditableTable<OrderRow> rowKey="id" columns={columns} initialRows={rows} />
```

`editable` 三态别混：

- `true`：编辑控件，写进本行 Form，参与校验。「只读外观 + 仍要校验」用 `true` + `props.disabled`；
- `'read'`：挂字段但只读渲染，值跟随本行 Form，因此能看到 `events` / `linkage` 的带出值，**不参与校验**；
- `false` / 缺省：不挂字段，单元格直接读行记录，**看不到 Form 里的写值**。

`EditableTable` 的 `dataSource` 受控，新增/删除通过 `onSetData` 回传；泛型要显式传，
从 `dataSource` 推断会退化成 `object`：

```tsx
<EditableTable<OrderRow>
  rowKey="id"
  columns={columns}
  dataSource={rows}
  onSave={async (next, original) => { await api.save(next); return next }}
  onSetData={setRows}
  createRow={() => ({ id: nanoid() })}
/>
```

## BizSelect

业务下拉：候选从哪来、只有一个编码时名称怎么还原、切换上级后旧候选怎么办。
值默认是标量编码（`valueMode="object"` 可存对象），字段类型由使用方显式注册。

```ts
import { defineSelectSources, loaded, remote, staticList } from '@tianyr/schema-antd'

defineSelectSources({
  province: staticList(PROVINCES),        // 前端常量，不发请求
  currency: loaded(api.listCurrency),     // 一次拉全量，之后前端过滤
  material: remote({                      // 关键词交给后端，另配编码精确回显
    search: (keyword, params, signal) => api.pageMaterial({ keyword, ...params }, signal),
    resolve: (code, params, signal) => api.getMaterial(code, params, signal),
    requiredParams: ['warehouseCode'],    // 缺参数不发请求，避免查到别家数据
  }),
})
```

```tsx
// 独立使用：受控，value / onChange 必配
<BizSelect source="currency" value={currency} onChange={setCurrency} />

// 只读：同一套名称解析，不挂 Select
<BizSelectDisplay source="material" params={{ warehouseCode }} value={materialCode} />
```

在 schema 里用，级联一行配完（先调一次 `registerBizSelectField()` 注册类型）：

```tsx
{
  type: 'BizSelect',
  name: 'materialCode',
  label: '物料',
  source: 'material',
  paramsFrom: { warehouseCode: 'warehouseCode' },   // 参数名 ← 字段名
  blockedText: '请先选择仓库',
}
```

约定：

- 行为由源的能力推导：`options` 前端常量、`load` 一次拉全量后前端过滤、`search` 后端搜索，三者可组合。
- `resolve(code)` 专用于按编码精确回显，不要用模糊搜索冒充。
- `requiredParams` 不齐时进入 `blocked`：候选为空、不发请求。
- `invalidateSelectSource(name)` 让已挂载的实例重新取数；`useCandidates` 可把同一份候选给树、弹窗复用。
- 内联源要跨实例共享缓存，就传导入的函数或显式 `cacheKey`；内联箭头每次渲染都换键，缓存命中不了。

## 其他导出

`SchemaField`（单字段渲染，不含 name/label/rules）、`SchemaFormField`（唯一具名绑定层）、
`FormRuntimeHost` / `FormRuntimeHostProvider` / `useFormRuntimeHost`（联动运行时）、
`registerField` / `getFieldDefinition`（自定义控件类型）、`defaultRenderRead` / `renderReadValue`、
`mergeRowValues`，以及全部类型（`FormFieldSchema` / `EditableColumn` / `FullEditableTableRef` ……）。

字段的取值与写入只走 `ctx`：`ctx.get` / `ctx.getValues` / `ctx.set` / `ctx.setValues` / `ctx.clear`。

## 说明

- 只提供 ESM，不支持 CJS 消费方。
- 用 `import.meta.env.DEV` 判断开发态以输出告警，非 Vite 环境（如 SSR）下恒为 `false`，
  不影响功能，只是少几条开发提示。
- `virtual` 不开放：虚拟滚动会卸载离屏行，全行常驻表格的行 Form 会随之销毁、输入丢失。

版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## License

MIT
