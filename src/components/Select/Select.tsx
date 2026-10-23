import { useContext } from 'react';
import { CONTROL } from '../../utils/controlStyles';
import { FieldContext } from '../Field/FieldContext';

const Select = ({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => {
  const label = useContext(FieldContext);
  return (
    <select
      aria-label={label}
      {...props}
      className={`${CONTROL} ${className ?? ''}`}
    />
  );
};

export default Select;
