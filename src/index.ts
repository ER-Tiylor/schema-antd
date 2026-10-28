/** packages/schema 对外出口：底层字段渲染，后续追加 SchemaForm / 表格组件 */
export * from './types';
export { registerField, getFieldDefinition, getRegisteredFieldTypes } from './registry';
export type { FieldDefinition } from './registry';
export { SchemaField } from './SchemaField';
export type { SchemaFieldProps } from './SchemaField';
export { defaultRenderRead, renderReadValue, EMPTY_TEXT } from './read';
export { SchemaForm } from './SchemaForm';
export type { SchemaFormProps } from './SchemaForm';
export { SchemaFormField } from './form/SchemaFormField';
export type { SchemaFormFieldProps } from './form/SchemaFormField';
export { FormRuntimeHost, FormRuntimeHostProvider, useFormRuntimeHost } from './form/FormRuntimeHost';
export { namePathKey, normalizeNamePath, getNestedValue } from './form/namePath';
// 副作用导入：注册 AppSelect 字段类型，保证只导入本包时即可用
export * from './app-select';
export * from './editable-table';
export * from './full-editable-table';
export { mergeRowValues } from './rowMerge';
export type { TableFooterContext } from './TableFooter';
