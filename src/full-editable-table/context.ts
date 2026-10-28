import { createContext, useContext } from 'react';

import type { FullTableRuntime } from './types';

export const FullTableRuntimeContext = createContext<FullTableRuntime<any> | null>(null);

export function useFullTableRuntime<T>(): FullTableRuntime<T> | null {
  return useContext(FullTableRuntimeContext) as FullTableRuntime<T> | null;
}
