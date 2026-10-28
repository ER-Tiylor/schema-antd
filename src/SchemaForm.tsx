/**
 * SchemaForm：用扁平 FormFieldSchema 组织一个普通表单。
 *
 * V1 只提供最小布局（columns + colSpan）与字段绑定；表单状态完全交给
 * AntD FormInstance，不另维护一份受控整表 API。
 */
import type { ReactNode } from 'react';
import { Form } from 'antd';
import type { FormProps } from 'antd';

import { FormRuntimeHostProvider } from './form/FormRuntimeHost';
import { SchemaFormField } from './form/SchemaFormField';
import { namePathKey } from './form/namePath';
import type { AnyFormFieldSchema, FieldMode } from './types';

export interface SchemaFormProps extends Omit<FormProps, 'children'> {
  schema: AnyFormFieldSchema[];
  /** 多列布局，默认 1 */
  columns?: number;
  /** 表单级只读，强制覆盖字段 mode */
  mode?: FieldMode;
  /** 表单级禁用，永远优先于字段配置 */
  disabled?: boolean;
  /** 允许混用原生 Form.Item，共享同一个 FormInstance */
  children?: ReactNode;
}

export function SchemaForm({
  schema,
  columns = 1,
  mode,
  disabled,
  children,
  ...formProps
}: SchemaFormProps) {
  const [innerForm] = Form.useForm();
  const form = formProps.form ?? innerForm;
  const columnCount = Math.max(1, columns);

  return (
    <Form {...formProps} form={form}>
      <FormRuntimeHostProvider form={form}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            columnGap: 16,
          }}
        >
          {schema.map((field) => {
            const span = Math.min(Math.max(field.colSpan ?? 1, 1), columnCount);
            return (
              <div key={namePathKey(field.name)} style={span > 1 ? { gridColumn: `span ${span}` } : undefined}>
                <SchemaFormField schema={field} mode={mode} disabled={disabled} />
              </div>
            );
          })}
        </div>
        {children}
      </FormRuntimeHostProvider>
    </Form>
  );
}
