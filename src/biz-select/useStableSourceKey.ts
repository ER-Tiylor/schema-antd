/**
 * 计算来源键，并在开发态识别「每次渲染都换键」的写法。
 *
 * 键在变、源的能力组合却没变，几乎只能是内联箭头函数造成的：
 * 缓存永远不命中，表格里每个单元格各打一次接口。
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';

import { IS_DEV } from '../env';
import { selectSourceKey } from './key';
import { getSelectSourceVersion, subscribeSelectSourceVersion } from './registry';
import type { SelectSource } from './types';

const NOOP_UNSUBSCRIBE = () => {};

function sourceShape(source?: SelectSource): string {
  if (!source) return '';
  return [
    Array.isArray(source.options) ? 'o' : '-',
    typeof source.load === 'function' ? 'l' : '-',
    typeof source.search === 'function' ? 's' : '-',
    typeof source.resolve === 'function' ? 'r' : '-',
  ].join('');
}

export function useStableSourceKey(
  source?: string | SelectSource,
  cacheKey?: string,
): string {
  // 注册名的版本号只在 Map 里，改值不会触发渲染：必须订阅，sourceKey 才会跟着变，
  // 已挂载的实例才会重新取数（invalidateSelectSource / 同名重注册由此生效）
  const name = typeof source === 'string' ? source : '';
  const subscribe = useCallback(
    (listener: () => void) =>
      name ? subscribeSelectSourceVersion(name, listener) : NOOP_UNSUBSCRIBE,
    [name],
  );
  useSyncExternalStore(
    subscribe,
    () => (name ? getSelectSourceVersion(name) : 0),
    () => 0,
  );

  const sourceKey = selectSourceKey(source, cacheKey);
  const previousRef = useRef({ key: sourceKey, shape: sourceShape(source as SelectSource) });
  const warnedRef = useRef(false);

  if (IS_DEV) {
    const previous = previousRef.current;
    const shape = sourceShape(source as SelectSource);
    if (
      !warnedRef.current &&
      previous.key !== sourceKey &&
      previous.shape === shape &&
      !cacheKey &&
      typeof source !== 'string' &&
      source
    ) {
      warnedRef.current = true;
      console.warn(
        '[schema] BizSelect 的 source 每次渲染都产生新的函数引用，缓存会一直失效；' +
          '请把源提到组件外、传入导入的函数，或改用 registerSelectSource 注册',
      );
    }
    previousRef.current = { key: sourceKey, shape };
  }

  return sourceKey;
}
