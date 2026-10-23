import type { ButtonHTMLAttributes } from 'react';

export type ButtonTone = 'default' | 'primary' | 'danger';

const Button = ({
  children,
  onClick,
  tone = 'default',
  disabled,
  type = 'button',
  title,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
}) => (
  <button
    {...props}
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`game-button game-button-${tone} ${className}`}
  >
    {children}
  </button>
);

export default Button;
