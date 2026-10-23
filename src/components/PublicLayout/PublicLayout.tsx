import type { ReactNode } from 'react';
import usePublicBoardLayout from '../../hooks/usePublicBoardLayout';
import type { BoardSize } from '../../model/domain/Board/BoardLayout';
import AppHeader from '../AppHeader/AppHeader';

const PublicLayout = ({
  children,
  boardSize,
}: {
  children: ReactNode;
  boardSize?: BoardSize;
}) => {
  const { viewportRef, shellRef, style } = usePublicBoardLayout(boardSize);
  const shell = (
    <div
      ref={shellRef}
      className={`app-shell${boardSize ? ' public-board-shell' : ''}`}
    >
      <a
        href='#content'
        className='skip-link'
      >
        Skip to content
      </a>
      <AppHeader />
      <main
        id='content'
        className='app-main'
      >
        {children}
      </main>
    </div>
  );
  return boardSize ? (
    <div
      ref={viewportRef}
      className='public-board-viewport'
      style={style}
    >
      {shell}
    </div>
  ) : (
    shell
  );
};

export default PublicLayout;
