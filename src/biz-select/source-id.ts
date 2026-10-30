/**
 * 注册名的来源键格式。
 *
 * 单独成一个文件是为了打断 `key.ts ↔ registry.ts` 的循环依赖：
 * 两边都要拼同一个字符串，格式漂移会让缓存清不掉。
 */
export function nameSourceKey(name: string, version: number): string {
  return `n:${name}@${version}`;
}
