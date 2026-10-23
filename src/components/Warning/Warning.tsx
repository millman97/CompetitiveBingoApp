import type { ReactNode } from 'react';

const Warning = ({ children }: { children: ReactNode }) => (
  <div
    role='alert'
    className='bevel rounded-[3px] bg-[rgba(143,47,47,0.35)] px-3 py-2 text-sm'
  >
    {children}
  </div>
);

export default Warning;
