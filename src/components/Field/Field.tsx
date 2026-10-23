import type { ReactNode } from 'react';
import { FieldContext } from './FieldContext';

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <fieldset className='flex min-w-0 flex-col gap-1'>
    <legend className='field-label'>{label}</legend>
    <FieldContext.Provider value={label}>{children}</FieldContext.Provider>
  </fieldset>
);

export default Field;
