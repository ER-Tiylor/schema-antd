import type { HTMLAttributes, ReactNode } from 'react';

import { SchemaFormField } from '../form/SchemaFormField';
import type { FieldMode, FormFieldSchema } from '../types';
import { useFullTableRuntime } from './context';

interface EditableCellProps extends HTMLAttributes<HTMLTableCellElement> {
  /** 由列的 onCell 注入；没有该属性就是普通只读单元格 */
  field?: FormFieldSchema;
  /** 由列的 onCell 注入：'read' 表示 editable: 'read' 的列，值仍跟随本行 Form */
  fieldMode?: FieldMode;
  children?: ReactNode;
}

export function EditableCell({ field, fieldMode, children, ...tdProps }: EditableCellProps) {
  const runtime = useFullTableRuntime<object>();

  return (
    <td {...tdProps}>
      {field ? (
        <SchemaFormField
          schema={field}
          compact
          mode={fieldMode}
          disabled={runtime?.disabled}
        />
      ) : (
        children
      )}
    </td>
  );
}
