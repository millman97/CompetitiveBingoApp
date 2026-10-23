import { useContext } from 'react';
import { CONTROL } from '../../utils/controlStyles';
import { FieldContext } from '../Field/FieldContext';

const Input = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => {
  const label = useContext(FieldContext);
  return (
    <input
      aria-label={label}
      {...props}
      className={`${CONTROL} ${className ?? ''}`}
    />
  );
};

export default Input;
