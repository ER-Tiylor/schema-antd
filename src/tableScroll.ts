/**
 * 表体高度约定：两个可编辑表格共用。
 *
 * antd 把 scroll.y 直接写成表体的 max-height（rc-table Table.js），
 * 所以短内容不会被拉高、超过才纵向滚动。这里把 maxHeight 收敛成一行配置，
 * 外层不要再包 overflow 盒子——那会让表头跟着滚走、固定列错位。
 */
import type { TableProps } from 'antd';

import { IS_DEV } from './env';

export function resolveTableScroll<T>(
  scroll: TableProps<T>['scroll'],
  maxHeight: number | undefined,
  tag: string,
): TableProps<T>['scroll'] {
  if (maxHeight === undefined) return scroll;
  if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
    // 0 或负数会把表体压没，按配置错误处理，不静默生效
    if (IS_DEV) console.warn(`[${tag}] maxHeight 必须是正数，当前为 ${maxHeight}，已忽略`);
    return scroll;
  }
  // 显式 scroll.y 优先：透传属性比便捷属性更具体
  return { ...scroll, y: scroll?.y ?? maxHeight };
}
