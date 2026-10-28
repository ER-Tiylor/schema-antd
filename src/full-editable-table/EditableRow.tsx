/**
 * 行容器：Form component={false} 只提供 Form Context，不输出 <form>，
 * 保证 <tbody><tr><td> 的 DOM 结构合法。
 */
import { memo, useEffect } from 'react';
import type { HTMLAttributes } from 'react';
import { Form } from 'antd';

import { FormRuntimeHostProvider } from '../form/FormRuntimeHost';
import { useFullTableRuntime } from './context';

interface EditableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  'data-row-key'?: string | number;
}

function EditableRowInner({ 'data-row-key': rowKey, ...trProps }: EditableRowProps) {
  const runtime = useFullTableRuntime<object>();
  const [form] = Form.useForm();
  const key = String(rowKey ?? '');
  const initialRecord = runtime?.getInitialRecord(key);

  useEffect(() => {
    if (!runtime) return;
    return runtime.registerForm(key, form);
  }, [runtime, key, form]);

  return (
    <Form
      form={form}
      component={false}
      initialValues={initialRecord}
      onValuesChange={(changed) => runtime?.onRowValuesChange?.(key, changed)}
    >
      <FormRuntimeHostProvider form={form}>
        <tr {...trProps} />
      </FormRuntimeHostProvider>
    </Form>
  );
}

export const EditableRow = memo(EditableRowInner);
