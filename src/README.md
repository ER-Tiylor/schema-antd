# packages/schema

统一 schema 驱动的表单 / 表格体系（v2）。规范以设计文档《统一运行契约 v1》为准，
本目录只做实现，不重新定义契约。

## 结构

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 契约 | `types.ts` | 公开类型唯一出口：`FieldSchema` / `FormFieldSchema` / `EditableColumn` / 各 context |
| 注册表 | `registry.tsx` | `type` → 控件、受控属性名、取值函数、只读渲染 |
| 只读渲染 | `read.tsx` | 优先级：`schema.renderRead` > 注册表 > 内置 |
| 单字段 | `SchemaField.tsx` | 渲染一个受控控件或只读内容，不含 name/label/rules |
| 运行时 | `form/FormRuntimeHost.tsx` | 每个 FormInstance 一个作用域，派发 `events` 与 `linkage` |
| 字段绑定 | `form/SchemaFormField.tsx` | 唯一可复用的具名 Form.Item 绑定层 |
| 表单 | `SchemaForm.tsx` | `Form` + 运行时作用域 + 栅格布局 |
| 选择器 | `app-select/` | 标量值 + search/resolve 分离 + 同源去重与轻量缓存 |
| 行合并 | `rowMerge.ts` | Form 值合并回完整记录，两个表格共用 |
| 单活动行表格 | `editable-table/` | 单 FormInstance + 判脏 + 切换确认 + 行级保存 |
| 全编辑表格 | `full-editable-table/` | 逐行 FormInstance、结构增删、整表校验提交 |

## 分层约束

- `SchemaField` 不持有表单状态；name/label/rules 只在 `SchemaFormField` 出现。
- 普通表单、单活动行、全编辑表格的行都复用 `SchemaFormField`，不另建绑定层。
- 表格列的 `editable` 是三态：`true`（编辑控件、参与校验）、`'read'`（挂 field 但只读渲染，
  值跟随本行 Form，因此能显示 `events`/`linkage` 的带出值，但不参与校验）、`false`（不挂 field，
  单元格直接读行记录，**看不到 Form 里的写值**）。「只读外观 + 仍要校验」用 `true` + `props.disabled`。
- `dynamic` 不是编辑态专属：编辑态与只读态共用 `form/derive.ts` 的 `deriveFieldState`；
  单活动行表格的普通行没有自己的 Form（Store 里只有活动行草稿），
  必须用 `createRecordReadContext(record)` 派生，不能读 Form。
- 只读态同样消费 `dynamic.props`（`queryParams` / `options` / `format`）与 `dynamic.visible`：
  普通表单隐藏即不渲染，表格只隐藏内容、保留 `<td>`。
- `type: 'Custom'` 是局部字段插槽：`render` 直接写在字段 Schema 里，`SchemaField` 在查 Registry
  之前分支（`registerField('Custom')` 被拒绝）。受控通道固定 `value`/`onChange`，业务值只能来自
  `ctx.value` / `ctx.props`，不得依赖环境 `Form.useFormInstance()`（表格只读单元格会拿到活动行草稿）。
- 隐藏字段保留注册与值，仅跳过校验；禁止通过卸载 `Form.Item` 改变校验语义。
- 行操作收在组件里，默认开箱即用：新增（`showAddButton`）、行内插入/删除（`showInsertAction` /
  `showDeleteAction`，内置操作列）默认**开启**；新增按钮右侧另有 `renderFooterExtra` 插槽；条内顺序
  固定「新增 → 插槽 → 批量删除」。工具条位置 `toolbarPlacement` 默认 `'top'`（与老家族 BatchEdit 一致），
  按钮图标由 `showButtonIcon` 打开（默认关）；`pagination` 默认 `false`。
  破坏性能力默认关：多选（`showRowSelection`）与批量删除（`showBatchDelete`）。
  `EditableTable` 的 dataSource 受控，新增/批量删除都走 `onSetData`（新增还需 `createRow`，必须产出唯一 rowKey），
  新增后自动进入编辑；新增按钮的默认值取「`createRow` 与 `onSetData` 是否都给齐」。
  调用方自带 `rowSelection` 时以调用方为准，内置勾选让位。
- 表格高度走 `maxHeight`（= `scroll.y`，rc-table 落成表体 `max-height`），不传则整表撑开；
  外层不要包 `overflow` 盒子（表头会跟着滚走、固定列错位）。`virtual` 不开放：会卸载离屏行，
  FullEditableTable 的行 Form 随之销毁、输入丢失。
- `setData` 只刷新 dynamic 派生，不触发 `linkage` / `events`（它们只响应用户交互）。
  例外是 `linkage[].immediate: true`：它跟随依赖值变化，初始化、详情回填、`setData`
  都会执行，覆盖风险由业务承担（见统一运行契约 §2）。
- 变更来源不依赖 AntD `onValuesChange`（`setFieldsValue` 走 external，不会触发它）：
  用户交互由 `SchemaField.onChange` 显式派发；immediate 规则由字段订阅自身依赖驱动。
- 联动 ctx 的写入只有两个入口：`set(name, value)` 与 `setValues(values)`。后者是批量书写单位，
  语义与连续 `set` 完全一致（同样不触发下一轮联动），键为顶层字段名，`undefined` 是写值不是删键；
  嵌套 `NamePath` 继续用 `set`。见 `docs/2026-10-28-ctx-set-values.md`。

## 状态

v2 组件全部就绪，通过 `pnpm typecheck:schema`。运行时验证页长期保留在 `src/views/schemaDemo`：

- `/schemaDemo/atomic`：全部原子控件的编辑态与只读态对照；
- `/schemaDemo/form`：SchemaForm 的 A 显隐 / B 赋值 / C 禁用 / D 级联取值 / E 动态必填 / F 选项动态；
- `/schemaDemo/table`：两种可编辑表格共用同一套列 Schema，验证上述场景在表格中的表现，
  含默认的工具条（新增 / 插槽 / 批量删除）、行内插入/删除、多选、两种工具条位置与图标开关、表体高度；
- `/schemaDemo/app-select`：AppSelect 专项——静态源、远程搜索、级联参数、缺必需参数不解析、
  回显状态对照（empty / resolved / missing / blocked / loading / error）、对象模式与解析缓存；
- `/schemaDemo/custom`：`type: 'Custom'` 专项——standalone 编辑/只读、`renderRead` 优先、
  dynamic.props 与校验、events 联动写值、表格非编辑行按行记录派生；
- `/schemaDemo/compare`：新旧对照——业务取自 OMS 物流单的货物明细/货运单元，老侧是整份复制过来的
  OMS `BatchEdit` + `SearchInput`（见 `views/schemaDemo/compare/vendor`），新侧是 `FullEditableTable`，
  两侧同源假数据，用于在真实联动场景下比较两代写法（详见 `docs/2026-10-28-editable-table-compare-demo.md`），
  页内「数据规模」开关把两侧同时放大到 2 / 100 / 300 行，用来压大数据量的录入手感；
- `/schemaDemo/perf`：性能基线专页——按行×列矩阵量挂载、增删行、全表校验、读取、整表替换，
  外加人手键入的「键入 → 绘制」采样与重渲染探针列，结果可复制成 markdown
  （方案见 `docs/2026-10-28-schema-perf-test-plan.md`，实测数据见同名前缀的 baseline 文档）。

七个页面互相可导航，`/schemaDemo` 重定向到第一个。

尚未验证：真实业务页落地、日期与多选协议的判脏实测。

已验证的性能口径（生产构建，2026-10-28，见 `docs/2026-10-28-schema-perf-baseline.md`）：
`FullEditableTable` 100 行 × 10 列（1000 单元格）挂载热 2.5s / 冷 4.2s，约 2.5ms 每格；
同规模 `EditableTable` 挂载 0.24s，便宜约一个数量级。**100×15 与 150×15 是外推值，没有实测**，
所以容量口径只写「约 1000 单元格」，不写行数上限。dev 下的数字只用于定位。
设计文档与实现的差异以设计文档为准，改动需回写文档。
