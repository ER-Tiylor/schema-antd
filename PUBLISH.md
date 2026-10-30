# 发布说明

**源码真源在一个内部业务仓库**（`packages/schema` 目录）。本仓库是它的发布副本，
`src/` 下不要直接改——改了要同步回真源，否则下次同步会被覆盖。

## 同步源码

```bash
cp -r <内部仓库>/frontend/src/packages/schema/. ./src/
```

同步后 `git status` 看差异，确认只包含预期的改动。

## 构建与检查

```bash
npm install          # 只装 typescript / @types/react / antd（antd 仅用于类型检查）
npm run typecheck
npm run build        # tsc 出 dist/ + 补 ESM 扩展名
npm pack --dry-run   # 清单应只有 dist/、README、LICENSE、package.json
```

`prepublishOnly` 会在 `npm publish` 前自动跑 typecheck + build。

## 发布

发版前先做两件事：

1. 在 `CHANGELOG.md` 顶部加一条（新增 / 变更 / 移除 / 升级指引），不兼容改动必须写清迁移写法；
2. `npm version <x.y.z> --no-git-tag-version` 改版本号（它同时改 `package.json` 与锁文件）。

两个目标，包名不同，用同一个脚本切换：

```bash
npm run publish:public -- --dry-run   # 预演，不联网
npm run publish:public                # → 公开 registry，@tianyr/schema-antd

npm run publish:inner -- --dry-run
npm run publish:inner                 # → 私有 registry，包名取自 .publish.env
```

脚本用 `try/finally` 保证发布失败也会把 `package.json` 的 `name` 还原，
不会把私有包名留在仓库里。

## 私有源配置

私有源的**包名和地址不进仓库**，放在 `.publish.env`（已在 `.gitignore` 里）：

```bash
cp .publish.env.example .publish.env
# 填 INNER_NPM_NAME / INNER_NPM_REGISTRY
```

也可以直接用环境变量（CI 里更合适）。账号凭证由 `npm adduser --registry <地址> --auth-type=legacy`
写进用户级 `~/.npmrc`，不在项目里。

## 脱敏规则

1. **私有源地址、私有包名、账号 token 一律不进仓库**，只放 `.publish.env` / `~/.npmrc`。
2. **git 历史洗不掉**：一旦提交过，删掉也会留在历史里。所以宁可一开始就不写。
3. `npm run publish:public` 会自动检查——只要仓库里任何被跟踪的文件出现私有源地址，直接中止。
   但它只能挡地址，挡不住包名，包名靠第 1 条。
4. **别让锁文件沾上私有源**：`.npmrc` 固定 `registry=https://registry.npmjs.org/`，
   如果为了加速临时用私有源装依赖，装完把 `package-lock.json` 还原，否则 `resolved`
   会写满内网地址，仓库公开后外部无法安装。

## 关键决策与原因

| 决策 | 原因 |
| --- | --- |
| 只发 ESM（`"type": "module"`，无 CJS 产物） | 消费方是 Vite/webpack5 应用。要支持 CJS 再补一次 `tsc --module commonjs` 的产物与 `exports.require` |
| tsc 直出，不打包、不 tree-shake | 组件包交给消费方 bundler 处理；tsc 天然保持 ESM 结构与按模块 tree-shaking |
| `scripts/fix-esm-ext.mjs` 给相对导入补 `.js` | tsc 不补扩展名，Node ESM 解析会失败。脚本区分文件（`./x` → `./x.js`）与目录（`./biz-select` → `./biz-select/index.js`），后者是关键：补成 `./biz-select.js` 会指向不存在的文件 |
| `sideEffects: true`（默认） | 包内已无副作用导入（BizSelect 字段类型注册是使用方显式调 `registerBizSelectField()`），保留 `true` 是保守选择：宁可少摇一点，也不要让消费方 bundler 误判掉注册路径。真要省包再单独改成 `false` 回归一遍 |
| react / react-dom / antd / dayjs / @ant-design/icons 全是 peerDependencies | 包里再装一份 antd 会出现双实例，context 与样式都会出问题；`devDependencies` 里那份只用于类型检查 |
| 不产出 CSS | 本包没有样式文件；antd v5 是运行时 CSS-in-JS，消费方正常引入 antd 即可 |

## 消费方注意事项（README 已覆盖）

1. 自己安装并保证单一版本：`react ^18.2`、`antd ^5.20`、`dayjs`、`@ant-design/icons ^5.2`。
2. `BizSelect` 的候选源在应用启动时 `defineSelectSources` 注册一次；页面局部接口不必注册，
   直接把源对象传给 `source`。
3. `<EditableTable>` 的泛型**显式传**：从空数组或受控 `dataSource` 推断会退化成 `object`。
4. `BizSelect` 不默认注册字段类型：用 schema 写法前先 `registerBizSelectField()`；候选源用
   `defineSelectSources` 在启动时注册一次，内联源别写内联箭头（每次渲染换键，缓存命中不了）。
5. 用 `import.meta.env.DEV` 判断开发态，非 Vite 环境（如 SSR）下恒为 `false`，不影响功能。

## 已验证到什么程度

- `tsc -p tsconfig.build.json` 通过，`fix-esm-ext.mjs` 补写 55 个文件的扩展名；
- `npm pack --dry-run`：约 98 kB / 163 个文件，只含 `dist/`、`README.md`、`LICENSE`、`package.json`；
- 假消费方（6 个运行时符号 + 4 个类型）通过 `exports` + `dist/index.d.ts` 类型检查通过（0.1.0 时验证，
  0.1.1 只重跑了 typecheck / build / pack，没有重新装包验证）；
- **未验证**：真实浏览器里从 registry 装包运行、antd 5.20 以下版本、CJS 消费方、私有源的完整发布链路。
