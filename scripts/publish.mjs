/**
 * 双目标发布：public（公开 registry）与 inner（私有 registry）。
 *
 * 两条硬规则：
 * 1. 私有源的**包名与地址一律不写进仓库**，只从环境变量或 `.publish.env`（已 gitignore）读取；
 * 2. 发布 public 之前先扫一遍仓库，发现私有源地址就中止——git 历史洗不掉，
 *    等发出去再删已经晚了。
 *
 * 用法：
 *   node scripts/publish.mjs public [--dry-run]
 *   node scripts/publish.mjs inner  [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PUBLIC_TARGET = {
  name: '@tianyr/schema-antd',
  registry: 'https://registry.npmjs.org/',
  access: 'public',
};

/** 极简 .env 解析：KEY=VALUE，忽略空行与 # 注释 */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const entries = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    });
  return Object.fromEntries(entries);
}

const env = { ...readEnvFile('.publish.env'), ...process.env };
const INNER_TARGET = {
  name: env.INNER_NPM_NAME,
  registry: env.INNER_NPM_REGISTRY,
  access: undefined,
};

function fail(message) {
  console.error(`[publish] ${message}`);
  process.exit(1);
}

const [target, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const config = target === 'public' ? PUBLIC_TARGET : target === 'inner' ? INNER_TARGET : null;

if (!config) fail('用法：node scripts/publish.mjs <public|inner> [--dry-run]');
if (target === 'inner' && (!config.name || !config.registry)) {
  fail(
    '缺少私有源配置：需要 INNER_NPM_NAME 与 INNER_NPM_REGISTRY。\n' +
      '        写进 .publish.env（已在 .gitignore 里）或当前 shell 的环境变量。',
  );
}

/** 私有源地址出现在任何被 git 跟踪的文件里，就别发 public */
function assertNoPrivateRegistryInRepo(registry) {
  const host = new URL(registry).host;
  try {
    const hits = execFileSync('git', ['grep', '-l', '-F', '--', host], { encoding: 'utf8' });
    fail(`仓库里有 ${hits.trim().split('\n').length} 个文件包含私有源地址 ${host}，先清理再发：\n${hits}`);
  } catch (error) {
    // git grep 没命中时退出码为 1，这是期望结果
    if (error.status !== 1) throw error;
  }
}

// Windows 上 npm 是 .cmd，Node 22 起必须带 shell 才能 spawn
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => execFileSync(NPM, args, { stdio: 'inherit', shell: true });

/** 只替换 name 字段，保留原文件格式，避免整份重排产生噪声 diff */
function setPackageName(nextName, expectedCurrent) {
  const raw = readFileSync('package.json', 'utf8');
  const current = JSON.parse(raw).name;
  if (current !== expectedCurrent) {
    throw new Error(`package.json 的 name 不是预期的 "${expectedCurrent}"，实际是 "${current}"`);
  }
  writeFileSync('package.json', raw.replace(/("name":\s*")[^"]*(")/, `$1${nextName}$2`));
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const originalName = packageJson.name;

if (target === 'public' && INNER_TARGET.registry) {
  assertNoPrivateRegistryInRepo(INNER_TARGET.registry);
}

console.log(`[publish] ${dryRun ? '预演' : '发布'} ${config.name} → ${config.registry}`);

try {
  // 两个目标包名不同，发布期间临时改名，结束后一定还原
  if (originalName !== config.name) setPackageName(config.name, originalName);
  const args = ['publish', `--registry=${config.registry}`];
  if (config.access) args.push(`--access=${config.access}`);
  if (dryRun) args.push('--dry-run');
  run(args);
} finally {
  if (originalName !== config.name) {
    setPackageName(originalName, config.name);
    console.log(`[publish] name 已还原为 ${originalName}`);
  }
}
