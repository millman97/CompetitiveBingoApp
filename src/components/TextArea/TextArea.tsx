import { useContext } from 'react';
import { CONTROL } from '../../utils/controlStyles';
import { FieldContext } from '../Field/FieldContext';

const TextArea = ({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const label = useContext(FieldContext);
  return (
    <textarea
      aria-label={label}
      {...props}
      className={`${CONTROL} ${className ?? ''}`}
    />
  );
};

export default TextArea;
