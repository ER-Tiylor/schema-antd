import { registerField } from '../registry';
import { AppSelect } from './AppSelect';
import { AppSelectDisplay } from './AppSelectDisplay';
import type { AppOption, AppSelectDisplayProps, AppValueMode, LegacyValue, SelectId } from './types';

// 只读展示必须走同一个解析能力，因此注册项里挂 AppSelectDisplay 而不是简单取 label
registerField('AppSelect', {
  component: AppSelect,
  renderRead: (value, props) => (
    <AppSelectDisplay
      value={value as SelectId | LegacyValue | null | undefined}
      source={props.source as string | undefined}
      dataSource={props.dataSource as AppSelectDisplayProps['dataSource']}
      valueMode={props.valueMode as AppValueMode | undefined}
      queryParams={props.queryParams as Record<string, unknown> | undefined}
      selectedOptions={props.selectedOptions as AppOption[] | undefined}
    />
  ),
});
