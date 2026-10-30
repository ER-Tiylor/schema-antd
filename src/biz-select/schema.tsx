/**
 * BizSelect 的字段类型注册。
 *
 * 刻意不自动执行：包默认只提供标准 antd 控件，使用方需要时调一次
 * `registerBizSelectField()`。
 */
import { registerField } from '../registry';
import { BizSelect } from './BizSelect';
import { BizSelectDisplay } from './BizSelectDisplay';
import { normalizeBizSelectSchema } from './compile';
import type { BizSelectDisplayProps } from './types';

export { normalizeBizSelectSchema };
export type { BizSelectSchemaProps } from './compile';

export function registerBizSelectField(): void {
  registerField(
    'BizSelect',
    {
      component: BizSelect,
      normalize: normalizeBizSelectSchema,
      // 只读态复用同一套解析，不挂载交互组件
      renderRead: (value, props) => (
        <BizSelectDisplay
          value={value as never}
          {...(props as unknown as BizSelectDisplayProps)}
        />
      ),
    },
    { override: true },
  );
}
