/** 开发态标记：只在 Vite 注入的 DEV 环境下为 true */
export const IS_DEV = (() => {
  try {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    return Boolean(meta.env?.DEV);
  } catch {
    return false;
  }
})();
