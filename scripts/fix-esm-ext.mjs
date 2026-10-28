/**
 * tsc 不会给相对导入补扩展名，而 Node 的 ESM 解析必须带 `.js`。
 * 构建后统一补上，产物同时满足 bundler 与 Node ESM 两种消费方式。
 *
 * 两种情况要区分：
 * - 指向文件：`./types` → `./types.js`；
 * - 指向目录：`./app-select` → `./app-select/index.js`（源码里是 index.ts，
 *   产物是 app-select/index.js，直接补成 `./app-select.js` 会解析失败）。
 *
 * 裸模块（react / antd）、已有扩展名的、动态 import 一律不动。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

/** 静态导入说明符：捕获「from/import + 引号 + 相对路径 + 同一个引号」 */
const STATIC_SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]*)\2/g;
/** `./types` 没扩展名；`./types.js`、`./x.css`、`./x.json` 有 */
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

function toSpecifier(fromFile, specifier) {
  if (HAS_EXTENSION.test(specifier)) return specifier;
  if (existsSync(join(dirname(fromFile), specifier, 'index.js'))) return `${specifier}/index.js`;
  return `${specifier}.js`;
}

function addExtension(source, fromFile) {
  return source.replace(STATIC_SPECIFIER, (whole, prefix, quote, specifier) => {
    const next = toSpecifier(fromFile, specifier);
    return next === specifier ? whole : `${prefix}${quote}${next}${quote}`;
  });
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let changed = 0;
for await (const file of walk(distDir)) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
  const source = await readFile(file, 'utf8');
  const next = addExtension(source, file);
  if (next !== source) {
    await writeFile(file, next);
    changed += 1;
  }
}

console.log(`[fix-esm-ext] 补写扩展名：${changed} 个文件`);
