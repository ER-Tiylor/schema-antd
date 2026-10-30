# 更新日志

版本号语义化：补丁号修 bug / 小版本加能力 / 大版本做不兼容调整。
每次发版前先在这里加一条，`npm version` 只负责改 `package.json`。

## 0.1.1 — 2026-10-29

### 新增

- **BizSelect 业务下拉**：源码来源按能力组合，不再按类型标签分类。
  - 组件：`BizSelect`（受控单选，值默认存编码）、`BizSelectDisplay`（只读回显，复用同一套名称解析）
  - 源工厂：`staticList`（前端常量）、`loaded`（一次拉全量后前端过滤）、`remote`（关键词交后端 + `resolve` 精确回显）
  - 源注册：`defineSelectSources` / `registerSelectSource` / `unregisterSelectSource` /
    `invalidateSelectSource` / `getSelectSource` / `getRegisteredSelectSourceNames` / `clearSelectSources`
  - 复用与清理：`useCandidates`（树 / 弹窗复用同一份候选，来源解析与来源键都在 Hook 内）、`clearSelectCache`
  - schema 接入：`registerBizSelectField()` + `BizSelectSchemaProps`，`paramsFrom` 一行配完级联
    （编译成 `dynamic` + `linkage`，父值变化时清空本字段，`clearOnParent: false` 可关）
- 候选与单条解析的缓存：同键在途请求共享、命中 5min / 空结果 30s、失败不缓存；
  `namespace` 参与缓存键，`requiredParams` 不齐时不发请求。
- 回显状态机 `empty / loading / resolved / missing / blocked / error`，只读态在 `title` 上说明原因。

### 变更

- `FieldType` 开放位保留，业务仍可用 `registerField` 注册自定义类型；内置字面量新增 `'BizSelect'`。

### 移除

- **移除 `AppSelect`**（`AppSelect` / `AppSelectDisplay` / `registerAppSelectSource` / `clearAppSelectCache` 等
  全部导出，以及 `FieldType` 里的 `'AppSelect'`）。它原先靠副作用导入自动注册字段类型，
  现在包里不再有副作用导入。

### 升级指引

| 旧（AppSelect） | 新（BizSelect） |
| --- | --- |
| `registerAppSelectSource(name, { kind: 'static', loadOptions })` | `defineSelectSources({ [name]: staticList(list) })` |
| `registerAppSelectSource(name, { kind: 'dict', load })` | `loaded(load)` |
| `registerAppSelectSource(name, { kind: 'remote', search, resolve })` | `remote({ search, resolve })` |
| `queryParams` | `params` |
| `cacheNamespace` | `namespace` |
| `dataSource={source}`（内联） | `source={source}` |
| `option: { value, label }` | `option: { code, name, raw }` |
| 默认注册字段类型 | 使用方显式 `registerBizSelectField()` |

## 0.1.0 — 首个发布版本

- `SchemaForm` / `SchemaField` / `SchemaFormField`：扁平字段配置 + `dynamic` + `linkage` 运行时
- `FullEditableTable` / `EditableTable`：两种可编辑表格，共用同一套列 Schema 与字段绑定层
- `AppSelect`（0.1.1 已移除）
