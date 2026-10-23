import type { ReactNode } from 'react';

const Note = ({ children }: { children: ReactNode }) => (
  <p className='text-xs text-parchment-dim'>{children}</p>
);

export default Note;
