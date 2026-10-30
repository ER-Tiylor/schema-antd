/**
 * 字段注册表：type -> 组件 + 事件适配 + 只读展示。
 *
 * 注册项只描述“怎么渲染一个受控控件”，不承担 Form 绑定、校验和联动，
 * 这些由 SchemaForm 层的 SchemaFormField 负责。
 */
import type { ComponentType, ReactNode } from 'react';
import {
  AutoComplete,
  Cascader,
  Checkbox,
  ColorPicker,
  DatePicker,
  Input,
  InputNumber,
  Radio,
  Rate,
  Select,
  Slider,
  TimePicker,
  Transfer,
  TreeSelect,
  Upload,
} from 'antd';

import type { AnyFormFieldSchema, FieldType } from './types';

export interface FieldDefinition<T = unknown> {
  component: ComponentType<any>;
  /** 受控值属性名，默认 value；Checkbox 用 checked */
  valuePropName?: string;
  /** 从原始事件参数中取出业务值，默认取第一个参数 */
  getValueFromEvent?: (...args: any[]) => T;
  /** 只读展示；返回 undefined 表示退到内置格式化 */
  renderRead?: (value: T, props: Record<string, unknown>) => ReactNode;
  /**
   * 渲染前归一化字段定义：把类型专有属性编译成引擎认识的 shape。
   * 必须是纯函数，调用方会按 schema 对象缓存结果（不可每次返回新对象）。
   */
  normalize?: (schema: AnyFormFieldSchema) => AnyFormFieldSchema;
}

const registry = new Map<string, FieldDefinition>();

/** 注册字段类型；重复注册默认拒绝，覆盖必须显式声明 */
export function registerField(
  type: FieldType,
  definition: FieldDefinition,
  options?: { override?: boolean },
): void {
  // 'Custom' 由 SchemaField 直接分支处理，注册进来也是永不执行的死代码
  if (type === 'Custom') {
    console.warn('[schema] "Custom" 是保留类型，由字段自身的 render 提供，不能注册');
    return;
  }
  if (registry.has(type) && !options?.override) {
    console.warn(`[schema] 字段类型 "${type}" 已注册，如需覆盖请显式传入 { override: true }`);
    return;
  }
  registry.set(type, definition);
}

export function getFieldDefinition(type: string): FieldDefinition | undefined {
  return registry.get(type);
}

export function getRegisteredFieldTypes(): string[] {
  return [...registry.keys()];
}

// ---- 内置注册：首期只覆盖常用控件，其余按需补充 ----

registerField('Input', { component: Input });
registerField('Input.TextArea', { component: Input.TextArea });
registerField('Input.Password', { component: Input.Password });
registerField('InputNumber', { component: InputNumber });
registerField('AutoComplete', { component: AutoComplete });
registerField('Cascader', { component: Cascader });
registerField('Select', { component: Select });
registerField('TreeSelect', { component: TreeSelect });
registerField('Slider', { component: Slider });
registerField('Rate', { component: Rate });
registerField('DatePicker', { component: DatePicker });
registerField('TimePicker', { component: TimePicker });
registerField('ColorPicker', { component: ColorPicker });
registerField('RadioGroup', { component: Radio.Group });
registerField('CheckboxGroup', { component: Checkbox.Group });
registerField('Transfer', { component: Transfer, valuePropName: 'targetKeys' });

registerField('Checkbox', {
  component: Checkbox,
  valuePropName: 'checked',
  getValueFromEvent: (event: { target: { checked: boolean } }) => event.target.checked,
});

registerField('Upload', {
  component: Upload,
  valuePropName: 'fileList',
  getValueFromEvent: (info: { fileList: unknown[] }) => info.fileList,
});
