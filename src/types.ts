/**
 * 统一运行契约 v1.0 的类型落地。
 *
 * 本文件是 packages/schema 内公共类型的唯一来源，SchemaField / SchemaForm /
 * EditableTable / FullEditableTable 只导入，不重新声明。
 * 刻意只依赖 antd 与 react，不引用 @/ 下的工程封装，便于后续单独发包。
 */
import type { ReactNode } from 'react';
import type { FormInstance, FormItemProps, TableColumnsType } from 'antd';

export type NamePath = string | number | (string | number)[];

/** 校验规则沿用 AntD 的 Rule 类型，避免自己维护一份平行定义 */
export type Rule = NonNullable<FormItemProps['rules']>[number];

export type FieldMode = 'edit' | 'read';

export type FieldType =
  | 'Input'
  | 'Input.TextArea'
  | 'Input.Password'
  | 'InputNumber'
  | 'AutoComplete'
  | 'Cascader'
  | 'Checkbox'
  | 'CheckboxGroup'
  | 'ColorPicker'
  | 'DatePicker'
  | 'RadioGroup'
  | 'Rate'
  | 'Select'
  | 'Slider'
  | 'TimePicker'
  | 'Transfer'
  | 'TreeSelect'
  | 'Upload'
  | 'AppSelect'
  // 局部自定义字段：不注册全局类型，直接在字段 Schema 里给 render
  | 'Custom'
  // 允许业务通过 registerField 注册自定义类型，同时保留字面量提示
  | (string & {});

/** 单字段渲染协议：SchemaField 只消费这些属性 */
export interface FieldSchema<TValue = unknown> {
  type: FieldType;
  props?: Record<string, unknown>;
  mode?: FieldMode;
  renderRead?: (value: TValue, schema: FieldSchema<TValue>) => ReactNode;
}

/** 自定义字段的公共上下文：只读元数据 + 最终非受控属性，不提供 Form 实例 */
interface CustomShared<TValue = unknown> {
  value: TValue | undefined;
  /** 已完成 dynamic.props 合并、受控键剔除与 id 注入的最终非受控属性 */
  props: Readonly<Record<string, unknown>>;
  /** 运行时有效 Schema；不变量：schema.props === props */
  schema: CustomFieldSchema<TValue>;
}

/**
 * 局部自定义字段的渲染上下文。
 * edit 与 read 是判别联合：只读态不提供 onChange，避免业务误以为可编辑。
 */
export type CustomRenderContext<TValue = unknown> =
  | (CustomShared<TValue> & {
      mode: 'edit';
      onChange: (value: TValue, ...meta: unknown[]) => void;
    })
  | (CustomShared<TValue> & {
      mode: 'read';
      onChange?: never;
    });

/** 不注册全局类型、直接就地渲染的自定义字段；只在 type: 'Custom' 生效 */
export interface CustomFieldSchema<TValue = unknown> extends Omit<FieldSchema<TValue>, 'type'> {
  type: 'Custom';
  render(ctx: CustomRenderContext<TValue>): ReactNode;
}

/** FieldType 是开放字符串联合，运行时仍需校验 render 是函数 */
export type AnyFieldSchema<TValue = unknown> = FieldSchema<TValue> | CustomFieldSchema<TValue>;

export interface ReadContext {
  get(name: NamePath): unknown;
  getValues(): Record<string, unknown>;
}

export interface WriteContext extends ReadContext {
  form: FormInstance;
  set(name: NamePath, value: unknown): void;
  /**
   * 批量写入：等价于对每个键连续调用 set，不额外触发联动。
   * 键是顶层字段名（嵌套 NamePath 继续用 set）；`undefined` 是写值不是删键；
   * 只负责写，不读选项、不清理失效值、不做类型转换。
   */
  setValues(values: Record<string, unknown>): void;
  clear(name: NamePath): void;
  clearValues(names: NamePath[]): void;
}

export interface FieldEventContext extends WriteContext {
  /** Select / AppSelect 的选中项，来自 SchemaField onChange 的第二参数 */
  option?: unknown;
  /** 其余元数据 */
  meta?: unknown[];
}

/** 允许静态值或读取表单值的纯函数 */
export type Derived<T> = T | ((ctx: ReadContext) => T);

export interface DynamicConfig {
  /** 影响派生结果的所有字段都必须显式列出，不做自动依赖收集 */
  dependencies: NamePath[];
  visible?: Derived<boolean>;
  disabled?: Derived<boolean>;
  required?: Derived<boolean>;
  rules?: Derived<Rule[]>;
  props?: Derived<Record<string, unknown>>;
}

export interface LinkageRule {
  dependencies: NamePath[];
  handler(ctx: WriteContext): void;
  /** 默认 false：仅在用户交互引发的变更时执行 */
  immediate?: boolean;
}

/** 扁平扩展：同一份对象既交给 SchemaField，也交给 SchemaForm 做 Form.Item 绑定 */
export interface FormFieldSchema<TValue = unknown> extends FieldSchema<TValue> {
  name: NamePath;
  label?: ReactNode;
  rules?: Rule[];
  /** 仅传给 AntD Form.Item 做校验依赖，不参与 DynamicConfig 的订阅 */
  dependencies?: NamePath[];
  visible?: boolean;
  /** 仅存量兼容，新业务禁止与 visible 同时声明 */
  hidden?: boolean;
  dynamic?: DynamicConfig;
  linkage?: LinkageRule[];
  events?: { onChange?: (value: TValue, ctx: FieldEventContext) => void };
  colSpan?: number;
  formItemProps?: Omit<
    FormItemProps,
    'name' | 'label' | 'rules' | 'dependencies' | 'hidden' | 'children'
  >;
}

/** 自定义字段进入表单层后的形态：保留 FormFieldSchema 的表单语义 + Custom 的渲染函数 */
export type CustomFormFieldSchema<TValue = unknown> = Omit<FormFieldSchema<TValue>, 'type'> &
  CustomFieldSchema<TValue>;

/** 公开入口（SchemaForm / SchemaFormField / 表格列）统一接受这个联合 */
export type AnyFormFieldSchema<TValue = unknown> =
  | FormFieldSchema<TValue>
  | CustomFormFieldSchema<TValue>;

/**
 * 内置工具条（新增 / 插槽 / 批量删除）的位置。
 * 默认底部；顶部与老家族 BatchEdit 的工具条一致，适合按钮少、表体长的页面。
 */
export type ToolbarPlacement = 'top' | 'bottom';

/** 可编辑表格列：EditableTable 与 FullEditableTable 共用同一份定义 */
export type EditableColumn<T> = TableColumnsType<T>[number] & {
  /**
   * 列形态：
   * - `true`：编辑控件，写值进本行 Form，参与校验；
   * - `false`/缺省：不挂 field，单元格直接读行记录——**跟不上 events/linkage 的写值**；
   * - `'read'`：挂 field 但只读渲染，值跟随本行 Form（联动带出的列用这个），
   *   与 SchemaFormField 的 read 态一致：不注册具名 Form.Item，因此不参与校验。
   */
  editable?: boolean | 'read';
  /** 同一份扁平字段 Schema；editable 为 true 或 'read' 时必填 */
  field?: AnyFormFieldSchema;
};
